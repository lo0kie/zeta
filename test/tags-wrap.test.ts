import { default as tagsWrap } from '@/commands/tags-wrap';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'vitest';
import * as vscode from 'vscode';
import { editorWith, makeDocument, setConfig } from './helpers';

const { Selection, Position } = vscode;

function lastApply() {
  return globalThis.__lastApply ?? [];
}

test('tagsWrap: 空行插入 Snippet 镜像结构', async () => {
  setConfig({ 'zeta.string.tag': 'div' });
  {
    const doc = makeDocument('', '/virtual/t1.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 0)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div} ${2}>${3}</$1>');
  }
});

test('tagsWrap: 标签名配置带属性（如 div class="box"）闭标签名正确提取', async () => {
  setConfig({ 'zeta.string.tag': 'div class="card" id="main"' });
  {
    const doc = makeDocument('content', '/virtual/t_attr.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 7)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div} class="card" id="main" ${2}>${3}content</$1>');
  }
});

test('tagsWrap: 配置尾随空格（如 "div "）不叠加多余空格、标签名后固定空格由 Tabstop 接管', async () => {
  setConfig({ 'zeta.string.tag': 'div ' });
  {
    const doc = makeDocument('content', '/virtual/t_trail.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 7)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    // 配置尾随空格被剥离；标签名后固定一个空格 + $2 属性位（Tab 从 $1 切到空格处）
    assert.equal(ops[0].text, '<${1:div} ${2}>${3}content</$1>');
  }
});

test('tagsWrap: 配置属性后带尾随空格时只剥离尾部、保留属性分隔空格', async () => {
  setConfig({ 'zeta.string.tag': 'div class="card" ' });
  {
    const doc = makeDocument('content', '/virtual/t_trail2.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 7)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div} class="card" ${2}>${3}content</$1>');
  }
});

test('tagsWrap: 被包裹内容含有 Snippet 关键字（$、}、\\）时自动转义', async () => {
  setConfig({ 'zeta.string.tag': 'span' });
  {
    const doc = makeDocument('const price = `${cost}`;', '/virtual/t_escape.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 24)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:span} ${2}>${3}const price = `\\${cost\\}`;</$1>');
  }
});

test('tagsWrap: 非空行行尾整行下沉包裹', async () => {
  setConfig({ 'zeta.string.tag': 'div' });
  {
    const doc = makeDocument('  hello', '/virtual/t2.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 7), new Position(0, 7)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '  <${1:div} ${2}>${3}\n    hello\n  </$1>');
  }
});

test('tagsWrap: 单行选区左右包裹', async () => {
  setConfig({ 'zeta.string.tag': 'span' });
  {
    const doc = makeDocument('hi', '/virtual/t3.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 2)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:span} ${2}>${3}hi</$1>');
  }
});

test('tagsWrap: 多行选区包裹并加深中间行缩进', async () => {
  setConfig({ 'zeta.string.tag': 'div' });
  {
    const doc = makeDocument('a\nb\nc', '/virtual/t4.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(2, 1)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div} ${2}>${3}\n  a\n  b\n  c\n</$1>');
  }
});

test('tagsWrap: 多行选区起点非行首（原缩进 8 空格）时开标签对齐、内容只加一级', async () => {
  setConfig({ 'zeta.string.tag': 'div' });
  {
    // 选区从 < 前（character 8，不含前导）开始；spanRange 必须覆盖行首前导，
    // 否则真机 VS Code 会把「插入位置前所在行的空白」二次叠加到 snippet 后续行
    const text = '        <text a></text>\n        <text b></text>';
    const doc = makeDocument(text, '/virtual/t_indent.vue', 'vue');
    const editor = editorWith(doc, new Selection(new Position(0, 8), new Position(1, text.split('\n')[1].length)), {
      insertSpaces: true,
      tabSize: 2,
    });
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    // 开标签 8 空格对齐原缩进，内容 10 空格（原 8 + 一级），闭标签 8 空格
    assert.equal(
      ops[0].text,
      '        <${1:div} ${2}>${3}\n          <text a></text>\n          <text b></text>\n        </$1>'
    );
  }
});

test('tagsWrap: 多光标同时包裹生成递增 Tabstop', async () => {
  setConfig({ 'zeta.string.tag': 'span' });
  {
    const text = 'foo\nbar';
    const doc = makeDocument(text, '/virtual/t5.html', 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 3)),
      new Selection(new Position(1, 0), new Position(1, 3)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:span} ${2}>${3}foo</$1>\n<${4:span} ${5}>${6}bar</$4>');
  }
});

test('tagsWrap: 同行多选区及单行/多行交织包裹', async () => {
  setConfig({ 'zeta.string.tag': 'div' });
  {
    const text = 'hello world\nsecond line\nthird line';
    const doc = makeDocument(text, '/virtual/t6.html', 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 5)),
      new Selection(new Position(1, 0), new Position(2, 10)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.ok(ops[0].text.startsWith('<${1:div} ${2}>${3}hello</$1> world\n<${4:div} ${5}>${6}'));
    assert.ok(ops[0].text.endsWith('</$4>'));
  }
});

test('tagsWrap: 同行中间空光标 + 行尾整行包裹', async () => {
  setConfig({ 'zeta.string.tag': 'div' });
  {
    const text = '  hello world';
    const doc = makeDocument(text, '/virtual/t7.html', 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 7), new Position(0, 7)),
      new Selection(new Position(0, 13), new Position(0, 13)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '  <${4:div} ${5}>${6}\n    hello<${1:div} ${2}>${3}</$1> world\n  </$4>');
  }
});

