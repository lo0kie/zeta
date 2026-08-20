import {
  copyAbsolutePath,
  copyRelativePath,
  createFile,
  createFolder,
  deleteEntry,
  renameEntry,
} from '@/explorer/actions';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, vi } from 'vitest';
import * as vscode from 'vscode';
import { cleanup, makeWorkspace, setConfig } from './helpers';

function setInput(value: string): void {
  vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue(value as never);
}

test('createFile: 在选中目录下新建文件并写入空内容', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const dir = join(ws, 'src');
    mkdirSync(dir, { recursive: true });
    setInput('hello.ts');
    await createFile(vscode.Uri.file(dir));

    const created = join(dir, 'hello.ts');
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(created));
    assert.equal(stat.type, vscode.FileType.File, '文件已创建');
  } finally {
    cleanup(ws);
  }
});

test('createFile: 文件名含 / 时自动创建父目录', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const dir = join(ws, 'src');
    mkdirSync(dir, { recursive: true });
    setInput('nested/deep/a.ts');
    await createFile(vscode.Uri.file(dir));

    const created = join(dir, 'nested', 'deep', 'a.ts');
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(created));
    assert.equal(stat.type, vscode.FileType.File, '多级父目录自动创建');
  } finally {
    cleanup(ws);
  }
});

test('createFolder: 在选中目录下新建文件夹', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const dir = join(ws, 'src');
    mkdirSync(dir, { recursive: true });
    setInput('components');
    await createFolder(vscode.Uri.file(dir));

    const created = join(dir, 'components');
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(created));
    assert.equal(stat.type, vscode.FileType.Directory, '文件夹已创建');
  } finally {
    cleanup(ws);
  }
});

test('renameEntry: 重命名文件', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const file = join(ws, 'old.ts');
    writeFileSync(file, '// old');
    setInput('new.ts');
    await renameEntry(vscode.Uri.file(file));

    const renamed = join(ws, 'new.ts');
    assert.ok(existsSync(renamed), '新文件已存在');
    assert.ok(!existsSync(file), '旧文件已不存在');
  } finally {
    cleanup(ws);
  }
});

test('deleteEntry: 确认后删除文件', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const file = join(ws, 'del.ts');
    writeFileSync(file, '// del');
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('删除' as never);
    await deleteEntry(vscode.Uri.file(file));

    assert.ok(!existsSync(file), '文件已删除');
  } finally {
    cleanup(ws);
  }
});

test('deleteEntry: 取消时不移除', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const file = join(ws, 'keep.ts');
    writeFileSync(file, '// keep');
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as never);
    await deleteEntry(vscode.Uri.file(file));

    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(file));
    assert.equal(stat.type, vscode.FileType.File, '取消删除保留文件');
  } finally {
    cleanup(ws);
  }
});

test('copyAbsolutePath / copyRelativePath: 写入剪贴板', async () => {
  const ws = makeWorkspace();
  setConfig({});
  (globalThis as any).__zetaWsRoot = ws;
  try {
    const file = join(ws, 'a', 'b.ts');
    mkdirSync(join(ws, 'a'), { recursive: true });
    writeFileSync(file, '// x');

    await copyAbsolutePath(vscode.Uri.file(file));
    assert.equal((globalThis as any).__zetaClipboard, file, '绝对路径');

    await copyRelativePath(vscode.Uri.file(file));
    assert.equal((globalThis as any).__zetaClipboard, join('a', 'b.ts'), '相对路径');
  } finally {
    cleanup(ws);
  }
});
