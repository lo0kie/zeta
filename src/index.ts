import { registerCommands } from '@/commands';
import { registerEvents } from '@/events';
import { ExplorerTreeViewProvider } from '@/explorer/provider';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  vscode.commands.executeCommand('setContext', 'zeta.htmlId', ['html', 'htm']);

  // 组合根：在这里完成全部装配，模块之间零全局状态
  const explorerProvider = new ExplorerTreeViewProvider();
  const explorerTreeView = vscode.window.createTreeView('zeta-explorer', {
    showCollapseAll: true,
    treeDataProvider: explorerProvider,
  });

  context.subscriptions.push(
    explorerTreeView,
    explorerTreeView.onDidChangeVisibility(({ visible }) => explorerProvider.refresh(visible)),
    ...registerCommands({ explorerProvider }),
    registerEvents(explorerProvider)
  );
}

export function deactivate() {
  // 所有资源均已纳入 context.subscriptions，无需手动清理
}
