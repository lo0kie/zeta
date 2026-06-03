import { exist } from '@/utils';
import { Configuration } from '@/utils/configuration';
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';

export interface IExplorerNode {
  uri: vscode.Uri;
  type: vscode.FileType;
  isPlaceholder?: boolean; // 🚀 新增：标记当前节点是否为警告占位符
}

class ExplorerTreeViewProvider implements vscode.TreeDataProvider<IExplorerNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<IExplorerNode | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // 正则表达式缓存载体
  private _filterRegExp: RegExp | null = null;

  private get filterRegExp(): RegExp {
    if (!this._filterRegExp) {
      const filterFolders = Configuration.FILTER_FOLDERS;
      this._filterRegExp = filterFolders.length > 0 ? new RegExp(filterFolders.join('|').replace(/\./g, '\\.')) : /^$/s;
    }
    return this._filterRegExp;
  }

  public clearCache(): void {
    this._filterRegExp = null;
  }

  public get baseFolders(): IExplorerNode[] {
    const configuredFolders = Configuration.FOLDERS;

    // 🚀 核心优化：如果用户完全没有配置任何文件夹，动态吐出一个占位符节点
    if (configuredFolders.length === 0) {
      return [
        {
          uri: vscode.Uri.file(''),
          type: vscode.FileType.Unknown,
          isPlaceholder: true,
        },
      ];
    }

    return configuredFolders
      .map(folder => vscode.Uri.file(folder))
      .filter(uri => exist(uri))
      .map(uri => ({ uri, type: vscode.FileType.Directory }));
  }

  public refresh = (condition: boolean | unknown = true): void => {
    if (condition !== false) {
      this._onDidChangeTreeData.fire();
    }
  };

  public getTreeItem(element: IExplorerNode): vscode.TreeItem {
    const { uri, type, isPlaceholder } = element;

    // 🚀 核心优化：渲染占位符节点的视觉样式
    if (isPlaceholder) {
      const hintItem = new vscode.TreeItem('⚠️ 请先在设置中配置检索目录', vscode.TreeItemCollapsibleState.None);
      hintItem.tooltip = '点击打开配置项';
      // 点击这个占位提示，直接联动帮用户翻出设置面板！
      hintItem.command = {
        command: 'workbench.action.openSettings',
        arguments: ['zeta.list.folders'],
        title: '打开设置',
      };
      hintItem.contextValue = 'placeholder-hint';
      return hintItem;
    }

    const isBaseFolder = this.baseFolders.some(base => base.uri.fsPath === uri.fsPath);
    const basename = Utils.basename(uri);

    const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;
    const { Directory, File } = vscode.FileType;

    const treeItem = new vscode.TreeItem(basename, Collapsed);
    treeItem.resourceUri = uri;

    if (isBaseFolder) {
      treeItem.collapsibleState = Expanded;
    } else if (type === File) {
      treeItem.command = { arguments: [uri], command: 'vscode.open', title: '打开文件' };
      treeItem.collapsibleState = None;
    }

    const contextValueMap: Record<number, string> = {
      [Directory]: 'directory',
      [File]: 'file',
    };
    treeItem.contextValue = `${contextValueMap[type] || 'unknown'}-${basename}`;

    return treeItem;
  }

  public async getChildren(element?: IExplorerNode): Promise<IExplorerNode[]> {
    // 如果父节点本身就是占位符，它不可能有子节点，直接掐断
    if (element?.isPlaceholder) return [];
    if (!element) return this.baseFolders;

    try {
      const directories = await vscode.workspace.fs.readDirectory(element.uri);
      const { File, Directory } = vscode.FileType;
      const folders: IExplorerNode[] = [];
      const files: IExplorerNode[] = [];

      for (const [dirname, fileType] of directories) {
        if (this.filterRegExp.test(dirname) || (fileType !== File && fileType !== Directory)) {
          continue;
        }
        const childUri = vscode.Uri.joinPath(element.uri, dirname);
        const node: IExplorerNode = { uri: childUri, type: fileType };

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

const explorerTreeViewProvider = new ExplorerTreeViewProvider();
export default explorerTreeViewProvider;
