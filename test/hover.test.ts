import * as vscode from 'vscode';
// 样式悬浮：变量 / CSS 变量（含 var(--xxx)）/ mixin（less .mixin、scss @mixin）
// 类名/ID 悬浮与跳转已移除（交给内置 CSS 语言服务）。
import { StyleHoverProvider } from '@/providers/style-hover';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { cleanup, hoverText, makeDocument, makeWorkspace, setConfig } from './helpers';

const provider = new StyleHoverProvider();

test('变量悬浮：展示定义的样子（@name: value;）且语言 id 跟随来源', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'app'), { recursive: true });
    writeFileSync(
      join(ws, 'app', 'theme.less'),
      `:root {\n  --color: #007aff;\n}\n.dark {\n  --color: #0a84ff;\n}\n@primary: #1890ff;\n--main-bg: #fff;\n`
    );
    const text = `@import "./theme";\n.a { color: @primary; background: var(--color); border-color: var(--main-bg); }\n`;
    const doc = makeDocument(text, join(ws, 'app', 'm.less'), 'less');
    const line1 = text.split('\n')[1];

    // Less 变量：展示定义的样子 `@primary: #1890ff;`，语言 id 为 less
    const at = await provider.provideHover(doc, new vscode.Position(1, line1.indexOf('@primary') + 4));
    assert.ok(at, '@ 变量悬浮');
    const atText = hoverText(at);
    assert.ok(atText.includes('@primary: #1890ff;'), 'Less 变量展示定义的样子');
    assert.ok(atText.includes('```less'), '代码块语言 id 为 less');
    assert.ok(!atText.includes('定义于'), '不再展示「定义于」行');

    // 多作用域 CSS 变量：多个命名空间全部展示
    const cssVarMulti = await provider.provideHover(doc, new vscode.Position(1, line1.indexOf('--color') + 4));
    assert.ok(cssVarMulti, '多作用域 CSS 变量悬浮');
    const multiText = hoverText(cssVarMulti);
    assert.ok(multiText.includes(':root --color: #007aff;'), '展示 :root 定义');
    assert.ok(multiText.includes('.dark --color: #0a84ff;'), '展示 .dark 定义');
    assert.ok(!multiText.includes('定义于'), '不再展示「定义于」行');
    // 方案 A：纯色变量在代码块下方追加色块预览行（Markdown 图片，alt 为色值）
    assert.ok(multiText.includes('!['), '纯色变量追加色块预览');
    assert.ok(multiText.includes('![#007aff](') && multiText.includes('![#0a84ff]('), '各命名空间色块行包含对应色值');
    assert.ok(multiText.includes('`#007aff`  \n![#0a84ff]('), '色块之间真正换行（hard break）');

    // 单定义 CSS 变量：展示定义的样子
    const cssVarSingle = await provider.provideHover(doc, new vscode.Position(1, line1.indexOf('--main-bg') + 5));
    assert.ok(cssVarSingle, '单定义 CSS 变量悬浮');
    const singleText = hoverText(cssVarSingle);
    assert.ok(singleText.includes('--main-bg: #fff;'), '单定义 CSS 变量展示定义的样子');
    assert.ok(!singleText.includes('定义于'), '不再展示「定义于」行');
  } finally {
    cleanup(ws);
  }
});

test('var(--xxx) 引用悬浮：与直接悬浮 --xxx 一致', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'app'), { recursive: true });
    // 真实定义文件：:root 里的 --brand（当前文档 use.less 通过 @import 引入）
    writeFileSync(join(ws, 'app', 'tokens.less'), `:root { --brand: #ff5722; }\n`);
    const text = `@import "./tokens";\n.a { color: var(--brand); }\n`;
    const doc = makeDocument(text, join(ws, 'app', 'use.less'), 'less');
    // 光标在 var(--brand) 的 --brand 上（行内索引）
    const line1 = text.split('\n')[1];
    const pos = line1.indexOf('--brand') + 3;
    const hover = await provider.provideHover(doc, new vscode.Position(1, pos));
    assert.ok(hover, 'var(--xxx) 内部悬浮');
    const hoverTxt = hoverText(hover);
    assert.ok(hoverTxt.includes('--brand: #ff5722;'), 'var(--xxx) 引用展示定义的样子');
    assert.ok(!hoverTxt.includes('定义于'), '不再展示「定义于」行');
  } finally {
    cleanup(ws);
  }
});

test('less mixin 悬浮：展示定义文本且语言 id 为 less', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = '.rounded(@r: 4px) { border-radius: @r; }\n.use { .rounded(); }\n';
    const doc = makeDocument(text, join(ws, 'mix.less'), 'less');
    // 光标在 use 内的 .rounded 上（行内索引：第二行）
    const line1 = text.split('\n')[1];
    const pos = line1.indexOf('.rounded') + 2;
    const hover = await provider.provideHover(doc, new vscode.Position(1, pos));
    assert.ok(hover, 'less mixin 悬浮');
    const value = hoverText(hover);
    assert.ok(value.includes('.rounded(@r: 4px)'), '展示 mixin 定义文本');
    // 语言 id 跟随来源文件（less）而不是硬编码 css
    assert.ok(value.includes('```less'), 'hover 代码块语言 id 为 less');
    assert.ok(!value.includes('定义于'), 'mixin 不再展示「定义于」行');
  } finally {
    cleanup(ws);
  }
});

