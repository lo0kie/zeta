import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, loadModule, makeWorkspace, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const vscode = require(shimPath);
const { Uri } = vscode;

const { runInTerminal, toggleTerminal, TerminalToggleStatusItem, openFolder, openInDefaultBrowser } = await loadModule(`
  export { runInTerminal, toggleTerminal } from './src/commands/terminal';
  export { TerminalToggleStatusItem } from './src/statusbar/terminal-toggle';
  export { openFolder, openInDefaultBrowser } from './src/commands/folder';
`);

test('runInTerminal 文件参数转目录、销毁同名终端并发送命令', async () => {
  const ws = makeWorkspace();
  const subDir = join(ws, 'work');
  mkdirSync(subDir, { recursive: true });
  const file = join(subDir, 'index.ts');
  writeFileSync(file, '');

  const logs = [];
  const origTerminals = vscode.window.terminals;
  const origCreate = vscode.window.createTerminal;

  vscode.window.terminals = [
    {
      name: 'zeta-term',
      dispose: () => logs.push('disposed-old'),
    },
  ];

  vscode.window.createTerminal = opts => {
    logs.push(`created: ${opts.name} at ${opts.cwd.fsPath}`);
    return {
      show: () => logs.push('shown'),
      sendText: cmd => logs.push(`run: ${cmd}`),
    };
  };

  try {
    await runInTerminal({
      cwd: Uri.file(file),
      name: 'zeta-term',
      commands: ['pnpm test', 'exit'],
      disposeSame: true,
      show: true,
    });

    assert.deepEqual(logs, ['disposed-old', `created: zeta-term at ${subDir}`, 'shown', 'run: pnpm test', 'run: exit']);
  } finally {
    vscode.window.terminals = origTerminals;
    vscode.window.createTerminal = origCreate;
    cleanup(ws);
  }
});

test('runInTerminal disposeSame 销毁全部同名终端（含残留多个）', async () => {
  const ws = makeWorkspace();
  const logs = [];
  const origTerminals = vscode.window.terminals;
  const origCreate = vscode.window.createTerminal;

  vscode.window.terminals = [
    { name: 'zeta-term', dispose: () => logs.push('d1') },
    { name: 'zeta-term', dispose: () => logs.push('d2') },
    { name: 'other-term', dispose: () => logs.push('d3') },
  ];
  vscode.window.createTerminal = () => ({ show: () => {}, sendText: () => {} });

  try {
    await runInTerminal({ name: 'zeta-term', disposeSame: true });
    assert.deepEqual(logs, ['d1', 'd2'], '同名终端全部销毁，不同名终端保留');
  } finally {
    vscode.window.terminals = origTerminals;
    vscode.window.createTerminal = origCreate;
    cleanup(ws);
  }
});

test('toggleTerminal 根据当前终端数量决定执行切换命令', async () => {
  const executed = [];
  const origExec = vscode.commands.executeCommand;
  const origTerminals = vscode.window.terminals;

  vscode.commands.executeCommand = async cmd => {
    executed.push(cmd);
  };

  try {
    vscode.window.terminals = [];
    await toggleTerminal();
    assert.equal(executed[0], 'workbench.action.terminal.toggleTerminal');

    vscode.window.terminals = [{}];
    await toggleTerminal();
    assert.equal(executed[1], 'workbench.action.togglePanel');
  } finally {
    vscode.commands.executeCommand = origExec;
    vscode.window.terminals = origTerminals;
  }
});

test('TerminalToggleStatusItem 数量展示与配置响应', () => {
  setConfig({ 'zeta.show.terminal': true });
  const origTerminals = vscode.window.terminals;
  const origCreateStatusBarItem = vscode.window.createStatusBarItem;

  vscode.window.terminals = [{}, {}];
  vscode.window.createStatusBarItem = () => ({
    text: '',
    tooltip: '',
    show() {},
    hide() {},
    dispose() {},
  });

  try {
    const item = new TerminalToggleStatusItem();
    assert.equal(item._item.text, '$(terminal) 2');
    assert.equal(item._item.tooltip, '切换终端显示（当前 2 个终端）');

    vscode.window.terminals = [];
    item.update();
    assert.equal(item._item.text, '$(terminal)');

    item.dispose();
    assert.equal(item._listeners.length, 0);
  } finally {
    vscode.window.terminals = origTerminals;
    vscode.window.createStatusBarItem = origCreateStatusBarItem;
  }
});

test('openFolder: 目录存在时调用 vscode.openFolder 命令', async () => {
  const ws = makeWorkspace();
  const targetDir = join(ws, 'target');
  mkdirSync(targetDir, { recursive: true });

  const executed = [];
  const origExec = vscode.commands.executeCommand;
  vscode.commands.executeCommand = async (cmd, ...args) => {
    executed.push({ cmd, args });
  };

  try {
    await openFolder(Uri.file(targetDir), true);
    assert.equal(executed[0].cmd, 'vscode.openFolder');
    assert.equal(executed[0].args[1], true);
  } finally {
    vscode.commands.executeCommand = origExec;
    cleanup(ws);
  }
});

test('openInDefaultBrowser: 仅对存在的文件调用 env.openExternal', async () => {
  const ws = makeWorkspace();
  const targetFile = join(ws, 'index.html');
  writeFileSync(targetFile, '');

  let openedUri = null;
  const origOpen = vscode.env.openExternal;
  vscode.env.openExternal = async uri => {
    openedUri = uri;
    return true;
  };

  try {
    await openInDefaultBrowser(Uri.file(targetFile));
    assert.equal(openedUri?.fsPath, targetFile);
  } finally {
    vscode.env.openExternal = origOpen;
    cleanup(ws);
  }
});
