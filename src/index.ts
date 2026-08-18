/**
 * 扩展激活入口：装配全部 provider、命令、事件与状态栏组件。
 */
import { registerCommands } from '@/commands';
import { registerEvents } from '@/events';
import { ExplorerTreeViewProvider } from '@/explorer/provider';
import { registerPathCompletion } from '@/providers/path-completion';
import { clearColorCache, registerStyleColor } from '@/providers/style-color';
import { clearStyleDocCache, clearStyleFileCache, registerStyleCompletion } from '@/providers/style-completion';
import { registerStyleHover } from '@/providers/style-hover';
import { TerminalToggleStatusItem } from '@/statusbar/terminal-toggle';
import * as vscode from 'vscode';
import { registerStyleDefinition } from './providers/style-definition';
import { registerStyleSemanticTokens } from './providers/style-semantic-tokens';
import { registerPathDefinition } from './providers/path-definition';
import { registerStyleImportLinks } from './providers/style-import-link';
import { registerImportHover } from './providers/import-hover';

/** 扩展激活入口：装配资源导航、路径/样式补全、颜色/悬浮提供者、终端开关与全部命令 */
export function activate(context: vscode.ExtensionContext) {
  vscode.commands.executeCommand('setContext', 'zeta.htmlId', ['html', 'htm']);

  // 组合根：在这里完成全部装配，模块之间零全局状态
  const explorerProvider = new ExplorerTreeViewProvider();
  const explorerTreeView = vscode.window.createTreeView('zeta-explorer', {
    showCollapseAll: true,
    treeDataProvider: explorerProvider,
    dragAndDropController: explorerProvider,
  });

  context.subscriptions.push(
    registerPathCompletion(),
    registerStyleCompletion(),
    registerStyleColor(),
    registerStyleHover(),
    registerStyleDefinition(),
    registerStyleSemanticTokens(),
    registerPathDefinition(),
    registerStyleImportLinks(),
    registerImportHover(),
    // 文档关闭即释放文档级缓存（样式解析 / 颜色结果），避免长期运行内存累积
    vscode.workspace.onDidCloseTextDocument(doc => {
      clearStyleDocCache(doc.uri);
      clearColorCache(doc.uri);
    }),
    // 样式文件保存后立刻失效其原文/符号/文档级缓存，避免 TTL 窗口内补全与悬浮用旧值
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (/\.(less|css|scss|sass|stylus)$/i.test(doc.uri.fsPath)) clearStyleFileCache(doc.uri);
    }),
    explorerTreeView,
    explorerTreeView.onDidChangeVisibility(({ visible }) => explorerProvider.refresh(visible)),
    new TerminalToggleStatusItem(),
    ...registerCommands({ explorerProvider }),
    registerEvents(explorerProvider)
  );
}

export function deactivate() {
  // 所有资源均已纳入 context.subscriptions，无需手动清理
}
