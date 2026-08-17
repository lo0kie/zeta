import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, editorWith, loadModule, makeDocument, makeWorkspace, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const vscode = require(shimPath);
const { Selection, Position } = vscode;

const { wrapWithConsole, wrapWithTryCatch, wrapWithIf } = await loadModule(`
  export { wrapWithConsole, wrapWithTryCatch, wrapWithIf } from './src/commands/wrap-with';
`);

function lastApply() {
  return globalThis.__lastApply ?? [];
}

test('wrapWithConsole: 单选区生成 Snippet 并保留缩进', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('  const foo = 123;  ', join(ws, 'w1.js'), 'javascript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 20)));
    globalThis.__lastApply = null;
    await wrapWithConsole(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '  console.log(const foo = 123$1)');
  } finally {
    cleanup(ws);
  }
});

test('wrapWithConsole: 多光标同时包裹生成连续 Tabstop', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'const a = 1;\nconst b = 2;';
    const doc = makeDocument(text, join(ws, 'w2.js'), 'javascript');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 6), new Position(0, 12)),
      new Selection(new Position(1, 6), new Position(1, 12)),
    ]);
    globalThis.__lastApply = null;
    await wrapWithConsole(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.ok(ops[0].text.includes('console.log(a = 1$1)'));
    assert.ok(ops[0].text.includes('console.log(b = 2$2)'));
  } finally {
    cleanup(ws);
  }
});

test('wrapWithTryCatch: 生成整行结构与 Tab 导航', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('  const a = 1;', join(ws, 'w3.js'), 'javascript');
    const editor = editorWith(doc, new Selection(new Position(0, 2), new Position(0, 14)));
    globalThis.__lastApply = null;
    await wrapWithTryCatch(editor);
    const ops = lastApply();
    assert.equal(ops[0].range.start.character, 0);
    assert.ok(ops[0].text.includes('catch (${1:error})'));
    assert.ok(ops[0].text.includes('  try {\n    const a = 1;\n'));
  } finally {
    cleanup(ws);
  }
});

test('wrapWithTryCatch: 多光标生成成对 Tabstop', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'const a = 1;\nconst b = 2;';
    const doc = makeDocument(text, join(ws, 'w4.js'), 'javascript');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 12)),
      new Selection(new Position(1, 0), new Position(1, 12)),
    ]);
    globalThis.__lastApply = null;
    await wrapWithTryCatch(editor);
    const ops = lastApply();
    assert.ok(ops[0].text.includes('catch (${1:error})'));
    assert.ok(ops[0].text.includes('catch (${3:error})'));
  } finally {
    cleanup(ws);
  }
});

test('wrapWithIf: 生成条件判断并默认高亮 true', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('  const a = 1;', join(ws, 'w5.js'), 'javascript');
    const editor = editorWith(doc, new Selection(new Position(0, 2), new Position(0, 14)));
    globalThis.__lastApply = null;
    await wrapWithIf(editor);
    const ops = lastApply();
    assert.equal(ops[0].range.start.character, 0);
    assert.equal(ops[0].text, '  if (${1:true}) {\n    const a = 1;\n  }');
  } finally {
    cleanup(ws);
  }
});

test('wrapWithIf: 多光标生成连续 Tabstop', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'const a = 1;\nconst b = 2;';
    const doc = makeDocument(text, join(ws, 'w6.js'), 'javascript');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 12)),
      new Selection(new Position(1, 0), new Position(1, 12)),
    ]);
    globalThis.__lastApply = null;
    await wrapWithIf(editor);
    const ops = lastApply();
    assert.ok(ops[0].text.includes('if (${1:true})'));
    assert.ok(ops[0].text.includes('if (${2:true})'));
  } finally {
    cleanup(ws);
  }
});

test('wrap-with: 空行选区放弃编辑', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('a\n\nb', join(ws, 'w7.js'), 'javascript');
    const editor = editorWith(doc, new Selection(new Position(1, 0), new Position(1, 0)));
    globalThis.__lastApply = null;
    await wrapWithIf(editor);
    assert.equal(lastApply().length, 0);
  } finally {
    cleanup(ws);
  }
});

test('wrapWithConsole: 选中选区与空光标共存时仅包裹选中部分', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'const a = 1;\nconst b = 2;';
    const doc = makeDocument(text, join(ws, 'wrap_console_mixed.js'), 'javascript');

    const editor = editorWith(doc, [
      new Selection(new Position(0, 6), new Position(0, 11)), // 选中 a = 1
      new Selection(new Position(1, 3), new Position(1, 3)), // 空光标
    ]);

    globalThis.__lastApply = null;
    await wrapWithConsole(editor);

    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, 'console.log(a = 1$1)');
  } finally {
    cleanup(ws);
  }
});

test('wrapWithTryCatch: 选中选区与空光标共存时跳过空光标所在行', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = '  const a = 1;\n  const b = 2;';
    const doc = makeDocument(text, join(ws, 'wrap_try_mixed.js'), 'javascript');

    const editor = editorWith(doc, [
      new Selection(new Position(0, 2), new Position(0, 14)), // 选中第 0 行语句
      new Selection(new Position(1, 5), new Position(1, 5)), // 第 1 行空光标
    ]);

    globalThis.__lastApply = null;
    await wrapWithTryCatch(editor);

    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.ok(ops[0].text.includes('try {\n    const a = 1;\n  } catch'));
    assert.ok(!ops[0].text.includes('const b = 2'));
  } finally {
    cleanup(ws);
  }
});
