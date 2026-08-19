import { registerCommand, registerTextEditorCommand } from '@/core/command';
import { default as Editor } from '@/core/editor';
import { escapeRegExp, toNormalizePath } from '@/core/strings';
import assert from 'node:assert/strict';
import { join, normalize } from 'node:path';
import { test, vi } from 'vitest';
import * as vscode from 'vscode';
import { cleanup, makeDocument, makeWorkspace, setConfig } from './helpers';

const { Position, Range } = vscode;

test('Editor 链式 insert / replace 与原子应用', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('hello world', join(ws, 'editor.txt'), 'text');
    const editor = new Editor(doc.uri);

    editor
      .insert(new Position(0, 0), 'start: ')
      .replace(new Range(new Position(0, 0), new Position(0, 5)), 'hi')
      .insert([new Position(0, 11)], ['!'])
      .replace(0, 6, 0, 11, 'zeta');

    globalThis.__lastApply = null;
    const ok = await editor.apply();
    assert.equal(ok, true);
    assert.equal(globalThis.__lastApply!.length, 4);
  } finally {
    cleanup(ws);
  }
});

test('escapeRegExp 正则元字符转义', () => {
  assert.equal(
    escapeRegExp('a.b*c+d?e^f$g(h)i[j]k{l}m|n\\o'),
    'a\\.b\\*c\\+d\\?e\\^f\\$g\\(h\\)i\\[j\\]k\\{l\\}m\\|n\\\\o'
  );
  assert.equal(escapeRegExp('normalText_123'), 'normalText_123');
});

test('toNormalizePath 路径标准化及盘符大写', () => {
  const posixPath = '/users/test/repo';
  assert.equal(toNormalizePath(posixPath), normalize(posixPath));
  assert.equal(toNormalizePath('c:\\project\\src'), 'C:\\project\\src');
});

/**
 * 执行被注册的命令并验证异常提示：捕获 showErrorMessage + console.error，
 * 断言弹窗与诊断日志均包含错误信息。registerCommand / registerTextEditorCommand 共用此样板。
 */
async function expectErrorNotification(run: () => Promise<void>, cmd: string, errorText: string): Promise<void> {
  let errorMessage = '';
  let consoleError = '';
  vi.spyOn(vscode.window, 'showErrorMessage').mockImplementation(
    async (msg: string): Promise<vscode.MessageItem | undefined> => {
      errorMessage = msg;
      return undefined;
    }
  );
  // 捕获注册包装内部的 console.error 诊断日志，避免测试输出出现告警式噪声，同时断言异常确被记录
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleError = args.map(a => String(a)).join(' ');
  });

  await run();
  assert.ok(errorMessage.includes(errorText), `应弹出包含异常信息的错误提示`);
  assert.ok(consoleError.includes(cmd), `诊断日志应包含命令名 ${cmd}`);
  assert.ok(consoleError.includes(errorText), `诊断日志应包含异常信息`);
}

test('registerCommand 捕获内部异常并弹出错误提示', async () => {
  let registeredCallback: (() => void) | undefined;
  vi.spyOn(vscode.commands, 'registerCommand').mockImplementation((_cmd: string, callback: () => void) => {
    registeredCallback = callback;
    return { dispose() {} };
  });

  registerCommand('test.failCmd', () => {
    throw new Error('自定义致命错误');
  });

  assert.ok(registeredCallback);
  await expectErrorNotification(
    async () => {
      await registeredCallback!();
    },
    'test.failCmd',
    '自定义致命错误'
  );
});

test('registerTextEditorCommand 捕获内部异常并弹出错误提示', async () => {
  let registeredCallback:
    | ((editor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: unknown[]) => unknown)
    | undefined;
  vi.spyOn(vscode.commands, 'registerTextEditorCommand').mockImplementation((_cmd: string, callback) => {
    registeredCallback = callback;
    return { dispose() {} };
  });

  registerTextEditorCommand('test.failEditorCmd', () => {
    throw new Error('文本编辑器命令异常');
  });

  assert.ok(registeredCallback);
  await expectErrorNotification(
    async () => {
      await registeredCallback!({} as unknown as vscode.TextEditor, {} as unknown as vscode.TextEditorEdit);
    },
    'test.failEditorCmd',
    '文本编辑器命令异常'
  );
});

test('Editor.apply 失败时发出警告提示', async () => {
  let warningMessage = '';
  vi.spyOn(vscode.window, 'showWarningMessage').mockImplementation(
    async (msg: string): Promise<vscode.MessageItem | undefined> => {
      warningMessage = msg;
      return undefined;
    }
  );
  vi.spyOn(vscode.workspace, 'applyEdit').mockResolvedValue(false);
  // 静默 apply 失败分支的 console.warn 诊断日志
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  const editor = new Editor(vscode.Uri.file('/dummy.ts'));
  editor.insert(new vscode.Position(0, 0), 'text');
  const result = await editor.apply();

  assert.equal(result, false);
  assert.ok(warningMessage.includes('编辑未应用'), 'applyEdit 返回 false 时应提示用户');
});

test('Editor 批量 replace 时 texts 短于 ranges 不抛错（缺失项回退空串）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('aabbcc', join(ws, 'batch.txt'), 'text');
    const editor = new Editor(doc.uri);

    editor.replace(
      [new Range(new Position(0, 0), new Position(0, 1)), new Range(new Position(0, 2), new Position(0, 3))],
      ['X']
    );

    globalThis.__lastApply = null;
    const ok = await editor.apply();
    assert.equal(ok, true);
    assert.equal(globalThis.__lastApply!.length, 2);
    assert.equal(globalThis.__lastApply![0].text, 'X');
    assert.equal(globalThis.__lastApply![1].text, '');
  } finally {
    cleanup(ws);
  }
});
