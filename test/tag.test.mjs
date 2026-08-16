// 标签扫描器：void 元素、属性内 >、比较符不误判、配对与最内层
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, makeDocument, makeChecker } from './helpers.mjs';

const { scanTagPairs, findAllTagPairs, findTagPairAt } = await loadModule(`
  export { scanTagPairs, findAllTagPairs, findTagPairAt } from './src/utils/tag';
`);

test('void 元素不破坏配对', () => {
  const text = '<div><img><span>hi</span></div>';
  const pairs = scanTagPairs(text);
  assert.equal(pairs.length, 2, '只有 div/span 配对');
  const div = pairs.find(p => text.slice(p.open.start, p.open.end).startsWith('<div'));
  assert.ok(div);
  assert.equal(text.slice(div.open.start, div.open.end), '<div>');
  assert.equal(text.slice(div.close.start, div.close.end), '</div>');
});

test('JSX 属性内 > 不截断标签', () => {
  const text = '<div onClick={() => x > 5}>hi</div>';
  const pairs = scanTagPairs(text);
  assert.equal(pairs.length, 1);
  assert.equal(text.slice(pairs[0].open.start, pairs[0].open.end), '<div onClick={() => x > 5}>');
});

test('引号属性内 > 不截断标签', () => {
  const text = `<div title="a > b" data-x='c > d'>x</div>`;
  const pairs = scanTagPairs(text);
  assert.equal(pairs.length, 1);
});

test('比较符 a < b 不误判为标签', () => {
  const pairs = scanTagPairs('if (a < b && c > 1) { go(); }');
  assert.equal(pairs.length, 0);
});

test('findAllTagPairs + findTagPairAt：多选区最内层', () => {
  const text = '<div><span>text</span></div>';
  const doc = makeDocument(text, 't.html', 'html');
  const pairs = findAllTagPairs(doc);
  assert.equal(pairs.length, 2);
  const offset = doc.offsetAt(doc.positionAt(text.indexOf('text') + 2));
  const inner = findTagPairAt(pairs, doc, offset);
  assert.equal(doc.getText(inner.openTagRange), '<span>');
});
