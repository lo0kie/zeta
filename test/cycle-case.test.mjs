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

const { default: cycleCase } = await loadModule(`
  export { default } from './src/commands/cycle-case';
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

test('cycleQuotes: HTML 纯文本属性含自然语言撇号切换引号时转义为 HTML Entity', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `<input placeholder="Don't click" />`;
    const doc = makeDocument(text, join(ws, 'attr_apos.html'), 'html');
    const quoteIndex = text.indexOf('"Don\'t click"');
    const editor = editorWith(doc, new Selection(new Position(0, quoteIndex), new Position(0, quoteIndex)));

    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, `'Don&#39;t click'`);

    const doc2 = makeDocument(`<input placeholder='Don&#39;t click' />`, join(ws, 'attr_apos2.html'), 'html');
    const editor2 = editorWith(doc2, new Selection(new Position(0, quoteIndex), new Position(0, quoteIndex)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor2);
    assert.equal(lastApply()[0].text, `"Don't click"`);
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

test('cycleCase: 单字符样本在所有格式下无变化时不应用编辑', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case', 'Pascal Case', 'Snake Case', 'Constant Case'] });
  try {
    // 纯数字 '42'：所有格式输出均为 '42'，循环一圈无变化 → 不触发编辑
    const doc = makeDocument('42 bb', join(ws, 'cc2.ts'), 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 2)));
    globalThis.__lastApply = null;
    await cycleCase(editor);
    assert.equal(globalThis.__lastApply, null, '纯数字不应触发编辑');
  } finally {
    cleanup(ws);
  }
});

test('cycleCase: 跳过与样本相同的格式，落到第一个有变化的格式', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  try {
    // 'fooBar' 已是 Camel：从 Kebab 起找，Kebab 输出 'foo-bar' 有变化 → 应用
    const doc = makeDocument('fooBar x', join(ws, 'cc3.ts'), 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 6)));
    globalThis.__lastApply = null;
    await cycleCase(editor);
    assert.ok(globalThis.__lastApply, '多字符样本应触发编辑');
    assert.equal(lastApply()[0].text, 'foo-bar');
  } finally {
    cleanup(ws);
  }
});

test('cycleCase: 单字符小写字母在 Constant Case 下有变化则应用', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case', 'Pascal Case', 'Snake Case', 'Constant Case'] });
  try {
    // 'a' 在 Camel/Kebab/Pascal/Snake 下均为 'a'，但 Constant Case 输出 'A' → 循环跳过无变化格式后应用 'A'
    const doc = makeDocument('a bb', join(ws, 'cc1.ts'), 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 1)));
    globalThis.__lastApply = null;
    await cycleCase(editor);
    assert.ok(globalThis.__lastApply, '单字符存在有变化格式时应触发编辑');
    assert.equal(lastApply()[0].text, 'A');
  } finally {
    cleanup(ws);
  }
});

test('cycleCase: 无任何选区时直接返回不编辑', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  try {
    const doc = makeDocument('fooBar x', join(ws, 'cc4.ts'), 'typescript');
    const editor = editorWith(doc, []);
    globalThis.__lastApply = null;
    await cycleCase(editor);
    assert.equal(globalThis.__lastApply, null);
  } finally {
    cleanup(ws);
  }
});

test('cycleCase: 配置 cycleOrder 为空时不编辑', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.case.cycleOrder': [] });
  try {
    const doc = makeDocument('fooBar x', join(ws, 'cc5.ts'), 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 6)));
    globalThis.__lastApply = null;
    await cycleCase(editor);
    assert.equal(globalThis.__lastApply, null);
  } finally {
    cleanup(ws);
  }
});

test('cycleCase: 选区仅为空白时不编辑', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  try {
    const doc = makeDocument('   x', join(ws, 'cc6.ts'), 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 3)));
    globalThis.__lastApply = null;
    await cycleCase(editor);
    assert.equal(globalThis.__lastApply, null);
  } finally {
    cleanup(ws);
  }
});
