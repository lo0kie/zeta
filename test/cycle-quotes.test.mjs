import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, editorWith, loadModule, makeDocument, makeWorkspace, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const vscode = require(shimPath);
const { Selection, Position } = vscode;

const { default: cycleQuotes } = await loadModule(`
  export { default } from './src/commands/cycle-quotes';
`);

function lastApply() {
  return globalThis.__lastApply ?? [];
}

test('cycleQuotes: 普通单双引号与模板字符串三态循环', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'const a = \'hello\';\nconst b = "world";\nconst c = `zeta`;';
    const doc = makeDocument(text, join(ws, 'q1.ts'), 'typescript');

    const editor1 = editorWith(doc, new Selection(new Position(0, 12), new Position(0, 12)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor1);
    assert.equal(lastApply()[0].text, '"hello"');

    const editor2 = editorWith(doc, new Selection(new Position(1, 12), new Position(1, 12)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor2);
    assert.equal(lastApply()[0].text, '`world`');

    const editor3 = editorWith(doc, new Selection(new Position(2, 12), new Position(2, 12)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor3);
    assert.equal(lastApply()[0].text, "'zeta'");
  } finally {
    cleanup(ws);
  }
});

test('cycleQuotes: 拼接链自动合并为模板字符串', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'const s = "a" + "b";';
    const doc = makeDocument(text, join(ws, 'q2.ts'), 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 13), new Position(0, 13)), {});
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '`ab`');
  } finally {
    cleanup(ws);
  }
});

test('cycleQuotes: JS/Vue 对象字面量中的属性 Key 绝不转为反引号', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `const obj = { 'is-active': true };`;
    const doc = makeDocument(text, join(ws, 'obj.ts'), 'typescript');
    const quoteIndex = text.indexOf("'is-active'");
    const editor = editorWith(doc, new Selection(new Position(0, quoteIndex + 2), new Position(0, quoteIndex + 2)));

    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, '"is-active"');

    const doc2 = makeDocument(`const obj = { "is-active": true };`, join(ws, 'obj2.ts'), 'typescript');
    const editor2 = editorWith(doc2, new Selection(new Position(0, quoteIndex + 2), new Position(0, quoteIndex + 2)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor2);
    assert.equal(lastApply()[0].text, "'is-active'");
  } finally {
    cleanup(ws);
  }
});

test('cycleQuotes: Vue 动态指令属性值切换外层引号并反转内部冲突引号', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `<template><comp :formatter="val => 'CAPO ' + val" /></template>`;
    const doc = makeDocument(text, join(ws, 'q3.vue'), 'vue');
    const quoteIndex = text.indexOf('"val =>');
    const editor = editorWith(doc, new Selection(new Position(0, quoteIndex), new Position(0, quoteIndex)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, `'val => "CAPO " + val'`);
  } finally {
    cleanup(ws);
  }
});

test('cycleQuotes: 多行模板字符串转普通引号自动处理换行转义', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'const msg = `hello\nworld`;';
    const doc = makeDocument(text, join(ws, 'q4.ts'), 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 14), new Position(0, 14)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, "'hello\\nworld'");
  } finally {
    cleanup(ws);
  }
});

test('cycleQuotes: 选中选区与空光标共存时跳过未选中的空光标', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = "const a = 'hello';\nconst b = 'world';";
    const doc = makeDocument(text, join(ws, 'q_mixed.ts'), 'typescript');

    const editor = editorWith(
      doc,
      [
        new Selection(new Position(0, 10), new Position(0, 17)), // 完整选中 'hello'
        new Selection(new Position(1, 12), new Position(1, 12)), // 光标停在 'world' 内部
      ],
      {}
    );

    globalThis.__lastApply = null;
    await cycleQuotes(editor);

    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '"hello"');
  } finally {
    cleanup(ws);
  }
});
