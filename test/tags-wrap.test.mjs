import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, editorWith, loadModule, makeDocument, makeWorkspace, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const vscode = require(shimPath);
const { Selection, Position } = vscode;

const { default: tagsWrap } = await loadModule(`
  export { default } from './src/commands/tags-wrap';
`);

function lastApply() {
  return globalThis.__lastApply ?? [];
}

test('tagsWrap: 空行插入 Snippet 镜像结构', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div' });
  try {
    const doc = makeDocument('', join(ws, 't1.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 0)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div}></$1>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 标签名配置带属性（如 div class="box"）闭标签名正确提取', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div class="card" id="main"' });
  try {
    const doc = makeDocument('content', join(ws, 't_attr.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 7)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div} class="card" id="main">content</$1>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 被包裹内容含有 Snippet 关键字（$、}、\\）时自动转义', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'span' });
  try {
    const doc = makeDocument('const price = `${cost}`;', join(ws, 't_escape.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 24)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:span}>const price = `\\${cost\\}`;</$1>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 非空行行尾整行下沉包裹', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div' });
  try {
    const doc = makeDocument('  hello', join(ws, 't2.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 7), new Position(0, 7)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '  <${1:div}>\n    hello\n  </$1>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 单行选区左右包裹', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'span' });
  try {
    const doc = makeDocument('hi', join(ws, 't3.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 2)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:span}>hi</$1>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 多行选区包裹并加深中间行缩进', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div' });
  try {
    const doc = makeDocument('a\nb\nc', join(ws, 't4.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(2, 1)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div}>\n  a\n  b\n  c\n</$1>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 多光标同时包裹生成递增 Tabstop', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'span' });
  try {
    const text = 'foo\nbar';
    const doc = makeDocument(text, join(ws, 't5.html'), 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 3)),
      new Selection(new Position(1, 0), new Position(1, 3)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:span}>foo</$1>\n<${2:span}>bar</$2>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 同行多选区及单行/多行交织包裹', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div' });
  try {
    const text = 'hello world\nsecond line\nthird line';
    const doc = makeDocument(text, join(ws, 't6.html'), 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 5)),
      new Selection(new Position(1, 0), new Position(2, 10)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.ok(ops[0].text.startsWith('<${1:div}>hello</$1> world\n<${2:div}>'));
    assert.ok(ops[0].text.endsWith('</$2>'));
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 同行中间空光标 + 行尾整行包裹', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div' });
  try {
    const text = '  hello world';
    const doc = makeDocument(text, join(ws, 't7.html'), 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 7), new Position(0, 7)),
      new Selection(new Position(0, 13), new Position(0, 13)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '  <${2:div}>\n    hello<${1:div}></$1> world\n  </$2>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 同行空光标 + 行尾整行包裹混合', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div' });
  try {
    const text = 'ab cd';
    const doc = makeDocument(text, join(ws, 't8.html'), 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 2), new Position(0, 2)),
      new Selection(new Position(0, 5), new Position(0, 5)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${2:div}>\n  ab<${1:div}></$1> cd\n</$2>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 多行包裹后后续行选区计入缩进位移', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div' });
  try {
    const text = 'line 1\nline 2\nline 3';
    const doc = makeDocument(text, join(ws, 't9.html'), 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(1, 6)),
      new Selection(new Position(1, 0), new Position(1, 6)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.ok(ops[0].text.includes('<${1:div}>'));
    assert.ok(ops[0].text.includes('<${2:div}>'));
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 多行选区末尾未到底且同行有其他选区', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div' });
  try {
    const text = 'x\nmid\ny end';
    const doc = makeDocument(text, join(ws, 't10.html'), 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(2, 1)),
      new Selection(new Position(2, 2), new Position(2, 5)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div}>\n  x\n  mid\n  y\n</$1> <${2:div}>end</$2>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 选中选区与空光标共存时两者均处理', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'span' });
  try {
    const text = 'foo\nbar';
    const doc = makeDocument(text, join(ws, 'wrap_mixed.html'), 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 3)),
      new Selection(new Position(1, 1), new Position(1, 1)),
    ]);

    globalThis.__lastApply = null;
    await tagsWrap(editor);

    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:span}>foo</$1>\nb<${2:span}></$2>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 配置的标签名含 Snippet 关键字（$）时转义', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div$' });
  try {
    const doc = makeDocument('content', join(ws, 't_dollar.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 7)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div\\$}>content</$1>');
  } finally {
    cleanup(ws);
  }
});

test('tagsWrap: 空白标签配置回退到 div', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': '   ' });
  try {
    const doc = makeDocument('content', join(ws, 't_blank.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 7)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div}>content</$1>');
  } finally {
    cleanup(ws);
  }
});
