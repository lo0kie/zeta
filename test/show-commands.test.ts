import { collectZetaCommands, default as showCommands } from '@/commands/show-commands';
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import * as vscode from 'vscode';

test('collectZetaCommands: 只提取 zeta. 前缀命令并带 title', () => {
  const meta = collectZetaCommands({
    contributes: {
      commands: [
        { command: 'zeta.editor.wrapTags', title: '插入标签' },
        { command: 'vscode.someCommand', title: '内置命令' },
        { command: 'zeta.folder.openInTerminal', title: '在终端打开' },
        { command: 'zeta.noTitle' },
      ],
    },
  });
  assert.deepEqual(meta, [
    { id: 'zeta.editor.wrapTags', title: '插入标签' },
    { id: 'zeta.folder.openInTerminal', title: '在终端打开' },
    { id: 'zeta.noTitle', title: 'zeta.noTitle' },
  ]);
});

test('showCommands: 从扩展清单收集命令，QuickPick 选中后执行对应命令', async () => {
  let executed: string | null = null;
  let quickPickItems: vscode.QuickPickItem[] = [];

  vi.spyOn(vscode.extensions, 'all', 'get').mockReturnValue([
    { packageJSON: { contributes: { commands: [{ command: 'zeta.editor.changeCase', title: '修改单词格式' }] } } },
    { packageJSON: { contributes: { commands: [{ command: 'other.ext.cmd', title: '无关' }] } } },
  ] as unknown as readonly vscode.Extension<unknown>[]);

  vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(
    async (
      items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>
    ): Promise<vscode.QuickPickItem | undefined> => {
      quickPickItems = [...(await items)];
      return (await items)[0];
    }
  );
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (id: string): Promise<unknown> => {
    executed = id;
    return undefined;
  });

  await showCommands();

  assert.equal(quickPickItems.length, 1, '只收集 zeta 命令');
  assert.equal(quickPickItems[0].detail, 'zeta.editor.changeCase');
  assert.equal(executed, 'zeta.editor.changeCase', '选中后执行对应命令');
});

test('showCommands: QuickPick 取消（ESC）时不执行任何命令', async () => {
  let executed = false;
  vi.spyOn(vscode.extensions, 'all', 'get').mockReturnValue([
    { packageJSON: { contributes: { commands: [{ command: 'zeta.editor.changeCase', title: '修改单词格式' }] } } },
  ] as unknown as readonly vscode.Extension<unknown>[]);
  vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(async () => undefined);
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (): Promise<unknown> => {
    executed = true;
    return undefined;
  });

  await showCommands();

  assert.equal(executed, false, '取消选择不应触发命令执行');
});
