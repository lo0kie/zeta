import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { cleanup, loadModule, makeWorkspace, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const vscode = require(shimPath);

const { registerEvents, registerCommands, activate } = await loadModule(`
  export { registerEvents } from './src/events/index';
  export { registerCommands } from './src/commands/index';
  export { activate } from './src/index';
`);

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

    let changeListener;
    const origOnDidChange = vscode.workspace.onDidChangeConfiguration;
    vscode.workspace.onDidChangeConfiguration = listener => {
      changeListener = listener;
      return { dispose() {} };
    };

    try {
      registerEvents(mockProvider);
      assert.ok(changeListener);

      changeListener({ affectsConfiguration: key => key === 'zeta.other.key' });
      assert.equal(invalidated, false);
      assert.equal(refreshed, false);

      changeListener({ affectsConfiguration: key => key === 'zeta.list.folders' });
      assert.equal(invalidated, true);
      assert.equal(refreshed, true);

      invalidated = false;
      refreshed = false;
      changeListener({ affectsConfiguration: key => key === 'zeta.list.filterFolders' });
      assert.equal(invalidated, true);
      assert.equal(refreshed, true);
    } finally {
      vscode.workspace.onDidChangeConfiguration = origOnDidChange;
    }
  } finally {
    cleanup(ws);
  }
});

test('registerCommands: 注册表完整性', () => {
  const registered = [];
  const origRegisterCommand = vscode.commands.registerCommand;
  const origRegisterTextEditorCommand = vscode.commands.registerTextEditorCommand;

  vscode.commands.registerCommand = cmd => {
    registered.push(cmd);
    return { dispose() {} };
  };
  vscode.commands.registerTextEditorCommand = cmd => {
    registered.push(cmd);
    return { dispose() {} };
  };

  try {
    const disposables = registerCommands({ explorerProvider: { refresh() {} } });
    assert.equal(disposables.length, 19);

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
      'zeta.openResolvedImport',
      'zeta.folder.openInTerminal',
      'zeta.file.openInBrowser',
      'zeta.folder.openInWindow',
      'zeta.folder.openInNewWindow',
      'zeta.folder.runScript',
      'zeta.explorer.addFolder',
      'zeta.explorer.removeFolder',
      'zeta.explorer.refresh',
      'zeta.terminal.toggle',
    ];

    for (const cmd of expectedCommands) {
      assert.ok(registered.includes(cmd), `缺少命令注册: ${cmd}`);
    }
  } finally {
    vscode.commands.registerCommand = origRegisterCommand;
    vscode.commands.registerTextEditorCommand = origRegisterTextEditorCommand;
  }
});

test('activate: 扩展激活入口订阅挂载', () => {
  const subscriptions = [];
  const context = { subscriptions };

  const origCreateTreeView = vscode.window.createTreeView;
  const origExecuteCommand = vscode.commands.executeCommand;

  vscode.window.createTreeView = () => ({
    onDidChangeVisibility: () => ({ dispose() {} }),
    dispose() {},
  });
  vscode.commands.executeCommand = () => Promise.resolve();

  try {
    activate(context);
    assert.ok(subscriptions.length >= 8);
  } finally {
    vscode.window.createTreeView = origCreateTreeView;
    vscode.commands.executeCommand = origExecuteCommand;
  }
});