test('tagsWrap: 同行空光标 + 行尾整行包裹混合', async () => {
  setConfig({ 'zeta.string.tag': 'div' });
  {
    const text = 'ab cd';
    const doc = makeDocument(text, '/virtual/t8.html', 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 2), new Position(0, 2)),
      new Selection(new Position(0, 5), new Position(0, 5)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${4:div} ${5}>${6}\n  ab<${1:div} ${2}>${3}</$1> cd\n</$4>');
  }
});

test('tagsWrap: 多行包裹后后续行选区计入缩进位移', async () => {
  setConfig({ 'zeta.string.tag': 'div' });
  {
    const text = 'line 1\nline 2\nline 3';
    const doc = makeDocument(text, '/virtual/t9.html', 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(1, 6)),
      new Selection(new Position(1, 0), new Position(1, 6)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.ok(ops[0].text.includes('<${1:div} ${2}>${3}'));
    assert.ok(ops[0].text.includes('<${4:div} ${5}>${6}'));
  }
});

test('tagsWrap: 多行选区末尾未到底且同行有其他选区', async () => {
  setConfig({ 'zeta.string.tag': 'div' });
  {
    const text = 'x\nmid\ny end';
    const doc = makeDocument(text, '/virtual/t10.html', 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(2, 1)),
      new Selection(new Position(2, 2), new Position(2, 5)),
    ]);
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div} ${2}>${3}\n  x\n  mid\n  y\n</$1> <${4:div} ${5}>${6}end</$4>');
  }
});

test('tagsWrap: 选中选区与空光标共存时两者均处理', async () => {
  setConfig({ 'zeta.string.tag': 'span' });
  {
    const text = 'foo\nbar';
    const doc = makeDocument(text, '/virtual/wrap_mixed.html', 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 3)),
      new Selection(new Position(1, 1), new Position(1, 1)),
    ]);

    globalThis.__lastApply = null;
    await tagsWrap(editor);

    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:span} ${2}>${3}foo</$1>\nb<${4:span} ${5}>${6}</$4>');
  }
});

test('tagsWrap: 配置的标签名含 Snippet 关键字（$）时转义', async () => {
  setConfig({ 'zeta.string.tag': 'div$' });
  {
    const doc = makeDocument('content', '/virtual/t_dollar.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 7)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div\\$} ${2}>${3}content</$1>');
  }
});

test('tagsWrap: 空白标签配置回退到 div', async () => {
  setConfig({ 'zeta.string.tag': '   ' });
  {
    const doc = makeDocument('content', '/virtual/t_blank.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 7)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '<${1:div} ${2}>${3}content</$1>');
  }
});
