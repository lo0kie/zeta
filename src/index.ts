/**
 * 扩展激活入口：装配全部 provider、命令、事件与状态栏组件。
 */
import { registerCommands } from '@/commands';
import { clearProbeCache } from '@/core/probe-cache';
import { registerEvents } from '@/events';
import { registerSelectionContext } from '@/events/selection-context';
import { ExplorerTreeViewProvider } from '@/explorer/provider';
import { registerPathCompletion } from '@/providers/path-completion';
import { clearColorCache, registerStyleColor } from '@/providers/style-color';
import {
  clearStyleDocCache,
  clearStyleFileCache,
  registerStyleCompletion,
  schedulePreheat,
  trackOpenDocument,
  untrackOpenDocument,
} from '@/providers/style-completion';
import { registerStyleHover } from '@/providers/style-hover';
import { TerminalToggleStatusItem } from '@/statusbar/terminal-toggle';
import * as vscode from 'vscode';
import { registerImportHover } from './providers/import-hover';
import { registerPathDefinition } from './providers/path-definition';
import { registerStyleDefinition } from './providers/style-definition';
import { registerStyleImportLinks } from './providers/style-import-link';
import { clearStyleIndex } from './providers/style-index';

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
    registerPathDefinition(),
    registerStyleImportLinks(),
    registerImportHover(),
    // 文档打开：维护「打开文档」索引（readFileTextCached 查 Map 而非线性扫描），
    // 并对样式/vue 文档空闲预热导入链（首次补全/悬浮不冷启动）
    vscode.workspace.onDidOpenTextDocument(doc => {
      trackOpenDocument(doc);
      schedulePreheat(doc);
    }),
    // 文档关闭即释放文档级缓存（样式解析 / 颜色 / style 块 / 文件索引），避免长期运行内存累积
    vscode.workspace.onDidCloseTextDocument(doc => {
      untrackOpenDocument(doc.uri);
      clearStyleDocCache(doc.uri);
      clearColorCache(doc.uri);
      clearStyleIndex(doc.uri);
    }),
    // 样式文件保存后立刻失效其原文/符号/文档级缓存与文件索引，避免 TTL 窗口内补全与悬浮用旧值
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (/\.(less|css|scss|sass|stylus)$/i.test(doc.uri.fsPath)) {
        clearStyleFileCache(doc.uri);
        clearStyleIndex(doc.uri);
      }
    }),
    // 文件创建/删除/重命名：清空文件探测结果缓存（TTL 2s，量小，整体清空成本极低且绝对正确）
    vscode.workspace.onDidCreateFiles(() => clearProbeCache()),
    vscode.workspace.onDidDeleteFiles(() => clearProbeCache()),
    vscode.workspace.onDidRenameFiles(() => clearProbeCache()),
    explorerTreeView,
    explorerTreeView.onDidChangeVisibility(({ visible }) => explorerProvider.refresh(visible)),
    new TerminalToggleStatusItem(),
    ...registerCommands({ explorerProvider }),
    registerEvents(explorerProvider),
    registerSelectionContext()
  );
}

export function deactivate() {
  // 所有资源均已纳入 context.subscriptions，无需手动清理
}
