// 样式补全：Less/SCSS 门控、partial 解析、@use 导入、保存后失效
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadModule, makeWorkspace, setConfig, cleanup, makeDocument, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { Uri } = require(shimPath);

const { StyleCompletionProvider, collectImportedSymbols, clearStyleFileCache } = await loadModule(`
  export { StyleCompletionProvider, collectImportedSymbols, clearStyleFileCache } from './src/providers/style-completion';
`);

test('SCSS：@use + partial 变量/mixin 补全', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'app'), { recursive: true });
    writeFileSync(
      join(ws, 'app', '_vars.scss'),
      `$primary-color: #1890ff;\n@mixin flex($dir: row) { display: flex; }\n`
    );
    const text = `@use "./vars";\n.a { color: $prim; @inc }\n`;
    const doc = makeDocument(text, join(ws, 'app', 'm.scss'), 'scss');

    const syms = await collectImportedSymbols(doc);
    assert.ok(syms.some(s => s.name === '$primary-color' && s.kind === 'scss-variable'), 'partial 变量解析');
    assert.ok(syms.some(s => s.name === '@flex' && s.kind === 'scss-mixin'), 'partial mixin 解析');

    const provider = new StyleCompletionProvider();
    const line1 = text.split('\n')[1];
    const dollarItems = (await provider.provideCompletionItems(doc, { line: 1, character: line1.indexOf('$prim') + 5 })) ?? [];
    assert.deepEqual(dollarItems.map(i => i.label), ['$primary-color']);
    const atItems = (await provider.provideCompletionItems(doc, { line: 1, character: line1.indexOf('@inc') + 4 })) ?? [];
    assert.deepEqual(atItems.map(i => i.label), ['@flex']);
    assert.equal(atItems[0].insertText.value, '@include flex(${1:$dir: row});');
  } finally {
    cleanup(ws);
  }
});

test('Less：变量与 mixin 门控（css 文件不产 Less 符号）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'app'), { recursive: true });
    writeFileSync(join(ws, 'app', 'mixins.less'), `@primary: #1890ff;\n.bordered(@w: 1px) { border: 1px solid; }\n`);
    const text = `@import "./mixins";\n.a { color: @prim; }\n`;
    const doc = makeDocument(text, join(ws, 'app', 'm.less'), 'less');
    const syms = await collectImportedSymbols(doc);
    assert.ok(syms.some(s => s.name === '@primary' && s.kind === 'variable'));
    assert.ok(syms.some(s => s.name === '.bordered' && s.kind === 'mixin'));
    assert.equal(syms.find(s => s.name === '.bordered').snippet, '.bordered(${1:@w: 1px});');
  } finally {
    cleanup(ws);
  }
});

test('保存被导入文件后，引用方（同 version）重新收集', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'app'), { recursive: true });
    const themePath = join(ws, 'app', 'theme.less');
    const mainPath = join(ws, 'app', 'main.less');
    writeFileSync(themePath, `@c: #111;\n`);
    const doc = makeDocument(`@import "./theme";\n.a { color: @c; }\n`, mainPath, 'less', 5);

    assert.equal((await collectImportedSymbols(doc)).find(s => s.name === '@c')?.value, '#111');

    // 模拟保存 theme.less（磁盘改内容 + 触发失效回调，传被保存文件的 uri）
    writeFileSync(themePath, `@c: #222;\n`);
    clearStyleFileCache(Uri.file(themePath));

    // 引用方 version 未变，必须拿到新值（旧实现会命中缓存返回 #111）
    assert.equal((await collectImportedSymbols(doc)).find(s => s.name === '@c')?.value, '#222');
  } finally {
    cleanup(ws);
  }
});
