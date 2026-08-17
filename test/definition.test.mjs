import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, loadModule, makeDocument, makeWorkspace, setConfig } from './helpers.mjs';

const { StyleDefinitionProvider, findDefinitionRange, findDefinitionRanges } = await loadModule(`
  export { StyleDefinitionProvider, findDefinitionRange, findDefinitionRanges } from './src/providers/style-definition';
`);

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

    const loc = await provider.provideDefinition(doc, { line: 2, character: 12 });
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

    const locs = await provider.provideDefinition(doc, { line: 1, character: 22 });
    assert.ok(Array.isArray(locs));
    assert.equal(locs.length, 2);
    assert.equal(locs[0].range.start.line, 1);
    assert.equal(locs[1].range.start.line, 4);
  } finally {
    cleanup(ws);
  }
});
