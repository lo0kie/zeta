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
export function resolveConfiguredFolderUri(folder: string): vscode.Uri {
  const normalized = folder.replace(/\\/g, '/');
  if (isAbsolute(normalized)) return vscode.Uri.file(normalized);

  const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  return rootUri ? vscode.Uri.joinPath(rootUri, normalized) : vscode.Uri.file(normalized);
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

export async function isFile(uri: vscode.Uri | undefined): Promise<boolean> {
  return (await statSafe(uri))?.type === vscode.FileType.File;
}

export async function isDirectory(uri: vscode.Uri | undefined): Promise<boolean> {
  return (await statSafe(uri))?.type === vscode.FileType.Directory;
}

/** 从给定 uri 逐级向上查找最近的 package.json 所在目录，找不到时回落到工作区文件夹 */
export async function findRootUri(uri = vscode.window.activeTextEditor?.document.uri): Promise<vscode.Uri | undefined> {
  if (!uri) return undefined;

  let current = dirname(uri);
  while (true) {
    if (await isFile(vscode.Uri.joinPath(current, 'package.json'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent.toString() === current.toString()) break;
    current = parent;
  }

  return vscode.workspace.getWorkspaceFolder(uri)?.uri;
}
