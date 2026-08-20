import { registerCommands } from '@/commands/index';
import { registerEvents } from '@/events/index';
import { activate } from '@/index';
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import * as vscode from 'vscode';
import { cleanup, makeWorkspace, setConfig } from './helpers';

test('registerEvents: 配置变化时触发缓存失效与刷新', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    let invalidated = false;
    let refreshed = false;

    const mockProvider = {
      invalidateCaches() {
        invalidated = true;
      },
      refresh() {
        refreshed = true;
      },
    };

    let changeListener: ((e: { affectsConfiguration: (key: string) => boolean }) => void) | undefined;
    vi.spyOn(vscode.workspace, 'onDidChangeConfiguration').mockImplementation(
      (listener: (e: vscode.ConfigurationChangeEvent) => void) => {
        changeListener = listener as unknown as (e: { affectsConfiguration: (key: string) => boolean }) => void;
        return { dispose() {} };
      }
    );

    registerEvents(mockProvider as unknown as Parameters<typeof registerEvents>[0]);
    assert.ok(changeListener);

    changeListener!({ affectsConfiguration: (key: string) => key === 'zeta.other.key' });
    assert.equal(invalidated, false);
    assert.equal(refreshed, false);

    changeListener!({ affectsConfiguration: (key: string) => key === 'zeta.list.folders' });
    assert.equal(invalidated, true);
    assert.equal(refreshed, true);

    invalidated = false;
    refreshed = false;
    changeListener!({ affectsConfiguration: (key: string) => key === 'zeta.list.filterFolders' });
    assert.equal(invalidated, true);
    assert.equal(refreshed, true);
  } finally {
    cleanup(ws);
  }
});

test('registerCommands: 注册表完整性', () => {
  const registered: string[] = [];
  vi.spyOn(vscode.commands, 'registerCommand').mockImplementation((cmd: string) => {
    registered.push(cmd);
    return { dispose() {} };
  });
  vi.spyOn(vscode.commands, 'registerTextEditorCommand').mockImplementation((cmd: string) => {
    registered.push(cmd);
    return { dispose() {} };
  });

  const disposables = registerCommands({
    explorerProvider: { refresh() {} },
  } as unknown as Parameters<typeof registerCommands>[0]);

  const expectedCommands = [
    'zeta.editor.wrapTags',
    'zeta.editor.changeCase',
    'zeta.editor.cycleCase',
    'zeta.editor.wrapConsole',
    'zeta.editor.wrapTryCatch',
    'zeta.editor.wrapIf',
    'zeta.editor.unwrapTags',
    'zeta.editor.cycleQuotes',
    'zeta.editor.debugResolveImport',
    'zeta.editor.selectBlock',
    'zeta.editor.selectString',
    'zeta.openResolvedImport',
    'zeta.folder.openInTerminal',
    'zeta.file.openInBrowser',
    'zeta.folder.openInWindow',
    'zeta.folder.openInNewWindow',
    'zeta.folder.runPackageScript',
    'zeta.explorer.addFolder',
    'zeta.explorer.removeFolder',
    'zeta.explorer.refresh',
    'zeta.explorer.newFile',
    'zeta.explorer.newFolder',
    'zeta.explorer.rename',
    'zeta.explorer.delete',
    'zeta.explorer.copyAbsolutePath',
    'zeta.explorer.copyRelativePath',
    'zeta.terminal.toggle',
    'zeta.showCommands',
  ];

  // expectedCommands 作为命令清单唯一数据源：新增/删除命令只需改一处
  assert.equal(disposables.length, expectedCommands.length);

  for (const cmd of expectedCommands) {
    assert.ok(registered.includes(cmd), `缺少命令注册: ${cmd}`);
  }
});

test('activate: 扩展激活入口订阅挂载', () => {
  const subscriptions: Array<{ dispose(): void }> = [];
  const context = { subscriptions };
  const executed: Array<{ cmd: string; args: unknown[] }> = [];

  vi.spyOn(vscode.window, 'createTreeView').mockImplementation(
    () => ({ onDidChangeVisibility: () => ({ dispose() {} }), dispose() {} }) as unknown as vscode.TreeView<unknown>
  );
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (cmd: string, ...args: unknown[]) => {
    executed.push({ cmd, args });
  });

  activate(context as unknown as vscode.ExtensionContext);
  // 下限断言防侧漏（当前 40 = 固定装配 17 + registerCommands 21 + registerEvents 1 + registerSelectionContext 1），
  // 不写死精确值——后续新增订阅（如状态栏项/文档事件）不应变成修改测试的「维护税」
  assert.ok(subscriptions.length >= 39, '核心 Provider 与命令需全量挂载');

  // zeta.htmlId 上下文写入校验：绑定 html/htm 语言，供命令 palette when 条件使用
  const htmlSetCtx = executed.find(e => e.cmd === 'setContext' && e.args[0] === 'zeta.htmlId');
  assert.ok(htmlSetCtx, '应调用 setContext');
  assert.equal(htmlSetCtx.args[0], 'zeta.htmlId');
  assert.deepEqual(htmlSetCtx.args[1], ['html', 'htm']);

  // zeta.caseDisabled 上下文写入校验：激活时立即计算一次（无激活编辑器 → false）
  const caseSetCtx = executed.find(e => e.cmd === 'setContext' && e.args[0] === 'zeta.caseDisabled');
  assert.ok(caseSetCtx, '应调用 setContext(zeta.caseDisabled)');
  assert.equal(caseSetCtx.args[1], false, '无激活编辑器时 case 命令不禁用');
});
