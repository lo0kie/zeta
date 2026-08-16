// 样式悬浮：单层/复合/多行组、注释不伪匹配、变量、嵌套、minIndent、字符串大括号
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadModule, makeWorkspace, setConfig, cleanup, makeDocument } from './helpers.mjs';

const { StyleHoverProvider } = await loadModule(`export { StyleHoverProvider } from './src/providers/style-hover';`);

const provider = new StyleHoverProvider();

test('单层规则：真实声明（非占位符）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = '.btn:hover { color: red; padding: 0; }\n';
    const doc = makeDocument(text, join(ws, 'a.css'), 'css');
    const hover = await provider.provideHover(doc, { line: 0, character: text.indexOf('.btn') + 2 });
    assert.ok(hover, '悬浮存在');
    assert.ok(hover.contents.value.includes('color: red'), '含真实声明');
    assert.ok(!hover.contents.value.includes('/* class selector */'), '非占位符');
  } finally {
    cleanup(ws);
  }
});

test('复合选择器与跨行选择器组：父选择器保留', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = '.header .item {\n  color: red;\n  margin: 0;\n}\n';
    const doc = makeDocument(text, join(ws, 'b.less'), 'less');
    const hover = await provider.provideHover(doc, { line: 0, character: 9 });
    assert.ok(hover, '复合选择器悬浮');
    assert.ok(hover.contents.value.includes('.header .item {'), '单行复合含父选择器');

    const multi = '.container,\n.item { color: red; }\n';
    const doc2 = makeDocument(multi, join(ws, 'c.less'), 'less');
    const h2 = await provider.provideHover(doc2, { line: 1, character: 3 });
    assert.ok(h2, '多行组悬浮');
    assert.ok(h2.contents.value.includes('.container,'), '跨行组含父选择器');
  } finally {
    cleanup(ws);
  }
});

test('注释内选择器不伪匹配（块注释与单行注释）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = '/* .btn { color: red; } */\n// .hidden { color: black; }\n.card { color: blue; }\n';
    const doc = makeDocument(text, join(ws, 'd.less'), 'less');
    const lines = text.split('\n');
    const btn = await provider.provideHover(doc, { line: 0, character: lines[0].indexOf('.btn') + 2 });
    assert.equal(btn, undefined, '块注释内不悬浮');
    const hidden = await provider.provideHover(doc, { line: 1, character: lines[1].indexOf('.hidden') + 2 });
    assert.equal(hidden, undefined, '单行注释内不悬浮');
    const card = await provider.provideHover(doc, { line: 2, character: lines[2].indexOf('.card') + 2 });
    assert.ok(card && card.contents.value.includes('color: blue'), '真实规则正常');
  } finally {
    cleanup(ws);
  }
});

test('变量悬浮：Less 变量与 CSS 变量展示解析值', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'app'), { recursive: true });
    writeFileSync(join(ws, 'app', 'theme.less'), `@primary: #1890ff;\n--main-bg: #fff;\n`);
    const text = `@import "./theme";\n.a { color: @primary; background: var(--main-bg); }\n`;
    const doc = makeDocument(text, join(ws, 'app', 'm.less'), 'less');
    const line1 = text.split('\n')[1];
    const at = await provider.provideHover(doc, { line: 1, character: line1.indexOf('@primary') + 4 });
    assert.ok(at, '@ 变量悬浮');
    assert.ok(at.contents.value.includes('@primary: #1890ff;'), '展示解析值');
    const cssVar = await provider.provideHover(doc, { line: 1, character: line1.indexOf('--main-bg') + 5 });
    assert.ok(cssVar && cssVar.contents.value.includes('--main-bg: #fff;'), 'CSS 变量展示值');
  } finally {
    cleanup(ws);
  }
});

test('嵌套规则与字符串大括号：块完整、不被截断', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `.card {\n  content: "}";\n  &::before { color: red; }\n}\n`;
    const doc = makeDocument(text, join(ws, 'e.less'), 'less');
    const hover = await provider.provideHover(doc, { line: 0, character: 2 });
    assert.ok(hover, '悬浮存在');
    const value = hover.contents.value;
    assert.ok(value.includes('content: "}"'), '字符串大括号不截断');
    assert.ok(value.includes('::before'), '嵌套伪元素保留');
  } finally {
    cleanup(ws);
  }
});

test('minIndent：首行缩进更深不削后续行字符', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `.a {\n    @media (x) {\n  color: red;\n    }\n}\n`;
    const doc = makeDocument(text, join(ws, 'f.less'), 'less');
    const hover = await provider.provideHover(doc, { line: 0, character: 1 });
    assert.ok(hover, '悬浮存在');
    const value = hover.contents.value;
    assert.ok(value.includes('@media (x) {'), '@media 完整');
    assert.ok(value.includes('color: red'), 'color 完整未被削字');
  } finally {
    cleanup(ws);
  }
});
