import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, normalize } from 'node:path';
import { test } from 'node:test';
import { cleanup, loadModule, makeDocument, makeWorkspace, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const vscode = require(shimPath);
const { Position, Range } = vscode;

const { Editor, escapeRegExp, toNormalizePath, registerCommand } = await loadModule(`
  export { default as Editor } from './src/core/editor';
  export { escapeRegExp, toNormalizePath } from './src/core/strings';
  export { registerCommand, registerTextEditorCommand } from './src/core/command';
`);

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
    assert.equal(globalThis.__lastApply.length, 4);
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

test('registerCommand 捕获内部异常并弹出错误提示', async () => {
  let errorMessage = '';
  let registeredCallback;
  const origError = vscode.window.showErrorMessage;
  const origRegister = vscode.commands.registerCommand;

  vscode.window.showErrorMessage = async msg => {
    errorMessage = msg;
  };
  vscode.commands.registerCommand = (_cmd, callback) => {
    registeredCallback = callback;
    return { dispose() {} };
  };

  try {
    registerCommand('test.failCmd', () => {
      throw new Error('自定义致命错误');
    });

    assert.ok(registeredCallback);
    await registeredCallback();
    assert.ok(errorMessage.includes('自定义致命错误'));
  } finally {
    vscode.window.showErrorMessage = origError;
    vscode.commands.registerCommand = origRegister;
  }
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
    assert.equal(globalThis.__lastApply.length, 2);
    assert.equal(globalThis.__lastApply[0].text, 'X');
    assert.equal(globalThis.__lastApply[1].text, '');
  } finally {
    cleanup(ws);
  }
});
