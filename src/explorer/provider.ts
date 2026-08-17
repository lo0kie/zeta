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

  public dropMimeTypes = ['text/uri-list'];
  public dragMimeTypes: string[] = [];

  private _filterRegExp: RegExp | null = null;
  private _baseFolders: IExplorerNode[] | null = null;
  private _baseFolderPaths = new Set<string>();

  private static readonly CHILD_CACHE_TTL_MS = 2000;
  private _childCache = new TtlCache<IExplorerNode[]>(ExplorerTreeViewProvider.CHILD_CACHE_TTL_MS);

  public invalidateCaches(): void {
    this._filterRegExp = null;
    this._baseFolders = null;
    this._baseFolderPaths.clear();
    this._childCache.clear();
  }

  public refresh(visible = true): void {
    this._childCache.clear();
    if (visible) this._onDidChangeTreeData.fire();
  }

  public handleDrag(): void {}

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
      const filterFolders = Configuration.FILTER_FOLDERS.filter(f => typeof f === 'string' && f.trim().length > 0);
      this._filterRegExp =
        filterFolders.length > 0 ? new RegExp(`^(?:${filterFolders.map(escapeRegExp).join('|')})$`) : /^$/s;
    }
    return this._filterRegExp;
  }

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
    treeItem.resourceUri = uri;

    if (isRoot) {
      treeItem.collapsibleState = Expanded;
      treeItem.description = basename(dirname(uri));
    } else if (type === File) {
      treeItem.command = { arguments: [uri], command: 'vscode.open', title: '打开文件' };
      treeItem.collapsibleState = None;
    }

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
