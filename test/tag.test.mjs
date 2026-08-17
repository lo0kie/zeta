import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule, makeDocument } from './helpers.mjs';

const { scanTagPairs, findAllTagPairs, findTagPairAt } = await loadModule(`
  export { scanTagPairs, findAllTagPairs, findTagPairAt } from './src/utils/tag';
`);

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
  assert.equal(doc.getText(inner.openTagRange), '<span>');
});

test('紧凑无空格自闭合标签 <div/> 正确解析', () => {
  const text = '<div/><CustomComp/><span>text</span>';
  const pairs = scanTagPairs(text);
  assert.equal(pairs.length, 1);
  assert.equal(text.slice(pairs[0].open.start, pairs[0].open.end), '<span>');
});
