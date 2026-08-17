import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule, makeDocument, setConfig } from './helpers.mjs';

const { StyleSemanticTokensProvider } = await loadModule(`
  export { StyleSemanticTokensProvider } from './src/providers/style-semantic-tokens';
`);

test('StyleSemanticTokensProvider: 提取 var() 内部 CSS 变量 token 并忽略注释内的伪调用', () => {
  setConfig({});
  const provider = new StyleSemanticTokensProvider();
  const css = `
    // var(--commented-1)
    /* var(--commented-2) */
    .btn {
      color: var(--color-primary);
      background: var(--bg-main);
    }
  `;
  const doc = makeDocument(css, 'test.css', 'css');

  const tokens = provider.provideDocumentSemanticTokens(doc);
  assert.ok(tokens);
  assert.equal(tokens.data.length, 2);
  assert.equal(tokens.data[0].length, '--color-primary'.length);
  assert.equal(tokens.data[1].length, '--bg-main'.length);
});

test('StyleSemanticTokensProvider: Vue SFC 仅在 <style> 块中提取', () => {
  setConfig({});
  const provider = new StyleSemanticTokensProvider();
  const vue = `<template><div>var(--not-in-style)</div></template>\n<style>\n.btn { color: var(--theme); }\n</style>`;
  const doc = makeDocument(vue, 'test.vue', 'vue');

  const tokens = provider.provideDocumentSemanticTokens(doc);
  assert.ok(tokens);
  assert.equal(tokens.data.length, 1);
  assert.equal(tokens.data[0].line, 2);
  assert.equal(tokens.data[0].length, '--theme'.length);
});
