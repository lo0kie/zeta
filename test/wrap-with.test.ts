import { wrapWithConsole, wrapWithIf, wrapWithTryCatch } from '@/commands/wrap-with';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'vitest';
import * as vscode from 'vscode';
import { editorWith, makeDocument, setConfig } from './helpers';
const { Selection, Position } = vscode;

function lastApply() {
  return globalThis.__lastApply ?? [];
}

test('wrapWithConsole: 单选区生成 Snippet 并保留缩进', async () => {
  setConfig({});
  {
    const doc = makeDocument('  const foo = 123;  ', '/virtual/w1.js', 'javascript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 20)));
    globalThis.__lastApply = null;
    await wrapWithConsole(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '  console.log(${1:const foo = 123}, ${2})');
  }
});

test('wrapWithConsole: 多光标同时包裹生成连续 Tabstop', async () => {
  setConfig({});
  {
    const text = 'const a = 1;\nconst b = 2;';
    const doc = makeDocument(text, '/virtual/w2.js', 'javascript');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 6), new Position(0, 12)),
      new Selection(new Position(1, 6), new Position(1, 12)),
    ]);
    globalThis.__lastApply = null;
    await wrapWithConsole(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.ok(ops[0].text.includes('console.log(${1:a = 1}, ${2})'));
    assert.ok(ops[0].text.includes('console.log(${3:b = 2}, ${4})'));
  }
});

test('wrapWithTryCatch: 生成整行结构与 Tab 导航', async () => {
  setConfig({});
  {
    const doc = makeDocument('  const a = 1;', '/virtual/w3.js', 'javascript');
    const editor = editorWith(doc, new Selection(new Position(0, 2), new Position(0, 14)));
    globalThis.__lastApply = null;
    await wrapWithTryCatch(editor);
    const ops = lastApply();
    assert.equal(ops[0].range.start.character, 0);
    assert.ok(ops[0].text.includes('catch (${1:error})'));
    assert.ok(ops[0].text.includes('  try {\n    const a = 1;\n'));
  }
});

test('wrapWithTryCatch: 多光标生成成对 Tabstop', async () => {
  setConfig({});
  {
    const text = 'const a = 1;\nconst b = 2;';
    const doc = makeDocument(text, '/virtual/w4.js', 'javascript');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 12)),
      new Selection(new Position(1, 0), new Position(1, 12)),
    ]);
    globalThis.__lastApply = null;
    await wrapWithTryCatch(editor);
    const ops = lastApply();
    assert.ok(ops[0].text.includes('catch (${1:error})'));
    assert.ok(ops[0].text.includes('catch (${3:error})'));
  }
});

test('wrapWithIf: 生成条件判断并默认高亮 true', async () => {
  setConfig({});
  {
    const doc = makeDocument('  const a = 1;', '/virtual/w5.js', 'javascript');
    const editor = editorWith(doc, new Selection(new Position(0, 2), new Position(0, 14)));
    globalThis.__lastApply = null;
    await wrapWithIf(editor);
    const ops = lastApply();
    assert.equal(ops[0].range.start.character, 0);
    // body 首行缩进来自 indentBody，位于占位符内部（Tab 选中 body 时连缩进一起全选）
    assert.equal(ops[0].text, '  if (${1:true}) {\n${2:    const a = 1;}\n  }');
  }
});

test('wrapWithIf: 多光标生成连续 Tabstop', async () => {
  setConfig({});
  {
    const text = 'const a = 1;\nconst b = 2;';
    const doc = makeDocument(text, '/virtual/w6.js', 'javascript');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 12)),
      new Selection(new Position(1, 0), new Position(1, 12)),
    ]);
    globalThis.__lastApply = null;
    await wrapWithIf(editor);
    const ops = lastApply();
    assert.ok(ops[0].text.includes('if (${1:true})'));
    assert.ok(ops[0].text.includes('if (${3:true})'));
    // 每个选区 body 也带 tabstop（第 1 个 ${2}、第 2 个 ${4}），body 缩进在占位符内
    assert.ok(ops[0].text.includes('${2:  const a = 1;}'));
    assert.ok(ops[0].text.includes('${4:  const b = 2;}'));
  }
});

test('wrap-with: 空行选区放弃编辑', async () => {
  setConfig({});
  {
    const doc = makeDocument('a\n\nb', '/virtual/w7.js', 'javascript');
    const editor = editorWith(doc, new Selection(new Position(1, 0), new Position(1, 0)));
    globalThis.__lastApply = null;
    await wrapWithIf(editor);
    assert.equal(lastApply().length, 0);
  }
});

test('wrapWithConsole: 选中选区与空光标共存时仅包裹选中部分', async () => {
  setConfig({});
  {
    const text = 'const a = 1;\nconst b = 2;';
    const doc = makeDocument(text, '/virtual/wrap_console_mixed.js', 'javascript');

    const editor = editorWith(doc, [
      new Selection(new Position(0, 6), new Position(0, 11)), // 选中 a = 1
      new Selection(new Position(1, 3), new Position(1, 3)), // 空光标
    ]);

    globalThis.__lastApply = null;
    await wrapWithConsole(editor);

    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, 'console.log(${1:a = 1}, ${2})');
  }
});

test('wrapWithTryCatch: 选中选区与空光标共存时跳过空光标所在行', async () => {
  setConfig({});
  {
    const text = '  const a = 1;\n  const b = 2;';
    const doc = makeDocument(text, '/virtual/wrap_try_mixed.js', 'javascript');

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
  }
});
