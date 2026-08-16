// 引号工具：扫描、拼接链（含字符串内 +）、模板转换
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers.mjs';

const { scanStringTokens, findConcatenationChain, convertConcatToTemplate, transformQuotes } = await loadModule(`
  export { scanStringTokens, findConcatenationChain, convertConcatToTemplate, transformQuotes } from './src/utils/quote';
`);

test('scanStringTokens：嵌套模板表达式内的字符串作为独立 token', () => {
  // "const t = " 占 10 字符，反引号在 10；'x' 在内容内偏移 9，即文档 20..23；
  // 内容 11..29（19 字符），结束反引号在 30，token end = 31
  const text = `const t = \`hi \${a + 'x'} there\`;`;
  const tokens = scanStringTokens(text).map(t => [t.start, t.end, t.quote]);
  assert.deepEqual(tokens, [
    [20, 23, "'"],
    [10, 31, '`'],
  ]);
});

test('findConcatenationChain：左侧带前缀、右侧 token、跨行组', () => {
  const c1 = findConcatenationChain(`const x = 'a' + 'b'`, 0, { start: 10, end: 13, quote: "'" });
  assert.equal(c1.raw, "'a' + 'b'");

  const c2 = findConcatenationChain(`'a' + 'b' + 'c'`, 0, { start: 8, end: 11, quote: "'" });
  assert.equal(c2.raw, "'a' + 'b' + 'c'");
});

test('findConcatenationChain：非链场景返回 null', () => {
  const c = findConcatenationChain(`const x = 'a'`, 0, { start: 10, end: 13, quote: "'" });
  assert.equal(c, null);
});

test('convertConcatToTemplate：字符串内 + 不拆散', () => {
  assert.equal(convertConcatToTemplate("'a + b' + name"), '`a + b${name}`');
  assert.equal(convertConcatToTemplate("'a' + 'b'"), '`ab`');
  assert.equal(convertConcatToTemplate("x + 'b'"), '`${x}b`');
  assert.equal(convertConcatToTemplate("'' + y"), '`${y}`');
});

test('transformQuotes：模板 ↔ 普通引号', () => {
  assert.equal(transformQuotes('`abc`', '`', "'"), `'abc'`);
  assert.equal(transformQuotes('`a${x}b`', '`', "'"), `'a' + x + 'b'`);
  assert.equal(transformQuotes(`'a'`, "'", '`'), '`a`');
});
