import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers.mjs';

const { scanTagPairs } = await loadModule(`export { scanTagPairs } from './src/utils/tag';`);

const names = pairs => pairs.map(p => p.open.name);

test('scanTagPairs: 基础配对', () => {
  assert.equal(scanTagPairs('<div></div>').length, 1);
  assert.equal(scanTagPairs('<div></div>')[0].open.name, 'div');
});

test('scanTagPairs: 无空格自闭合 <div/> 不配对', () => {
  assert.equal(scanTagPairs('<div/>').length, 0);
  assert.equal(scanTagPairs('<div />').length, 0); // 带空格自闭合
  assert.equal(scanTagPairs('<br/>').length, 0);
});

test('scanTagPairs: void 元素不参与配对', () => {
  assert.equal(scanTagPairs('<img src="x.png">').length, 0);
  assert.equal(scanTagPairs('<input type="text">').length, 0);
  assert.equal(scanTagPairs('<br>').length, 0);
  assert.equal(scanTagPairs('<path d="M0 0"/>').length, 0); // svg void
});

test('scanTagPairs: 嵌套标签逐层配对', () => {
  const pairs = scanTagPairs('<div><span></span></div>');
  assert.equal(pairs.length, 2);
  assert.deepEqual(names(pairs).sort(), ['div', 'span']);
});

test('scanTagPairs: 兄弟标签各自配对', () => {
  const pairs = scanTagPairs('<div></div><p></p>');
  assert.equal(pairs.length, 2);
  assert.deepEqual(names(pairs).sort(), ['div', 'p']);
});

test('scanTagPairs: HTML 注释内残缺标签被跳过', () => {
  assert.equal(scanTagPairs('<!-- <div></div> -->').length, 0);
  assert.equal(scanTagPairs('<div><!-- </div> --></div>').length, 1); // 注释不污染栈
});

test('scanTagPairs: script 块整体配对，内部 < > 不被误解析', () => {
  const pairs = scanTagPairs('<script>const x = 1 < 2 && 3 > 1;</script>');
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].open.name, 'script');
});

test('scanTagPairs: style 块整体配对', () => {
  const pairs = scanTagPairs('<style>.a { color: red; }</style>');
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].open.name, 'style');
});

test('scanTagPairs: 未闭合 script/style 中止扫描', () => {
  // 未闭合的 script 直接中止，后续标签不再解析
  assert.equal(scanTagPairs('<script>const x = 1').length, 0);
});

test('scanTagPairs: 大小写标签配对（比较忽略大小写）', () => {
  const pairs = scanTagPairs('<DIV></DIV>');
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].open.name, 'DIV');
});

test('scanTagPairs: 属性值内含 > 不提前结束标签', () => {
  const pairs = scanTagPairs('<div attr="a>b"><span></span></div>');
  assert.equal(pairs.length, 2);
});

test('scanTagPairs: 不匹配的闭合标签仍配对外层', () => {
  // <div><span></div>：span 未正常闭合，但外层 div 仍配对
  const pairs = scanTagPairs('<div><span></div>');
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].open.name, 'div');
});

test('scanTagPairs: 多属性与自闭合混合', () => {
  const html = '<div class="a" id="b"><img src="x.png"><span></span></div>';
  const pairs = scanTagPairs(html);
  assert.equal(pairs.length, 2); // img 为 void 不参与
  assert.deepEqual(names(pairs).sort(), ['div', 'span']);
});
