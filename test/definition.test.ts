import { StyleDefinitionProvider, findDefinitionRange, findDefinitionRanges } from '@/providers/style-definition';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import * as vscode from 'vscode';
import { cleanup, makeDocument, makeWorkspace, setConfig } from './helpers';

const provider = new StyleDefinitionProvider();

test('findDefinitionRange / findDefinitionRanges: 单/多定义行末定位', () => {
  const lessText = `// 注释\n@primary: #1890ff;\n.box { color: @primary; }`;
  const lessRange = findDefinitionRange(lessText, '@primary');
  assert.ok(lessRange);
  assert.equal(lessRange.start.line, 1);
  assert.equal(lessRange.start.character, '@primary: #1890ff;'.length);

  const cssText = `:root {\n  --color: #007aff;\n}\n.dark {\n  --color: #0a84ff;\n}`;
  const cssRanges = findDefinitionRanges(cssText, '--color');
  assert.equal(cssRanges.length, 2);
  assert.equal(cssRanges[0].start.line, 1);
  assert.equal(cssRanges[1].start.line, 4);
});

test('StyleDefinitionProvider: 单定义返回单个 Location', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app');
    mkdirSync(app, { recursive: true });

    const themeContent = `@theme-color: #1890ff;`;
    writeFileSync(join(app, 'theme.less'), themeContent);

    const mainContent = `@import "./theme";\n.header {\n  color: @theme-color;\n}`;
    const doc = makeDocument(mainContent, join(app, 'main.less'), 'less');

    const loc = (await provider.provideDefinition(doc, new vscode.Position(2, 12))) as unknown as vscode.Location;
    assert.ok(loc);
    assert.equal(Array.isArray(loc), false);
    assert.equal(loc.uri.fsPath, join(app, 'theme.less'));
    assert.equal(loc.range.start.line, 0);
  } finally {
    cleanup(ws);
  }
});

test('StyleDefinitionProvider: 多作用域同名变量返回 Location[] 列表', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app-multi');
    mkdirSync(app, { recursive: true });

    const tokens = `:root {\n  --brand: #007aff;\n}\n.dark {\n  --brand: #0a84ff;\n}`;
    writeFileSync(join(app, 'tokens.css'), tokens);

    const mainContent = `@import "./tokens.css";\n.btn { color: var(--brand); }`;
    const doc = makeDocument(mainContent, join(app, 'main.css'), 'css');

    const locs = (await provider.provideDefinition(doc, new vscode.Position(1, 22))) as unknown as vscode.Location[];
    assert.ok(Array.isArray(locs));
    assert.equal(locs.length, 2);
    assert.equal(locs[0].range.start.line, 1);
    assert.equal(locs[1].range.start.line, 4);
  } finally {
    cleanup(ws);
  }
});

test('StyleDefinitionProvider: 多作用域跳转按引用处命名空间优先排序', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app-scope');
    mkdirSync(app, { recursive: true });

    const tokens = `:root {\n  --brand: #007aff;\n}\n.dark {\n  --brand: #0a84ff;\n}`;
    writeFileSync(join(app, 'tokens.css'), tokens);

    // .dark 块内引用 var(--brand) → .dark 定义应排最前（优先命中命名空间）
    const mainContent = `@import "./tokens.css";\n.dark .card { color: var(--brand); }`;
    const doc = makeDocument(mainContent, join(app, 'main.css'), 'css');
    // 光标放在 --brand 上：--brand 在第 2 行，行内相对位置用 indexOf
    const secondLine = mainContent.split('\n')[1];
    const col = secondLine.indexOf('--brand') + 2; // 光标在变量名中间
    const pos = new vscode.Position(1, col);

    const locs = (await provider.provideDefinition(doc, pos)) as unknown as vscode.Location[];
    assert.ok(Array.isArray(locs));
    assert.equal(locs.length, 2);
    assert.equal(locs[0].range.start.line, 4, '.dark 内引用应优先命中 .dark 定义');
    assert.equal(locs[1].range.start.line, 1, '其次才是 :root 全局定义');
  } finally {
    cleanup(ws);
  }
});

// 类名/ID 跳转已移除（交给内置 CSS 语言服务），只保留变量 / mixin / var(--xxx)。
test('StyleDefinitionProvider: less mixin 调用跳转到定义', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app-mixin');
    mkdirSync(app, { recursive: true });

    const themeContent = `.rounded(@r: 4px) { border-radius: @r; }\n`;
    writeFileSync(join(app, 'theme.less'), themeContent);

    const mainContent = `@import "./theme";\n.use { .rounded(); }\n`;
    const doc = makeDocument(mainContent, join(app, 'main.less'), 'less');

    // 光标在 .use 内的 .rounded 上（行内索引：第二行）
    const line1 = mainContent.split('\n')[1];
    const loc = (await provider.provideDefinition(
      doc,
      new vscode.Position(1, line1.indexOf('.rounded') + 2)
    )) as unknown as vscode.Location;
    assert.ok(loc, 'less mixin 跳转存在');
    assert.equal(loc.uri.fsPath, join(app, 'theme.less'));
    assert.equal(loc.range.start.line, 0);
  } finally {
    cleanup(ws);
  }
});

test('StyleDefinitionProvider: scss @include 跳转到 @mixin 定义', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app-scss-mixin');
    mkdirSync(app, { recursive: true });

    const themeContent = `@mixin big($size: 2em) { font-size: $size; }\n`;
    writeFileSync(join(app, '_theme.scss'), themeContent);

    const mainContent = `@use "./theme";\n.a { @include big(); }\n`;
    const doc = makeDocument(mainContent, join(app, 'main.scss'), 'scss');

    // 光标在 @include big 的 big 上（行内索引：第二行）
    const line1 = mainContent.split('\n')[1];
    const loc = (await provider.provideDefinition(
      doc,
      new vscode.Position(1, line1.indexOf('big') + 2)
    )) as unknown as vscode.Location;
    assert.ok(loc, 'scss mixin 跳转存在');
    assert.equal(loc.uri.fsPath, join(app, '_theme.scss'));
    assert.equal(loc.range.start.line, 0);
  } finally {
    cleanup(ws);
  }
});

test('StyleDefinitionProvider: 普通类名不再跳转（交给内置 CSS 语言服务）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `.btn:hover { color: red; }\n`;
    const doc = makeDocument(text, join(ws, 'cls.css'), 'css');
    const result = await provider.provideDefinition(doc, new vscode.Position(0, text.indexOf('.btn') + 2));
    assert.equal(result, undefined, '普通类名不跳转');
  } finally {
    cleanup(ws);
  }
});
