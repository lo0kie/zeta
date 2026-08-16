import { Configuration } from '@/core/configuration';
import { basename, statSafe } from '@/core/fs';
import { escapeRegExp } from '@/core/strings';
import { isAbsolute } from 'node:path';
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

export class ExplorerTreeViewProvider implements vscode.TreeDataProvider<IExplorerNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<IExplorerNode | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // 过滤正则与根目录列表的缓存，仅在配置变化（invalidateCaches）后重建
  private _filterRegExp: RegExp | null = null;
  private _baseFolders: IExplorerNode[] | null = null;
  private _baseFolderPaths = new Set<string>();

  /** 配置变更后调用：清空全部缓存，下一次渲染时重新读盘 */
  public invalidateCaches(): void {
    this._filterRegExp = null;
    this._baseFolders = null;
    this._baseFolderPaths.clear();
  }

  public refresh(visible = true): void {
    if (visible) this._onDidChangeTreeData.fire();
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

    // 相对目录基于工作区根目录解析，避免落到扩展宿主的 CWD 上
    const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    const nodes: IExplorerNode[] = [];

    for (const folder of configuredFolders) {
      const normalized = folder.replace(/\\/g, '/');
      const uri = isAbsolute(normalized)
        ? vscode.Uri.file(normalized)
        : rootUri
          ? vscode.Uri.joinPath(rootUri, normalized)
          : vscode.Uri.file(normalized);

      if ((await statSafe(uri))?.type === vscode.FileType.Directory) {
        nodes.push({ uri, type: vscode.FileType.Directory });
      }
    }
    return nodes;
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

    const treeItem = new vscode.TreeItem(nodeName, Collapsed);
    treeItem.resourceUri = uri;

    if (this._baseFolderPaths.has(uri.fsPath)) {
      treeItem.collapsibleState = Expanded;
    } else if (type === File) {
      treeItem.command = { arguments: [uri], command: 'vscode.open', title: '打开文件' };
      treeItem.collapsibleState = None;
    }

    const contextValueMap: Record<number, string> = {
      [Directory]: 'directory',
      [File]: 'file',
    };
    treeItem.contextValue = `${contextValueMap[type] ?? 'unknown'}-${nodeName}`;

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

      return [...folders, ...files];
    } catch {
      return [];
    }
  }
}