test('scss mixin 悬浮：展示定义文本且语言 id 为 scss', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = '@mixin big($size: 2em) { font-size: $size; }\n.a { @include big(); }\n';
    const doc = makeDocument(text, join(ws, 'mix.scss'), 'scss');
    // 光标在 @include big 的 big 上（行内索引：第二行，补 @ 前缀逻辑）
    const line1 = text.split('\n')[1];
    const pos = line1.indexOf('big') + 2;
    const hover = await provider.provideHover(doc, new vscode.Position(1, pos));
    assert.ok(hover, 'scss mixin 悬浮');
    const value = hoverText(hover);
    assert.ok(value.includes('@mixin big($size: 2em)'), '展示 mixin 定义文本');
    assert.ok(value.includes('```scss'), 'hover 代码块语言 id 为 scss');
    assert.ok(!value.includes('定义于'), 'mixin 不再展示「定义于」行');
  } finally {
    cleanup(ws);
  }
});

test('多命名空间 mixin 悬浮：全部定义都展示', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(
      join(ws, 'mix.less'),
      `.fade-scale-transition() { opacity: 0; }\n.theme-dark {\n  .fade-scale-transition() { opacity: 0.5; }\n}\n`
    );
    const text = '@import "./mix";\n.a { .fade-scale-transition(); }\n';
    const doc = makeDocument(text, join(ws, 'm.less'), 'less');
    const line1 = text.split('\n')[1];
    const pos = line1.indexOf('.fade-scale-transition') + 2;
    const hover = await provider.provideHover(doc, new vscode.Position(1, pos));
    assert.ok(hover, '多命名空间 mixin 悬浮');
    const ht = hoverText(hover);
    assert.equal(ht.match(/\.fade-scale-transition\(\)/g)?.length, 2, '两个命名空间的定义都展示');
    assert.ok(!ht.includes('定义于'), 'mixin 不再展示「定义于」行');
  } finally {
    cleanup(ws);
  }
});

test('普通类名/ID 不再悬浮（交给内置 CSS 语言服务）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = '.btn:hover { color: red; }\n#header { padding: 0; }\n';
    const doc = makeDocument(text, join(ws, 'a.css'), 'css');
    const cls = await provider.provideHover(doc, new vscode.Position(0, text.indexOf('.btn') + 2));
    assert.equal(cls, undefined, '普通类名不悬浮');
    const id = await provider.provideHover(doc, new vscode.Position(1, text.indexOf('#header') + 2));
    assert.equal(id, undefined, '普通 ID 不悬浮');
  } finally {
    cleanup(ws);
  }
});

// 回归：阴影等多段值变量展示「定义的样子」完整值，且不显示色块、不显示「定义于」行。
test('变量悬浮：阴影变量展示定义的样子（完整多段值）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'app'), { recursive: true });
    writeFileSync(
      join(ws, 'app', 'tokens.less'),
      `:root {\n  --shadow-floating: 0 24px 56px rgba(0, 0, 0, 0.6), 0 8px 20px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06);\n}\n`
    );
    const text = `@import "./tokens";\n.a { box-shadow: var(--shadow-floating); }\n`;
    const doc = makeDocument(text, join(ws, 'app', 'm2.less'), 'less');
    const line1 = text.split('\n')[1];

    const hover = await provider.provideHover(doc, new vscode.Position(1, line1.indexOf('--shadow-floating') + 4));
    assert.ok(hover, '阴影变量悬浮');
    const ht = hoverText(hover);
    assert.ok(
      ht.includes(
        '--shadow-floating: 0 24px 56px rgba(0, 0, 0, 0.6), 0 8px 20px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06);'
      ),
      '展示定义的样子（完整多段值 + 分号）'
    );
    assert.ok(!ht.includes('!['), '不再渲染色块');
    assert.ok(!ht.includes('定义于'), '不再展示「定义于」行');
  } finally {
    cleanup(ws);
  }
});

// 一层解引用：变量值引用其他变量时（var(--x) / @y），再展开一层显示实际值。
test('变量悬浮：值引用的变量再展开一层（var()/@ 解引用）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'app'), { recursive: true });
    writeFileSync(
      join(ws, 'app', 'tokens.less'),
      `:root {\n  --primary: #ff9500;\n  --brand: var(--primary);\n}\n@base: #0a84ff;\n@link: @base;\n`
    );
    const text = `@import "./tokens";\n.a { color: var(--brand); background: @link; }\n`;
    const doc = makeDocument(text, join(ws, 'app', 'm3.less'), 'less');
    const line1 = text.split('\n')[1];

    // 悬浮 --brand：其值 var(--primary) 再展开 → 显示 --primary = #ff9500
    const brandHover = await provider.provideHover(doc, new vscode.Position(1, line1.indexOf('--brand') + 4));
    assert.ok(brandHover, '--brand 悬浮');
    const brandText = hoverText(brandHover);
    assert.ok(brandText.includes('--brand: var(--primary);'), '展示定义的样子');
    assert.ok(brandText.includes('--primary') && brandText.includes('#ff9500'), '一层解引用显示实际值');
    assert.ok(brandText.includes('`--primary` = `#ff9500`'), '解引用格式为 name = value');

    // 悬浮 @link：值 @base 再展开 → 显示 @base = #0a84ff
    const linkHover = await provider.provideHover(doc, new vscode.Position(1, line1.indexOf('@link') + 2));
    assert.ok(linkHover, '@link 悬浮');
    const linkText = hoverText(linkHover);
    assert.ok(linkText.includes('@link: @base;'), '展示定义的样子');
    assert.ok(linkText.includes('`@base` = `#0a84ff`'), '@ 变量一层解引用');
  } finally {
    cleanup(ws);
  }
});
