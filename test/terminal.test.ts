import { openFolder, openInDefaultBrowser } from '@/commands/folder';
import { runInTerminal, toggleTerminal } from '@/commands/terminal';
import { TerminalToggleStatusItem } from '@/statusbar/terminal-toggle';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, vi } from 'vitest';
import * as vscode from 'vscode';
import { cleanup, makeWorkspace, setConfig } from './helpers';

const { Uri } = vscode;

test('runInTerminal 文件参数转目录、销毁同名终端并发送命令', async () => {
  const ws = makeWorkspace();
  const subDir = join(ws, 'work');
  mkdirSync(subDir, { recursive: true });
  const file = join(subDir, 'index.ts');
  writeFileSync(file, '');

  const logs: string[] = [];
  vi.spyOn(vscode.window, 'terminals', 'get').mockReturnValue([
    { name: 'zeta-term', dispose: () => logs.push('disposed-old') },
  ] as unknown as vscode.Terminal[]);
  vi.spyOn(vscode.window, 'createTerminal').mockImplementation((opts?: vscode.TerminalOptions) => {
    const o = opts as { name?: string; cwd?: vscode.Uri };
    logs.push(`created: ${o.name} at ${o.cwd?.fsPath}`);
    return {
      show: () => logs.push('shown'),
      sendText: (cmd: string) => logs.push(`run: ${cmd}`),
    } as unknown as vscode.Terminal;
  });

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
    cleanup(ws);
  }
});

test('runInTerminal disposeSame 销毁全部同名终端（含残留多个）', async () => {
  const ws = makeWorkspace();
  const logs: string[] = [];
  vi.spyOn(vscode.window, 'terminals', 'get').mockReturnValue([
    { name: 'zeta-term', dispose: () => logs.push('d1') },
    { name: 'zeta-term', dispose: () => logs.push('d2') },
    { name: 'other-term', dispose: () => logs.push('d3') },
  ] as unknown as vscode.Terminal[]);
  vi.spyOn(vscode.window, 'createTerminal').mockImplementation(
    () => ({ show: () => {}, sendText: () => {} }) as unknown as vscode.Terminal
  );

  try {
    await runInTerminal({ name: 'zeta-term', disposeSame: true });
    assert.deepEqual(logs, ['d1', 'd2'], '同名终端全部销毁，不同名终端保留');
  } finally {
    cleanup(ws);
  }
});

test('toggleTerminal 根据当前终端数量决定执行切换命令', async () => {
  const executed: string[] = [];
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (cmd: string, ..._rest: unknown[]) => {
    executed.push(cmd);
  });
  const termSpy = vi.spyOn(vscode.window, 'terminals', 'get');

  termSpy.mockReturnValue([] as unknown as vscode.Terminal[]);
  await toggleTerminal();
  assert.equal(executed[0], 'workbench.action.terminal.toggleTerminal');

  termSpy.mockReturnValue([{}] as unknown as vscode.Terminal[]);
  await toggleTerminal();
  assert.equal(executed[1], 'workbench.action.togglePanel');
});

test('TerminalToggleStatusItem 数量展示与配置响应', () => {
  setConfig({ 'zeta.show.terminal': true });
  const termSpy = vi.spyOn(vscode.window, 'terminals', 'get');
  termSpy.mockReturnValue([{}, {}] as unknown as vscode.Terminal[]);
  vi.spyOn(vscode.window, 'createStatusBarItem').mockImplementation(
    () =>
      ({
        text: '',
        tooltip: '',
        show() {},
        hide() {},
        dispose() {},
      }) as unknown as vscode.StatusBarItem
  );

  const item = new TerminalToggleStatusItem() as unknown as {
    _item: { text: string; tooltip: string };
    _listeners: unknown[];
    update(): void;
    dispose(): void;
  };
  assert.equal(item._item.text, '$(terminal) 2');
  assert.equal(item._item.tooltip, '切换终端显示（当前 2 个终端）');

  termSpy.mockReturnValue([] as unknown as vscode.Terminal[]);
  item.update();
  assert.equal(item._item.text, '$(terminal)');

  item.dispose();
  assert.equal(item._listeners.length, 0);
});

test('openFolder: 目录存在时调用 vscode.openFolder 命令', async () => {
  const ws = makeWorkspace();
  const targetDir = join(ws, 'target');
  mkdirSync(targetDir, { recursive: true });

  const executed: Array<{ cmd: string; args: unknown[] }> = [];
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (cmd, ...args) => {
    executed.push({ cmd, args });
  });

  try {
    await openFolder(Uri.file(targetDir), true);
    assert.equal(executed[0].cmd, 'vscode.openFolder');
    assert.equal(executed[0].args[1], true);
  } finally {
    cleanup(ws);
  }
});

test('openInDefaultBrowser: 仅对存在的文件调用 env.openExternal', async () => {
  const ws = makeWorkspace();
  const targetFile = join(ws, 'index.html');
  writeFileSync(targetFile, '');

  const openedUris: vscode.Uri[] = [];
  vi.spyOn(vscode.env, 'openExternal').mockImplementation(async (uri: vscode.Uri) => {
    openedUris.push(uri);
    return true;
  });

  try {
    await openInDefaultBrowser(Uri.file(targetFile));
    assert.equal(openedUris[0]?.fsPath, targetFile);
  } finally {
    cleanup(ws);
  }
});
