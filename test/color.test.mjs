// 颜色选择器：hex/rgb、模板字符串 ${} 屏蔽、注释与正则跳过、vue 门控、fast-path、写回格式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadModule, makeWorkspace, setConfig, cleanup, makeDocument, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { Color } = require(shimPath);

const { StyleColorProvider } = await loadModule(`export { StyleColorProvider } from './src/providers/style-color';`);

const colorTuple = c => [c.red, c.green, c.blue, c.alpha].map(v => Number(v.toFixed(3)));

test('JS 字符串 hex 与 rgb：range 指向字符串内', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `const a = '#ff0000';\nconst b = "rgb(0, 255, 0)";\n`;
    const doc = makeDocument(text, join(ws, 'a.js'), 'javascript');
    const colors = new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 2);
    assert.deepEqual(colorTuple(colors[0].color), [1, 0, 0, 1]);
    assert.deepEqual(colorTuple(colors[1].color), [0, 1, 0, 1]);
    const start = text.indexOf("'#ff0000'");
    assert.deepEqual([colors[0].range.start.character, colors[0].range.end.character], [start + 1, start + 8]);
  } finally {
    cleanup(ws);
  }
});

test('模板字符串：${} 屏蔽但静态色值保留', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'const s = `color: #ff0000; width: ${w}px;`;';
    const doc = makeDocument(text, join(ws, 't.js'), 'javascript');
    const colors = new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 1, '含 ${} 的模板静态色值不丢');
    assert.deepEqual(colorTuple(colors[0].color), [1, 0, 0, 1]);
    const at = text.indexOf('#ff0000');
    assert.deepEqual([colors[0].range.start.character, colors[0].range.end.character], [at, at + 7], '偏移准确');
  } finally {
    cleanup(ws);
  }
});

test('注释与正则字面量跳过、非 hex 词不误报', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `// #fff\n/* #000 */\nconst re = /^#abc$/;\nconst id = '#main';\nconst ok = '#abcdef';\n`;
    const doc = makeDocument(text, join(ws, 'c.js'), 'javascript');
    const colors = new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 1);
    assert.deepEqual(colorTuple(colors[0].color), [0.671, 0.804, 0.937, 1]);
  } finally {
    cleanup(ws);
  }
});

test('vue：仅 style 块 + 去重（块扫描与字符串扫描同范围）', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `<template><div :style="{ color: '#00ff00' }">x</div></template>\n<style>.a { color: #ff0000; content: "#00ff00"; }</style>\n`;
    const doc = makeDocument(text, join(ws, 'v.vue'), 'vue');
    const colors = new StyleColorProvider().provideDocumentColors(doc);
    // template '#00ff00'（字符串）、style 块 #ff0000、style 块字符串 "#00ff00"（去重）
    assert.equal(colors.length, 3);
  } finally {
    cleanup(ws);
  }
});

test('fast-path：无任何色值标记的大文件直接返回空', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = Array.from({ length: 6000 }, (_, i) => `const x${i} = ${i} * 2;`).join('\n');
    const doc = makeDocument(text, join(ws, 'big.js'), 'javascript');
    assert.equal(new StyleColorProvider().provideDocumentColors(doc).length, 0);
  } finally {
    cleanup(ws);
  }
});

test('写回格式：不透明 → 6 位 hex + rgb；带 alpha → 8 位 hex + rgba', () => {
  const provider = new StyleColorProvider();
  assert.deepEqual(
    provider.provideColorPresentations(new Color(1, 0, 0, 1), {}).map(p => p.label),
    ['#ff0000', 'rgb(255, 0, 0)']
  );
  assert.deepEqual(
    provider.provideColorPresentations(new Color(1, 0, 0, 0.5), {}).map(p => p.label),
    ['#ff000080', 'rgba(255, 0, 0, 0.5)']
  );
});
