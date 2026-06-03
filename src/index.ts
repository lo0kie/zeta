import commands from '@/commands';
import { registerEvents } from '@/events';
import explorerTreeViewProvider from '@/providers/explorer-view';
import pathJumpProvider from '@/providers/path-jump';
import { fileSize, memory } from '@/statusbar';
import { DEFINED_EXPANDED_LANGS, LANGUAGES } from '@/utils/constants';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  vscode.commands.executeCommand('setContext', 'zeta.htmlId', ['html', 'htm']);

  // 1. 显式注册所有视图和语言跳转 Provider
  const explorerTreeView = vscode.window.createTreeView('zeta-explorer', {
    showCollapseAll: true,
    treeDataProvider: explorerTreeViewProvider,
  });
  explorerTreeView.onDidChangeVisibility(({ visible }) => explorerTreeViewProvider.refresh(visible));

  const definitionProvider = vscode.languages.registerDefinitionProvider(
    [...LANGUAGES, ...DEFINED_EXPANDED_LANGS],
    pathJumpProvider
  );

  // 2. 显式推入通用销毁上下文（🚀 核心修改：将 terminalToggle 塞入销毁队列）
  context.subscriptions.push(explorerTreeView, definitionProvider, fileSize, memory);
  context.subscriptions.push(...commands);

  // 3. 注册全局事件系统
  registerEvents(context);

  // 4. 核心修复：立刻刷新初始状态栏状态
  fileSize.update();
  memory.update();

  // 5. 边缘 Tick 兜底
  if (vscode.window.activeTextEditor) {
    setTimeout(() => {
      fileSize.update();
      memory.update();
    }, 60);
  }
}

export function deactivate() {
  // 保持干净即可
}
