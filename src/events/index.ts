import type { ExplorerTreeViewProvider } from '@/explorer/provider';
import * as vscode from 'vscode';

/** 配置变更监听：只有影响检索目录/过滤列表的配置变化才刷新资源导航，其余配置（如 zeta.string.tag）不重建视图 */
export function registerEvents(explorerProvider: ExplorerTreeViewProvider): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(({ affectsConfiguration }) => {
    const needsRefresh = ['zeta.list.folders', 'zeta.list.filterFolders'].some(key => affectsConfiguration(key));
    if (needsRefresh) {
      explorerProvider.invalidateCaches();
      explorerProvider.refresh();
    }
  });
}
