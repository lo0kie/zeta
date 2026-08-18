import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers.mjs';

const { getNextQuote, scanStringTokens, convertConcatToTemplate, transformQuotes, transformAttrQuotes } = await loadModule(
  `export { getNextQuote, scanStringTokens, convertConcatToTemplate, transformQuotes, transformAttrQuotes } from './src/utils/quote';`
);

test('getNextQuote: 属性引号互转', () => {
  assert.equal(getNextQuote('"', undefined, true), "'");
  assert.equal(getNextQuote("'", undefined, true), '"');
});

test('getNextQuote: 普通三态循环', () => {
  assert.equal(getNextQuote("'"), '"');
  assert.equal(getNextQuote('"'), '`');
  assert.equal(getNextQuote('`'), "'");
});

test('getNextQuote: 对象键仅限单/双引号', () => {
  assert.equal(getNextQuote("'", undefined, false, true), '"');
  assert.equal(getNextQuote('"', undefined, false, true), "'");
});

test('getNextQuote: 外层引号过滤 + 未知当前引号回退', () => {
  assert.equal(getNextQuote("'", '"'), '`'); // 外层 " 被排除，' -> `
  assert.equal(getNextQuote('x'), "'"); // 未知当前引号回退到首项
});

test('scanStringTokens: 基本单/双/模板字符串', () => {
  assert.equal(scanStringTokens("'hello'").length, 1);
  assert.equal(scanStringTokens('"hello"').length, 1);
  assert.equal(scanStringTokens('`hello`').length, 1);
  assert.equal(scanStringTokens("'a' \"b\"").length, 2);
});

test('scanStringTokens: 转义引号不提前结束', () => {
  const toks = scanStringTokens("'a\\'b'");
  assert.equal(toks.length, 1);
  assert.equal(toks[0].quote, "'");
});

test('scanStringTokens: 除法不误判为正则字符串', () => {
  // (a) / 2 中的 / 是除法，不应产生字符串 token
  assert.equal(scanStringTokens('(a) / 2').length, 0);
  assert.equal(scanStringTokens('a / 2').length, 0);
});

test('scanStringTokens: 关键字后的 / 仍作正则（无字符串 token）', () => {
  assert.equal(scanStringTokens('return /a/').length, 0);
  assert.equal(scanStringTokens('typeof /x/').length, 0);
});

test('scanStringTokens: HTML 注释内残缺标签不污染', () => {
  assert.equal(scanStringTokens('<!-- <div> </div> -->').length, 0);
});

test('scanStringTokens: Vue 动态属性内的字符串标记为 attrQuote', () => {
  const toks = scanStringTokens("<div :src=\"'x'\">");
  // 内层 'x' 与外层属性引号各产生一个 token，其中外层引号标记为 isAttrQuote
  assert.equal(toks.length, 2);
  assert.ok(toks.some(t => t.isAttrQuote === true && t.quote === '"'));
});

test('scanStringTokens: 对象属性键被识别', () => {
  const toks = scanStringTokens("{'key': 1}");
  assert.equal(toks.length, 1);
  assert.equal(toks[0].isObjectKey, true);
});

test('convertConcatToTemplate: 字符串拼接合并为模板', () => {
  assert.equal(convertConcatToTemplate("'a' + 'b'"), '`ab`');
  assert.equal(convertConcatToTemplate("'a' + x"), '`a${x}`');
  assert.equal(convertConcatToTemplate('`a` + `b`'), '`ab`');
});

test('transformQuotes: 单<->双 互转并转义', () => {
  assert.equal(transformQuotes("'abc'", "'", '"'), '"abc"');
  assert.equal(transformQuotes('"abc"', '"', "'"), "'abc'");
  assert.equal(transformQuotes("'a\"b'", "'", '"'), '"a\\"b"'); // 内层 " 转义
  assert.equal(transformQuotes("\"a'b\"", '"', "'"), "'a\\'b'"); // 内层 ' 转义
});

test('transformAttrQuotes: HTML 实体归一化', () => {
  assert.equal(transformAttrQuotes('"a & b"', '"', "'"), "'a & b'");
  assert.equal(transformAttrQuotes('"a &quot; b"', '"', "'"), "'a \" b'");
  assert.equal(transformAttrQuotes("'a &#39; b'", "'", '"'), '"a \' b"');
});
