import { isAbsolute } from 'node:path';
import * as vscode from 'vscode';

/** 取 uri 路径段的最后一段（等价于 vscode-uri 的 Utils.basename，零依赖实现） */
export function basename(uri: vscode.Uri): string {
  return uri.path.split('/').filter(Boolean).pop() ?? '';
}

/** 取父目录 uri（等价于 vscode-uri 的 Utils.dirname，零依赖实现） */
export function dirname(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(uri, '..');
}

/**
 * 解析用户在 zeta.list.folders 中配置的目录：
 * 绝对路径直接使用，相对路径基于第一个工作区根目录。
 */
export function resolveConfiguredFolderUri(folder: string): vscode.Uri | undefined {
  const normalized = folder.replace(/\\/g, '/');
  if (isAbsolute(normalized)) return vscode.Uri.file(normalized);

  const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  return rootUri ? vscode.Uri.joinPath(rootUri, normalized) : undefined;
}

/** stat 的安全封装：路径不存在或不可访问时返回 undefined，而不是抛异常 */
export async function statSafe(uri: vscode.Uri | undefined): Promise<vscode.FileStat | undefined> {
  if (!uri) return undefined;
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
}

/** 两个 uri 是否指向同一路径：Windows 大小写不敏感，其余平台精确比较 */
export function isSameUri(a: vscode.Uri | undefined, b: vscode.Uri | undefined): boolean {
  if (!a || !b) return false;
  return process.platform === 'win32'
    ? a.fsPath.toLowerCase() === b.fsPath.toLowerCase()
    : a.toString() === b.toString();
}

/**
 * 归一化菜单入口传入的命令参数。
 * explorer/context 等原生菜单直接传 Uri；树视图的行内按钮与右键菜单
 * (view/item/context) 传入的是树节点对象——可能是带 resourceUri 的 TreeItem，
 * 也可能是数据提供者的 element（本项目的 IExplorerNode，字段为 uri），
 * 另有偶发 undefined 的情况（microsoft/vscode#64017），这里统一还原成 Uri。
 */
export function resolveUriArgument(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;

  if (arg && typeof arg === 'object') {
    const candidate = arg as { uri?: unknown; resourceUri?: unknown };
    if (candidate.resourceUri instanceof vscode.Uri) return candidate.resourceUri;
    if (candidate.uri instanceof vscode.Uri) return candidate.uri;
  }
  return undefined;
}

/** 判断 uri 是否为普通文件（不存在或不可读返回 false） */
export async function isFile(uri: vscode.Uri | undefined): Promise<boolean> {
  return (await statSafe(uri))?.type === vscode.FileType.File;
}

/** 判断 uri 是否为目录（不存在或不可读返回 false） */
export async function isDirectory(uri: vscode.Uri | undefined): Promise<boolean> {
  return (await statSafe(uri))?.type === vscode.FileType.Directory;
}

/** 从给定 uri 逐级向上查找最近的 package.json 所在目录，找不到时回落到工作区文件夹 */
export async function findRootUri(uri = vscode.window.activeTextEditor?.document.uri): Promise<vscode.Uri | undefined> {
  if (!uri) return undefined;

  const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri;
  let current = dirname(uri);

  while (true) {
    if (await isFile(vscode.Uri.joinPath(current, 'package.json'))) {
      return current;
    }

    // 到达工作区根目录或文件系统顶层时停止向上遍历，避免无谓的磁盘探测
    // （Windows 文件系统大小写不敏感，比较时忽略大小写差异）
    if (workspaceRoot && isSameUri(current, workspaceRoot)) break;
    const parent = dirname(current);
    if (isSameUri(parent, current)) break;
    current = parent;
  }

  return workspaceRoot;
}

/**
 * 解析 drag-and-drop 的 text/uri-list 内容为文件 Uri 列表。
 * 手工拆解 file:// 前缀与原生路径，避免走 vscode.Uri.parse——
 * 其内部基于 Node 的 url.parse 实现，会触发 DEP0169 弃用警告。
 * 非 file 协议的 URI 行直接丢弃；`#` 开头的注释行与空行跳过。
 */
export function parseUriList(uriList: string): vscode.Uri[] {
  const uris: vscode.Uri[] = [];

  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('file://')) {
      let rest = trimmed.slice('file://'.length);
      if (!rest) continue;

      if (/^\/?[A-Za-z]:/.test(rest)) {
        // 盘符：file:///C:/... 或 file://C:/... → C:/...
        rest = rest.replace(/^\//, '');
      } else if (rest[0] !== '/') {
        // UNC：file://host/share/... → //host/share/...
        rest = `//${rest}`;
      }

      try {
        uris.push(vscode.Uri.file(decodeURIComponent(rest)));
      } catch {
        // 解码失败（如文件名含未转义的 %）：不丢弃，降级把原字符串直接当普通路径使用，
        // 避免部分文件管理器（URI 编码不规范）拖拽进来的目录"莫名其妙"丢失
        try {
          uris.push(vscode.Uri.file(rest));
        } catch (fallbackError) {
          console.warn(`[zeta] 无法解析拖拽路径: ${rest}`, fallbackError);
        }
      }
    } else if (/^[A-Za-z]:[\\/]|^[/\\]/.test(trimmed)) {
      // 部分系统文件管理器直接提供原生路径
      uris.push(vscode.Uri.file(trimmed));
    }
  }

  return uris;
}
