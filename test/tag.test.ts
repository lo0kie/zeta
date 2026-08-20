import { findAllTagPairs, findTagPairAt, scanTagPairs } from '@/utils/tag';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { makeDocument } from './helpers';

test('void 元素与自闭合元素不破坏配对', () => {
  const text = '<div><img><input type="text"><br><span>hi</span></div>';
  const pairs = scanTagPairs(text);
  assert.equal(pairs.length, 2);
  const div = pairs.find(p => text.slice(p.open.start, p.open.end).startsWith('<div'));
  assert.ok(div);
  assert.equal(text.slice(div.open.start, div.open.end), '<div>');
  assert.equal(text.slice(div.close.start, div.close.end), '</div>');
});

test('SVG 空元素（无自闭合斜杠）不破坏后续标签配对', () => {
  const text = '<svg><path d="M0 0"><rect x="1"><circle r="2"><g><text>hi</text></g></svg><div>x</div>';
  const pairs = scanTagPairs(text);
  assert.equal(pairs.length, 4);
  const div = pairs.find(p => text.slice(p.open.start, p.open.end).startsWith('<div'));
  assert.ok(div);
});

test('SVG 空元素带闭合标签时忽略闭合，不影响真实元素嵌套', () => {
  const text = '<svg><path></path><g><rect></rect><circle></circle></g></svg>';
  const pairs = scanTagPairs(text);
  assert.equal(pairs.length, 2);
  const g = pairs.find(p => text.slice(p.open.start, p.open.end).startsWith('<g'));
  assert.ok(g);
  assert.equal(text.slice(g.close.start, g.close.end), '</g>');
});

test('HTML/Vue 中的 <script> 与 <style> 块内部运算符不破坏标签配对', () => {
  const text = `
    <template>
      <div id="app">
        <script>
          if (a < b && c > 1) {
            const arr = [1 < 2, 3 > 4];
          }
        </script>
        <style>
          div > span { color: red; }
        </style>
        <span>content</span>
      </div>
    </template>
  `;
  const pairs = scanTagPairs(text);
  const div = pairs.find(p => text.slice(p.open.start, p.open.end).includes('id="app"'));
  assert.ok(div);
  const span = pairs.find(p => text.slice(p.open.start, p.open.end).includes('<span>'));
  assert.ok(span);
});

test('JSX / 属性中的 > 与表达式不截断标签', () => {
  const text = '<div onClick={() => x > 5} :data="a > b ? 1 : 2">hi</div>';
  const pairs = scanTagPairs(text);
  assert.equal(pairs.length, 1);
  assert.equal(text.slice(pairs[0].open.start, pairs[0].open.end), '<div onClick={() => x > 5} :data="a > b ? 1 : 2">');
});

test('纯文本中的比较运算符 a < b 不误判为标签', () => {
  const pairs = scanTagPairs('if (a < b && c > 1) { go(); }');
  assert.equal(pairs.length, 0);
});

test('findAllTagPairs + findTagPairAt: 准确定位光标处最内层标签', () => {
  const text = '<div><main><section><span>text</span></section></main></div>';
  const doc = makeDocument(text, 'nested.html', 'html');
  const pairs = findAllTagPairs(doc);
  assert.equal(pairs.length, 4);

  const offset = doc.offsetAt(doc.positionAt(text.indexOf('text') + 1));
  const inner = findTagPairAt(pairs, doc, offset);
  assert.ok(inner, '应定位到最内层 span 标签');
  assert.equal(doc.getText(inner.openTagRange), '<span>');
});

test('紧凑无空格自闭合标签 <div/> 正确解析', () => {
  const text = '<div/><CustomComp/><span>text</span>';
  const pairs = scanTagPairs(text);
  assert.equal(pairs.length, 1);
  assert.equal(text.slice(pairs[0].open.start, pairs[0].open.end), '<span>');

  // 自闭合（含带空格形式）不产生配对
  assert.equal(scanTagPairs('<div/>').length, 0);
  assert.equal(scanTagPairs('<div />').length, 0);
  assert.equal(scanTagPairs('<br/>').length, 0);
});

const names = (pairs: ReturnType<typeof scanTagPairs>): string[] => pairs.map(p => p.open.name);

test('scanTagPairs: HTML 注释内残缺标签被跳过', () => {
  assert.equal(scanTagPairs('<!-- <div></div> -->').length, 0);
  assert.equal(scanTagPairs('<div><!-- </div> --></div>').length, 1); // 注释不污染栈
});

test('scanTagPairs: 未闭合 script 中止扫描（后续标签被截断保护）', () => {
  // 未闭合的 script 直接中止：无 </script> 时其后的 <div> 不产生配对，
  // 防止脚本文本里的 `<div>` 被当真实标签导致后续 DOM 解析错位
  assert.equal(scanTagPairs('<script>const x = 1').length, 0);
  assert.equal(scanTagPairs('<script>const x = 1;\n<div class="real">hi</div>').length, 0);
});

test('scanTagPairs: 大小写标签配对（比较忽略大小写）', () => {
  const pairs = scanTagPairs('<DIV></DIV>');
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].open.name, 'DIV');
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

  // 兄弟标签各自配对
  const siblings = scanTagPairs('<div></div><p></p>');
  assert.equal(siblings.length, 2);
  assert.deepEqual(names(siblings).sort(), ['div', 'p']);
});

test('scanTagPairs: JSX Fragment（<>...</>）被识别并配对', () => {
  const text = '<>\n  <div>hi</div>\n</>';
  const pairs = scanTagPairs(text);
  assert.equal(pairs.length, 2, 'Fragment 与内层 div 各一对');
  const frag = pairs.find(p => p.open.name === '');
  assert.ok(frag, '存在空名 Fragment 对');
  assert.equal(text.slice(frag!.open.start, frag!.open.end), '<>');
  assert.equal(text.slice(frag!.close.start, frag!.close.end), '</>');
  // 普通标签名非空，不与 Fragment 混淆
  const div = pairs.find(p => p.open.name === 'div');
  assert.ok(div);
});

test('scanTagPairs: Fragment 与普通标签嵌套互不干扰', () => {
  const text = '<><span>x</span><>y</></>';
  const pairs = scanTagPairs(text);
  // 两个 Fragment 对 + 一个 span 对
  assert.equal(pairs.length, 3);
  const frags = pairs.filter(p => p.open.name === '');
  assert.equal(frags.length, 2, '两个 Fragment 各自配对');
});
