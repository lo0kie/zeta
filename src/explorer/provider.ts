import { Configuration } from '@/core/configuration';
import { basename, dirname, isDirectory, parseUriList, resolveConfiguredFolderUri, statSafe } from '@/core/fs';
import { escapeRegExp } from '@/core/strings';
import { TtlCache } from '@/core/ttl-cache';
import { appendConfiguredFolders } from '@/explorer/folders';
import * as vscode from 'vscode';

export interface IExplorerNode {
  uri: vscode.Uri;
  type: vscode.FileType;
  isPlaceholder?: boolean;
}

const PLACEHOLDER_NODE: IExplorerNode = {
  uri: vscode.Uri.file(''),
  type: vscode.FileType.Unknown,
  isPlaceholder: true,
};

export class ExplorerTreeViewProvider
  implements vscode.TreeDataProvider<IExplorerNode>, vscode.TreeDragAndDropController<IExplorerNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<IExplorerNode | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // text/uri-list 同时覆盖 VS Code 内部拖拽与系统文件管理器的外部拖入
  public dropMimeTypes = ['text/uri-list'];
  public dragMimeTypes: string[] = [];

  // 过滤正则与根目录列表的缓存，仅在配置变化（invalidateCaches）后重建
  private _filterRegExp: RegExp | null = null;
  private _baseFolders: IExplorerNode[] | null = null;
  private _baseFolderPaths = new Set<string>();

  // 子节点列表短缓存：展开同一目录不反复读盘；refresh/invalidateCaches 时清空
  private static readonly CHILD_CACHE_TTL_MS = 2000;
  private _childCache = new TtlCache<IExplorerNode[]>(ExplorerTreeViewProvider.CHILD_CACHE_TTL_MS);

  /** 配置变更后调用：清空全部缓存，下一次渲染时重新读盘 */
  public invalidateCaches(): void {
    this._filterRegExp = null;
    this._baseFolders = null;
    this._baseFolderPaths.clear();
    this._childCache.clear();
  }

  public refresh(visible = true): void {
    // 用户主动刷新（视图按钮/配置变更）时清子节点缓存，确保重新读盘
    this._childCache.clear();
    if (visible) this._onDidChangeTreeData.fire();
  }

  public handleDrag(): void {
    // 暂不支持从本视图向外拖出
  }

  /** 把拖入的目录（工作区资源管理器或系统文件管理器）追加进检索配置 */
  public async handleDrop(_target: IExplorerNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const uriList = await dataTransfer.get('text/uri-list')?.asString();
    if (!uriList) return;

    const directories: vscode.Uri[] = [];
    for (const uri of parseUriList(uriList)) {
      if (await isDirectory(uri)) directories.push(uri);
    }
    await appendConfiguredFolders(directories);
  }

  private get filterRegExp(): RegExp {
    if (!this._filterRegExp) {
      const filterFolders = Configuration.FILTER_FOLDERS;
      this._filterRegExp = filterFolders.length > 0 ? new RegExp(filterFolders.map(escapeRegExp).join('|')) : /^$/s;
    }
    return this._filterRegExp;
  }

  private async resolveBaseFolders(): Promise<IExplorerNode[]> {
    const configuredFolders = Configuration.FOLDERS.filter(folder => folder.trim().length > 0);
    if (configuredFolders.length === 0) return [PLACEHOLDER_NODE];

    // 各根目录的存在性检查互不依赖：并行 stat，避免多目录（尤其网络盘/慢文件系统）串行排队
    const results = await Promise.all(
      configuredFolders.map(async folder => {
        const uri = resolveConfiguredFolderUri(folder);
        return (await statSafe(uri))?.type === vscode.FileType.Directory
          ? { uri, type: vscode.FileType.Directory }
          : undefined;
      })
    );
    return results.filter((node): node is IExplorerNode => node !== undefined);
  }

  public getTreeItem(element: IExplorerNode): vscode.TreeItem {
    const { uri, type, isPlaceholder } = element;

    // 未配置目录时渲染占位提示，点击调起系统目录选择器并写入配置
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
    treeItem.resourceUri = uri;

    if (isRoot) {
      treeItem.collapsibleState = Expanded;
      // 根目录加父目录名作副标题：跨项目添加同名目录（两个项目都有 src）时便于区分
      treeItem.description = basename(dirname(uri));
    } else if (type === File) {
      treeItem.command = { arguments: [uri], command: 'vscode.open', title: '打开文件' };
      treeItem.collapsibleState = None;
    }

    // 根目录带 root 标记（仍以 directory- 开头，兼容既有菜单的 when 匹配）
    const contextValueMap: Record<number, string> = {
      [Directory]: 'directory',
      [File]: 'file',
    };
    const prefix = isRoot ? 'directory-root' : (contextValueMap[type] ?? 'unknown');
    treeItem.contextValue = `${prefix}-${nodeName}`;

    return treeItem;
  }

  public async getChildren(element?: IExplorerNode): Promise<IExplorerNode[]> {
    if (element?.isPlaceholder) return [];

    if (!element) {
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
        if (this.filterRegExp.test(dirname) || (fileType !== File && fileType !== Directory)) {
          continue;
        }
        const node: IExplorerNode = { uri: vscode.Uri.joinPath(element.uri, dirname), type: fileType };
        if (fileType === File) files.push(node);
        else folders.push(node);
      }

      folders.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
      files.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));

      const children = [...folders, ...files];
      this._childCache.set(cacheKey, children);
      return children;
    } catch {
      return [];
    }
  }
}
