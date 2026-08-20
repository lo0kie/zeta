import { Configuration } from '@/core/configuration';
import { basename, dirname, isDirectory, parseUriList, resolveConfiguredFolderUri, statSafe } from '@/core/fs';
import { escapeRegExp } from '@/core/strings';
import { TtlCache } from '@/core/ttl-cache';
import { appendConfiguredFolders } from '@/explorer/folders';
import * as vscode from 'vscode';

/** 资源导航树的节点：目录/文件，或占位提示节点 */
export interface IExplorerNode {
  uri: vscode.Uri;
  type: vscode.FileType;
  isPlaceholder?: boolean;
}

/** 未配置任何检索目录时的占位节点（点击引导添加） */
const PLACEHOLDER_NODE: IExplorerNode = {
  uri: vscode.Uri.file(''),
  type: vscode.FileType.Unknown,
  isPlaceholder: true,
};

/**
 * 资源导航树：展示 zeta.list.folders 配置的目录（目录/文件展开打开）。
 * 子节点按目录优先排序，读盘结果带 2s TTL 缓存。
 */
export class ExplorerTreeViewProvider
  implements vscode.TreeDataProvider<IExplorerNode>, vscode.TreeDragAndDropController<IExplorerNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<IExplorerNode | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // 接受外部拖入（text/uri-list）。注意：VS Code 拖放 mime 无法区分文件/目录，
  // 拖入文件也会显示「可放置」反馈——此时在 handleDrop 里明确提示「仅支持文件夹」，
  // 避免「有反馈却不添加」的静默困惑。
  public dropMimeTypes = ['text/uri-list'];
  public dragMimeTypes: string[] = [];

  private _filterRegExp: RegExp | null = null;
  private _baseFolders: IExplorerNode[] | null = null;
  private _baseFolderPaths = new Set<string>();

  private static readonly CHILD_CACHE_TTL_MS = 2000;
  private _childCache = new TtlCache<IExplorerNode[]>(ExplorerTreeViewProvider.CHILD_CACHE_TTL_MS);

  /** 清空全部缓存（配置变更时调用），下次展开重新读盘 */
  public invalidateCaches(): void {
    this._filterRegExp = null;
    this._baseFolders = null;
    this._baseFolderPaths.clear();
    this._childCache.clear();
  }

  /** 视图刷新：清子节点缓存；可见时同时触发树重绘 */
  public refresh(visible = true): void {
    this._childCache.clear();
    if (visible) this._onDidChangeTreeData.fire();
  }

  public handleDrag(): void {}

  /** 接受拖入：目录写入配置；文件明确提示拒绝（isDirectory 并发校验，避免串行 stat 卡顿） */
  public async handleDrop(_target: IExplorerNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const uriList = await dataTransfer.get('text/uri-list')?.asString();
    if (!uriList) return;

    const uris = parseUriList(uriList);
    const checkResults = await Promise.all(uris.map(async uri => ({ uri, isDir: await isDirectory(uri) })));
    const directories = checkResults.filter(r => r.isDir).map(r => r.uri);
    const fileCount = checkResults.length - directories.length;

    if (fileCount > 0) {
      await vscode.window.showWarningMessage(
        fileCount === 1 ? '仅支持拖入文件夹，已忽略 1 个文件' : `仅支持拖入文件夹，已忽略 ${fileCount} 个文件`
      );
    }

    if (directories.length > 0) {
      await appendConfiguredFolders(directories);
    }
  }

  /** 按 zeta.list.filterFolders 编译「目录名精确匹配」过滤正则（惰性构建） */
  private get filterRegExp(): RegExp {
    if (!this._filterRegExp) {
      const filterFolders = Configuration.FILTER_FOLDERS.filter(f => typeof f === 'string' && f.trim().length > 0);
      this._filterRegExp =
        filterFolders.length > 0 ? new RegExp(`^(?:${filterFolders.map(escapeRegExp).join('|')})$`) : /^$/s;
    }
    return this._filterRegExp;
  }

  /** 解析配置的根目录：逐项探测必须是真实目录；全部无效或无配置时返回占位节点 */
  private async resolveBaseFolders(): Promise<IExplorerNode[]> {
    const configuredFolders = Configuration.FOLDERS.filter(folder => folder.trim().length > 0);
    if (configuredFolders.length === 0) return [PLACEHOLDER_NODE];

    const results = await Promise.all(
      configuredFolders.map(async folder => {
        const uri = resolveConfiguredFolderUri(folder);
        if (!uri) return undefined; // <- 拦截相对路径在无工作区环境时的探测
        return (await statSafe(uri))?.type === vscode.FileType.Directory
          ? { uri, type: vscode.FileType.Directory }
          : undefined;
      })
    );
    const validNodes = results.filter((node): node is IExplorerNode => node !== undefined);
    return validNodes.length > 0 ? validNodes : [PLACEHOLDER_NODE];
  }

  public getTreeItem(element: IExplorerNode): vscode.TreeItem {
    const { uri, type, isPlaceholder } = element;

    if (isPlaceholder) {
      const hintItem = new vscode.TreeItem('未配置检索目录，点击添加', vscode.TreeItemCollapsibleState.None);
      hintItem.tooltip = '选择目录后将写入 zeta.list.folders 配置';
      hintItem.command = {
        command: 'zeta.explorer.addFolder',
        title: '添加检索目录',
      };
      hintItem.contextValue = 'placeholder-hint';
      return hintItem;
    }

    const nodeName = basename(uri);
    const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;
    const { Directory, File } = vscode.FileType;
    const isRoot = this._baseFolderPaths.has(uri.fsPath);

    const treeItem = new vscode.TreeItem(nodeName, Collapsed);
    treeItem.resourceUri = uri.with({ scheme: 'zeta-file' });

    // FileType 是位掩码（SymbolicLink=64），符号链接节点的 type 是 65/66，须按位判断。
    const isFile = (type & File) !== 0;
    const isDirectory = (type & Directory) !== 0;

    if (isRoot) {
      // 根目录默认展开，副标题显示父目录名便于区分同名目录
      treeItem.collapsibleState = Expanded;
      treeItem.description = basename(dirname(uri));
    } else if (isFile) {
      treeItem.command = { arguments: [uri], command: 'vscode.open', title: '打开文件' };
      treeItem.collapsibleState = None;
    }

    // contextValue 供右键菜单的 when 匹配：根目录带 directory-root- 前缀；
    // 符号链接目录/文件分别按 directory/file 归类，避免落到 unknown
    const contextValue = isDirectory ? 'directory' : isFile ? 'file' : 'unknown';
    const prefix = isRoot ? 'directory-root' : contextValue;
    treeItem.contextValue = `${prefix}-${nodeName}`;

    return treeItem;
  }

  /** 取子节点：根 = 配置目录列表；目录 = 读盘（过滤黑名单、目录优先、命中缓存） */
  public async getChildren(element?: IExplorerNode): Promise<IExplorerNode[]> {
    if (element?.isPlaceholder) return [];

    if (!element) {
      // 根层只解析一次，配置变更时经 invalidateCaches 失效
      if (!this._baseFolders) {
        this._baseFolders = await this.resolveBaseFolders();
        this._baseFolderPaths = new Set(this._baseFolders.map(node => node.uri.fsPath));
      }
      return this._baseFolders;
    }

    const cacheKey = element.uri.toString();
    const cached = this._childCache.get(cacheKey);
    if (cached) return cached;

    try {
      const entries = await vscode.workspace.fs.readDirectory(element.uri);
      const { File, Directory } = vscode.FileType;
      const folders: IExplorerNode[] = [];
      const files: IExplorerNode[] = [];

      for (const [dirname, fileType] of entries) {
        // FileType 是位掩码枚举（File=1, Directory=2, SymbolicLink=64）：
        // 符号链接指向文件时返回值是 65（File|SymbolicLink）、指向目录是 66（Directory|SymbolicLink）。
        // 必须按位判断，否则符号链接目录/文件会被误判为「非常规类型」而静默过滤。
        const isFile = (fileType & File) !== 0;
        const isDirectory = (fileType & Directory) !== 0;
        // 过滤黑名单目录与非常规文件类型（如设备、未知）
        if (this.filterRegExp.test(dirname) || (!isFile && !isDirectory)) {
          continue;
        }
        const node: IExplorerNode = { uri: vscode.Uri.joinPath(element.uri, dirname), type: fileType };
        if (isFile) files.push(node);
        else folders.push(node);
      }

      folders.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
      files.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));

      const children = [...folders, ...files];
      this._childCache.set(cacheKey, children);
      return children;
    } catch {
      // 目录不可读（权限/已删除）时静默返回空
      return [];
    }
  }
}
