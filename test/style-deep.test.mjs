import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, loadModule, makeDocument, makeWorkspace, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { Uri } = require(shimPath);

const {
  resolveImportUri,
  stripCommentsSafe,
  StyleCompletionProvider,
  collectImportedSymbols,
  registerStyleCompletion,
} = await loadModule(`
  export {
    resolveImportUri,
    stripCommentsSafe,
    StyleCompletionProvider,
    collectImportedSymbols,
    registerStyleCompletion,
  } from './src/providers/style-completion';
`);

test('collectImportedSymbols: CSS 嵌套（Nesting / Less / SCSS）与 & 父选择器变量作用域解析', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `
      .card {
        --card-bg: #fff;
        .header {
          --header-color: #333;
        }
        &.dark {
          --card-bg: #000;
        }
      }
    `;
    const doc = makeDocument(text, join(ws, 'nest.less'), 'less');
    const symbols = await collectImportedSymbols(doc);

    const headerVar = symbols.find(s => s.name === '--header-color');
    assert.ok(headerVar);
    assert.equal(headerVar.scope, '.card .header');

    const darkVar = symbols.find(s => s.name === '--card-bg' && s.value === '#000');
    assert.ok(darkVar);
    assert.equal(darkVar.scope, '.card.dark');
  } finally {
    cleanup(ws);
  }
});

test('resolveImportUri: 后缀补全、目录 index 与 SCSS partial 路径探测', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const dir = join(ws, 'styles');
    mkdirSync(join(dir, 'theme'), { recursive: true });

    writeFileSync(join(dir, 'plain.less'), '');
    writeFileSync(join(dir, 'theme', 'index.less'), '');
    writeFileSync(join(dir, '_partial.scss'), '');

    const docUri = Uri.file(join(dir, 'main.less'));

    const r1 = await resolveImportUri(docUri, './plain');
    assert.equal(r1?.fsPath, join(dir, 'plain.less'));

    const r2 = await resolveImportUri(docUri, './theme');
    assert.equal(r2?.fsPath, join(dir, 'theme', 'index.less'));

    const r3 = await resolveImportUri(docUri, './partial');
    assert.equal(r3?.fsPath, join(dir, '_partial.scss'));

    const r4 = await resolveImportUri(docUri, './not-found');
    assert.equal(r4, undefined);
  } finally {
    cleanup(ws);
  }
});

test('stripCommentsSafe: 安全剥离注释并保护 URL 与多引号字符串', () => {
  const input = `
    /* 块注释 */
    @url: "https://example.com/a//b";
    $bg: url('http://cdn.com/test.png'); // 单行注释
    --val: 'quoted /* not comment */ text';
  `;
  const clean = stripCommentsSafe(input);
  assert.ok(clean.includes('"https://example.com/a//b"'));
  assert.ok(clean.includes("'http://cdn.com/test.png'"));
  assert.ok(clean.includes("'quoted /* not comment */ text'"));
  assert.ok(!clean.includes('块注释'));
  assert.ok(!clean.includes('单行注释'));
});

test('StyleCompletionProvider: SCSS 变量、Mixin 与 CSS 原生变量端到端补全', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app');
    mkdirSync(app, { recursive: true });
    writeFileSync(
      join(app, 'vars.scss'),
      `
      $brand-color: #ff0000;
      @mixin center-layout { display: flex; align-items: center; }
      --global-padding: 16px;
    `
    );

    const doc = makeDocument(
      `@use "./vars";\n.container {\n  color: $bran\n  @cent\n  padding: var(--glo\n}`,
      join(app, 'comp.scss'),
      'scss'
    );

    const provider = new StyleCompletionProvider();

    const scssVarItems = await provider.provideCompletionItems(doc, { line: 2, character: 14 });
    assert.ok(scssVarItems?.some(i => i.label === '$brand-color'));

    const scssMixinItems = await provider.provideCompletionItems(doc, { line: 3, character: 7 });
    assert.ok(scssMixinItems?.some(i => i.label === '@center-layout'));

    const cssVarItems = await provider.provideCompletionItems(doc, { line: 4, character: 20 });
    assert.ok(cssVarItems?.some(i => i.label === '--global-padding'));
  } finally {
    cleanup(ws);
  }
});

test('StyleCompletionProvider: SCSS at-rule 与裸 @ 不与 mixin 抢补全', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app2');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'vars.scss'), '@mixin center-layout { display: flex; }\n');

    const doc = makeDocument('@use "./vars";\n.container {\n  @media\n  @\n  @cent\n}', join(app, 'comp.scss'), 'scss');
    const provider = new StyleCompletionProvider();

    const mediaItems = await provider.provideCompletionItems(doc, { line: 2, character: 8 });
    assert.ok(!mediaItems || mediaItems.length === 0);

    const bareItems = await provider.provideCompletionItems(doc, { line: 3, character: 3 });
    assert.ok(!bareItems || bareItems.length === 0);

    const mixinItems = await provider.provideCompletionItems(doc, { line: 4, character: 7 });
    assert.ok(mixinItems?.some(i => i.label === '@center-layout'));
  } finally {
    cleanup(ws);
  }
});

test('registerStyleCompletion 触发注册无报错', () => {
  const disposable = registerStyleCompletion();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, 'function');
  disposable.dispose();
});

test('resolveImportUri: 支持 stylus 与 postcss 路径探测 (P3)', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const dir = join(ws, 'styles-alt');
    mkdirSync(join(dir, 'theme'), { recursive: true });

    writeFileSync(join(dir, 'mixins.styl'), '');
    writeFileSync(join(dir, 'theme', 'index.pcss'), '');

    const docUri = Uri.file(join(dir, 'main.styl'));

    const r1 = await resolveImportUri(docUri, './mixins');
    assert.equal(r1?.fsPath, join(dir, 'mixins.styl'));

    const r2 = await resolveImportUri(docUri, './theme');
    assert.equal(r2?.fsPath, join(dir, 'theme', 'index.pcss'));
  } finally {
    cleanup(ws);
  }
});

test('StyleCompletionProvider: 多作用域同名 CSS 变量聚合为单一候选项', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app-scoped');
    mkdirSync(app, { recursive: true });
    writeFileSync(
      join(app, 'tokens.css'),
      `:root {\n  --color-primary: #007aff;\n}\n.dark {\n  --color-primary: #0a84ff;\n}`
    );

    const doc = makeDocument(`@import "./tokens.css";\n.btn { color: var(--col`, join(app, 'main.css'), 'css');
    const provider = new StyleCompletionProvider();

    const items = await provider.provideCompletionItems(doc, { line: 1, character: 23 });
    const primaryItems = items?.filter(i => i.label === '--color-primary') ?? [];

    assert.equal(primaryItems.length, 1);
    assert.equal(primaryItems[0].detail, '--color-primary');
    assert.ok(primaryItems[0].documentation.value.includes('`[:root]`'));
    assert.ok(primaryItems[0].documentation.value.includes('`[.dark]`'));
  } finally {
    cleanup(ws);
  }
});
