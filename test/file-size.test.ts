import { FileSizeStatusItem, formatBytes } from '@/statusbar/file-size';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test, vi } from 'vitest';
import * as vscode from 'vscode';
import { cleanup, makeWorkspace, setConfig } from './helpers';

const { Uri } = vscode;

test('formatBytes 各种量级格式化', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(formatBytes(3.5 * 1024 * 1024), '3.5 MB');
  assert.equal(formatBytes(1.2 * 1024 * 1024 * 1024), '1.2 GB');
  assert.equal(formatBytes(-1), '');
});

test('FileSizeStatusItem 显示当前文件磁盘大小，无 command/tooltip', async () => {
  const ws = makeWorkspace();
  setConfig({});
  let captured: vscode.StatusBarItem | undefined;
  vi.spyOn(vscode.window, 'createStatusBarItem').mockImplementation(
    () =>
      (captured = {
        text: '',
        tooltip: '',
        name: '',
        command: '',
        show() {},
        hide() {},
        dispose() {},
      } as unknown as vscode.StatusBarItem)
  );

  const file = join(ws, 'data.txt');
  vi.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue({ size: 2048 } as vscode.FileStat);
  vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue({
    document: { uri: Uri.file(file) },
  } as unknown as vscode.TextEditor);

  const item = new FileSizeStatusItem();
  try {
    await item.update();
    assert.equal(captured!.text, '2 KB');
    assert.equal(captured!.tooltip, '', '无 hover（tooltip 为空）');
    assert.equal(captured!.command, '', '无点击事件（command 为空）');
  } finally {
    item.dispose();
    cleanup(ws);
  }
});

test('FileSizeStatusItem untitled 文件不显示', async () => {
  let captured: vscode.StatusBarItem | undefined;
  const hidden: string[] = [];
  vi.spyOn(vscode.window, 'createStatusBarItem').mockImplementation(
    () =>
      (captured = {
        text: '',
        tooltip: '',
        name: '',
        command: '',
        show() {},
        hide() {
          hidden.push('hide');
        },
        dispose() {},
      } as unknown as vscode.StatusBarItem)
  );

  // untitled：uri scheme 为 untitled → 直接隐藏
  const untitledUri = Uri.parse('untitled:Untitled-1');
  vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue({
    document: { uri: untitledUri },
  } as unknown as vscode.TextEditor);

  const item = new FileSizeStatusItem();
  try {
    await item.update();
    assert.ok(hidden.length >= 1, 'untitled 文件应调用 hide');
  } finally {
    item.dispose();
  }
});
