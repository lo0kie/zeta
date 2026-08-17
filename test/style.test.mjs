import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, loadModule, makeDocument, makeWorkspace, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { Uri } = require(shimPath);

const { StyleCompletionProvider, collectImportedSymbols, collectImportedFiles, clearStyleFileCache } =
  await loadModule(`
  export {
    StyleCompletionProvider,
    collectImportedSymbols,
    collectImportedFiles,
    clearStyleFileCache,
  } from './src/providers/style-completion';
`);

test('Less 递归嵌套 @import 解析（最多 3 层并防循环引用）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app');
    mkdirSync(app, { recursive: true });

    writeFileSync(join(app, 'c.less'), '@c-var: #333;\n');
    writeFileSync(join(app, 'b.less'), '@import "./c";\n@b-var: #222;\n');
    writeFileSync(join(app, 'a.less'), '@import "./b";\n@a-var: #111;\n');

    const doc = makeDocument('@import "./a";\n', join(app, 'main.less'), 'less');
    const files = await collectImportedFiles(doc);
    assert.equal(files.length, 3);

    const symbols = await collectImportedSymbols(doc);
    assert.ok(symbols.some(s => s.name === '@a-var'));
    assert.ok(symbols.some(s => s.name === '@b-var'));
    assert.ok(symbols.some(s => s.name === '@c-var'));
  } finally {
    cleanup(ws);
  }
});

test('Vue SFC 多 <style> 块不同语言解析隔离', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `
<template><div></div></template>
<style lang="less">
  @less-color: #1890ff;
  .box-less(@w: 10px) { width: @w; }
</style>
<style lang="scss">
  $scss-color: #ff4d4f;
  @mixin box-scss($h: 20px) { height: $h; }
</style>
<style>
  --css-var: #000;
</style>
`;
    const doc = makeDocument(text, join(ws, 'multi.vue'), 'vue');
    const symbols = await collectImportedSymbols(doc);

    assert.ok(symbols.some(s => s.name === '@less-color' && s.kind === 'variable'));
    assert.ok(symbols.some(s => s.name === '.box-less' && s.kind === 'mixin'));
    assert.ok(symbols.some(s => s.name === '$scss-color' && s.kind === 'scss-variable'));
    assert.ok(symbols.some(s => s.name === '@box-scss' && s.kind === 'scss-mixin'));
    assert.ok(symbols.some(s => s.name === '--css-var' && s.kind === 'css-variable'));
  } finally {
    cleanup(ws);
  }
});

test('Mixin 复杂参数：带逗号的字符串与分号分隔符', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const less = `
.custom-btn(@label: "hello, world", @color: #fff) { content: @label; }
.box-border(@w: 1px; @c: #000) { border: @w solid @c; }
`;
    const doc = makeDocument(less, join(ws, 'complex.less'), 'less');
    const symbols = await collectImportedSymbols(doc);

    const btn = symbols.find(s => s.name === '.custom-btn');
    assert.ok(btn);
    assert.equal(btn.snippet, '.custom-btn(${1:@label: "hello, world"}, ${2:@color: #fff});');

    const border = symbols.find(s => s.name === '.box-border');
    assert.ok(border);
    assert.equal(border.snippet, '.box-border(${1:@w: 1px}, ${2:@c: #000});');
  } finally {
    cleanup(ws);
  }
});

test('Mixin 补全：光标后已有分号时自动移除 Snippet 末尾分号', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'm.less'), '.btn(@size: 12px) { font-size: @size; }\n');

    const text = '@import "./m";\n.a { .btn; }\n';
    const doc = makeDocument(text, join(app, 'main.less'), 'less');
    const provider = new StyleCompletionProvider();

    const line1 = text.split('\n')[1];
    const triggerPos = { line: 1, character: line1.indexOf('.btn') + 4 };
    const items = (await provider.provideCompletionItems(doc, triggerPos)) ?? [];

    const btnItem = items.find(i => i.label === '.btn');
    assert.ok(btnItem);
    assert.equal(btnItem.insertText.value, '.btn(${1:@size: 12px})');
  } finally {
    cleanup(ws);
  }
});

test('Mixin 参数值字符串内含分号时仍按顶层逗号分隔', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const less = `
.semi(@a: "x;y", @b: 2) { content: @a; }
`;
    const doc = makeDocument(less, join(ws, 'semi.less'), 'less');
    const symbols = await collectImportedSymbols(doc);

    const semi = symbols.find(s => s.name === '.semi');
    assert.ok(semi);
    // 字符串内的 ; 不参与分隔符判定：顶层逗号分隔，两个参数分别生成 tabstop
    assert.equal(semi.snippet, '.semi(${1:@a: "x;y"}, ${2:@b: 2});');
  } finally {
    cleanup(ws);
  }
});

test('保存被导入文件后引用方缓存失效', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'app'), { recursive: true });
    const themePath = join(ws, 'app', 'theme.less');
    const mainPath = join(ws, 'app', 'main.less');
    writeFileSync(themePath, '@c: #111;\n');
    const doc = makeDocument('@import "./theme";\n.a { color: @c; }\n', mainPath, 'less', 5);

    assert.equal((await collectImportedSymbols(doc)).find(s => s.name === '@c')?.value, '#111');

    writeFileSync(themePath, '@c: #222;\n');
    clearStyleFileCache(Uri.file(themePath));

    assert.equal((await collectImportedSymbols(doc)).find(s => s.name === '@c')?.value, '#222');
  } finally {
    cleanup(ws);
  }
});
