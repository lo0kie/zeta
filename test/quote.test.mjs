import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers.mjs';

const {
  scanStringTokens,
  getNextQuote,
  findConcatenationChain,
  convertConcatToTemplate,
  transformQuotes,
  transformAttrQuotes,
} = await loadModule(`
  export {
    scanStringTokens,
    getNextQuote,
    findConcatenationChain,
    convertConcatToTemplate,
    transformQuotes,
    transformAttrQuotes,
  } from './src/utils/quote';
`);

test('scanStringTokens: 普通单双引号与模板字符串扫描', () => {
  const text = `const a = 'hello'; const b = "world"; const c = \`zeta\`;`;
  const tokens = scanStringTokens(text);
  assert.equal(tokens.length, 3);
  assert.deepEqual(
    tokens.map(t => [t.quote, text.slice(t.start, t.end)]),
    [
      ["'", "'hello'"],
      ['"', '"world"'],
      ['`', '`zeta`'],
    ]
  );
});

test('scanStringTokens: 嵌套模板插值、插值内字符串与包含大括号/引号的复杂表达式', () => {
  const text = "const t = `hi ${a + 'x' + \"y\" + { k: '}' }} there`;";
  const tokens = scanStringTokens(text);
  assert.equal(tokens.length, 4);
  assert.deepEqual(
    tokens.map(t => [t.quote, text.slice(t.start, t.end)]),
    [
      ["'", "'x'"],
      ['"', '"y"'],
      ["'", "'}'"],
      ['`', "`hi ${a + 'x' + \"y\" + { k: '}' }} there`"],
    ]
  );
});

test('scanStringTokens: 忽略单行/多行注释、HTML 注释与正则字面量中的伪引号', () => {
  const text = `
    // const x = 'ignore 1';
    /* const y = "ignore 2"; */
    <!-- <div class="ignore-3"> -->
    const reg1 = /'abc"/g;
    const reg2 = /^https?:\\/\\/['"]/;
    const real = 'valid';
  `;
  const tokens = scanStringTokens(text);
  assert.equal(tokens.length, 1);
  assert.equal(text.slice(tokens[0].start, tokens[0].end), "'valid'");
});

test('scanStringTokens: Vue 模板属性、动态指令与对象字面量 Key 识别', () => {
  const text = `<button class="btn" :class="{ 'is-active': active, \"is-loading\": loading }" :title="'hello ' + val">click</button>`;
  const tokens = scanStringTokens(text);

  assert.equal(tokens.length, 6);

  assert.equal(tokens[0].isAttrQuote, true);
  assert.equal(tokens[0].quote, '"');

  const activeKey = tokens.find(t => text.slice(t.start, t.end) === "'is-active'");
  assert.ok(activeKey);
  assert.equal(activeKey.isObjectKey, true);
  assert.equal(activeKey.enclosingQuote, '"');

  const loadingKey = tokens.find(t => text.slice(t.start, t.end) === '"is-loading"');
  assert.ok(loadingKey);
  assert.equal(loadingKey.isObjectKey, true);
  assert.equal(loadingKey.enclosingQuote, '"');

  const titleInner = tokens.find(t => text.slice(t.start, t.end) === "'hello '");
  assert.ok(titleInner);
  assert.equal(titleInner.isObjectKey, false);
  assert.equal(titleInner.enclosingQuote, '"');
});

test('getNextQuote: 语法安全、属性外层与对象 Key 引号策略', () => {
  assert.equal(getNextQuote("'", undefined, false, false), '"');
  assert.equal(getNextQuote('"', undefined, false, false), '`');
  assert.equal(getNextQuote('`', undefined, false, false), "'");

  assert.equal(getNextQuote("'", undefined, false, true), '"');
  assert.equal(getNextQuote('"', undefined, false, true), "'");

  assert.equal(getNextQuote('"', undefined, true, false), "'");
  assert.equal(getNextQuote("'", undefined, true, false), '"');

  assert.equal(getNextQuote("'", '"', false, true), "'");
});

test('findConcatenationChain: 行内 + 拼接链探测与边界', () => {
  const text1 = `const x = 'a' + 'b' + c;`;
  const token1 = { start: 10, end: 13, quote: "'" };
  const c1 = findConcatenationChain(text1, 0, token1);
  assert.ok(c1);
  assert.equal(c1.raw, "'a' + 'b' + c");

  const text2 = `const y = 'single';`;
  const token2 = { start: 10, end: 18, quote: "'" };
  assert.equal(findConcatenationChain(text2, 0, token2), null);
});

test('convertConcatToTemplate: 拼接表达式转模板字符串', () => {
  assert.equal(convertConcatToTemplate("'a' + 'b'"), '`ab`');
  assert.equal(convertConcatToTemplate("'hello ' + name"), '`hello ${name}`');
  assert.equal(convertConcatToTemplate("val + 'px'"), '`${val}px`');
  assert.equal(convertConcatToTemplate("'a + b' + num"), '`a + b${num}`');
  assert.equal(convertConcatToTemplate('`foo` + `bar`'), '`foobar`');
});

test('transformQuotes: 常用引号转换、多行折行与反斜杠转义自动规整', () => {
  assert.equal(transformQuotes(`'it\\'s "good"'`, "'", '"'), `"it's \\"good\\""`);
  assert.equal(transformQuotes(`"hello \\"world\\""`, '"', '`'), '`hello "world"`');
  assert.equal(transformQuotes('`line1\nline2\r\nline3`', '`', "'"), `'line1\\nline2\\nline3'`);
  assert.equal(transformQuotes('`a${x}b`', '`', "'"), `'a' + x + 'b'`);
  assert.equal(transformQuotes('`hello ${name}, score: ${score}`', '`', '"'), `"hello " + name + ", score: " + score`);
});

test('transformAttrQuotes: Vue 动态属性切换外层引号时反转内部冲突引号', () => {
  const expr1 = `"val => (val === 0 ? 'CAPO 0' : 'CAPO ' + val)"`;
  const res1 = transformAttrQuotes(expr1, '"', "'");
  assert.equal(res1, `'val => (val === 0 ? "CAPO 0" : "CAPO " + val)'`);

  const expr2 = `'val => (val === 0 ? "CAPO 0" : "CAPO " + val)'`;
  const res2 = transformAttrQuotes(expr2, "'", '"');
  assert.equal(res2, `"val => (val === 0 ? 'CAPO 0' : 'CAPO ' + val)"`);

  const plainAttr = `"box active"`;
  assert.equal(transformAttrQuotes(plainAttr, '"', "'"), `'box active'`);
});
