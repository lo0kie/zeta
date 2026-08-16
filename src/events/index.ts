import type { ExplorerTreeViewProvider } from '@/explorer/provider';
import * as vscode from 'vscode';

export function registerEvents(explorerProvider: ExplorerTreeViewProvider): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(({ affectsConfiguration }) => {
    const needsRefresh = ['zeta.list.folders', 'zeta.list.filterFolders'].some(key => affectsConfiguration(key));
    if (needsRefresh) {
      explorerProvider.invalidateCaches();
      explorerProvider.refresh();
    }
  });
}
