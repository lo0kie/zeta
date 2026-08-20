import {
  clearStyleFileCache,
  collectImportedFiles,
  collectImportedSymbols,
  getStyleBlocks,
  resolveImportUri,
  stripCommentsSafe,
  StyleCompletionProvider,
} from '@/providers/style-completion';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { CompletionItemKind, MarkdownString, Position, SnippetString, Uri } from 'vscode';
import { cleanup, makeDocument, makeWorkspace, setConfig } from './helpers';

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

test('resolveImportUri: 后缀补全、目录 index 与 partial / stylus / postcss 路径探测', async () => {
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

    // stylus / postcss：独立目录，避免 index.less 干扰 index.pcss 的探测
    const alt = join(ws, 'styles-alt');
    mkdirSync(join(alt, 'theme'), { recursive: true });
    writeFileSync(join(alt, 'mixins.styl'), '');
    writeFileSync(join(alt, 'theme', 'index.pcss'), '');
    const altDoc = Uri.file(join(alt, 'main.styl'));
    assert.equal((await resolveImportUri(altDoc, './mixins'))?.fsPath, join(alt, 'mixins.styl'));
    assert.equal((await resolveImportUri(altDoc, './theme'))?.fsPath, join(alt, 'theme', 'index.pcss'));
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

    const scssVarItems = await provider.provideCompletionItems(doc, new Position(2, 14));
    assert.ok(scssVarItems?.some(i => i.label === '$brand-color'));

    const scssMixinItems = await provider.provideCompletionItems(doc, new Position(3, 7));
    assert.ok(scssMixinItems?.some(i => i.label === '@center-layout'));

    const cssVarItems = await provider.provideCompletionItems(doc, new Position(4, 20));
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

    const mediaItems = await provider.provideCompletionItems(doc, new Position(2, 8));
    assert.ok(!mediaItems || mediaItems.length === 0);

    const bareItems = await provider.provideCompletionItems(doc, new Position(3, 3));
    assert.ok(!bareItems || bareItems.length === 0);

    const mixinItems = await provider.provideCompletionItems(doc, new Position(4, 7));
    assert.ok(mixinItems?.some(i => i.label === '@center-layout'));
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

    const items = await provider.provideCompletionItems(doc, new Position(1, 23));
    const primaryItems = items?.filter(i => i.label === '--color-primary') ?? [];

    assert.equal(primaryItems.length, 1);
    // 不再设置 detail：补全项顶部不重复显示变量名（label 已有）
    assert.equal(primaryItems[0].detail, undefined);
    // 文档渲染与 hover 一致：代码块展示定义的样子（多命名空间）+ 下方纯色色块预览
    const docVal = (primaryItems[0].documentation as MarkdownString).value;
    assert.ok(docVal.includes(':root --color-primary: #007aff;'), '代码块展示 :root 定义');
    assert.ok(docVal.includes('.dark --color-primary: #0a84ff;'), '代码块展示 .dark 定义');
    assert.ok(docVal.includes('```css'), '代码块语言 id 为 css');
    assert.ok(docVal.includes('![#007aff](') && docVal.includes('![#0a84ff]('), '各命名空间纯色追加色块预览');
    assert.ok(docVal.includes('`#007aff`  \n![#0a84ff]('), '色块之间真正换行（hard break）');
  } finally {
    cleanup(ws);
  }
});
test('Less 递归嵌套 @import 解析（最多 3 层并防循环引用）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app');
    mkdirSync(app, { recursive: true });

    writeFileSync(join(app, 'c.less'), '@c-var: #333;\n');
    writeFileSync(join(app, 'b.less'), '@import "./c";\n@b-var: #222;\n');
    writeFileSync(join(app, 'a.less'), '@import "./b";\n@a-var: #111;\n');

    const doc = makeDocument('@import "./a";\n', join(app, 'main.less'), 'less');
    const files = await collectImportedFiles(doc);
    assert.equal(files.length, 3);

    const symbols = await collectImportedSymbols(doc);
    assert.ok(symbols.some(s => s.name === '@a-var'));
    assert.ok(symbols.some(s => s.name === '@b-var'));
    assert.ok(symbols.some(s => s.name === '@c-var'));
  } finally {
    cleanup(ws);
  }
});

test('Vue SFC 多 <style> 块不同语言解析隔离', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `
<template><div></div></template>
<style lang="less">
  @less-color: #1890ff;
  .box-less(@w: 10px) { width: @w; }
</style>
<style lang="scss">
  $scss-color: #ff4d4f;
  @mixin box-scss($h: 20px) { height: $h; }
</style>
<style>
  --css-var: #000;
</style>
`;
    const doc = makeDocument(text, join(ws, 'multi.vue'), 'vue');
    const symbols = await collectImportedSymbols(doc);

    assert.ok(symbols.some(s => s.name === '@less-color' && s.kind === 'variable'));
    assert.ok(symbols.some(s => s.name === '.box-less' && s.kind === 'mixin'));
    assert.ok(symbols.some(s => s.name === '$scss-color' && s.kind === 'scss-variable'));
    assert.ok(symbols.some(s => s.name === '@box-scss' && s.kind === 'scss-mixin'));
    assert.ok(symbols.some(s => s.name === '--css-var' && s.kind === 'css-variable'));
  } finally {
    cleanup(ws);
  }
});

test('Vue 模板 HTML 注释里的 <style> 不被当作样式块', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    // 注释里写 <style>...</style> 是「临时禁用样式块」的常见做法，不应被解析为真实块
    const text = `<template>
<!-- <style>.disabled { color: red; }</style> -->
</template>
<style lang="less">
@c: #1890ff;
</style>
`;
    const doc = makeDocument(text, join(ws, 'commented.vue'), 'vue');
    const blocks = getStyleBlocks(doc);

    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].lang, 'less');
    assert.ok(blocks[0].content.includes('@c'));
    assert.ok(!blocks[0].content.includes('.disabled'));
  } finally {
    cleanup(ws);
  }
});

test('Mixin 复杂参数：带逗号的字符串与分号分隔符', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const less = `
.custom-btn(@label: "hello, world", @color: #fff) { content: @label; }
.box-border(@w: 1px; @c: #000) { border: @w solid @c; }
`;
    const doc = makeDocument(less, join(ws, 'complex.less'), 'less');
    const symbols = await collectImportedSymbols(doc);

    const btn = symbols.find(s => s.name === '.custom-btn');
    assert.ok(btn);
    assert.equal(btn.snippet, '.custom-btn(${1:@label: "hello, world"}, ${2:@color: #fff});');

    const border = symbols.find(s => s.name === '.box-border');
    assert.ok(border);
    assert.equal(border.snippet, '.box-border(${1:@w: 1px}, ${2:@c: #000});');
  } finally {
    cleanup(ws);
  }
});

test('Mixin 补全：光标后已有分号时自动移除 Snippet 末尾分号', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'm.less'), '.btn(@size: 12px) { font-size: @size; }\n');

    const text = '@import "./m";\n.a { .btn; }\n';
    const doc = makeDocument(text, join(app, 'main.less'), 'less');
    const provider = new StyleCompletionProvider();

    const line1 = text.split('\n')[1];
    const triggerPos = new Position(1, line1.indexOf('.btn') + 4);
    const items = (await provider.provideCompletionItems(doc, triggerPos)) ?? [];

    const btnItem = items.find(i => i.label === '.btn');
    assert.ok(btnItem);
    assert.equal((btnItem.insertText as SnippetString).value, '.btn(${1:@size: 12px})');
  } finally {
    cleanup(ws);
  }
});

test('Mixin 参数值字符串内含分号时仍按顶层逗号分隔', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const less = `
.semi(@a: "x;y", @b: 2) { content: @a; }
`;
    const doc = makeDocument(less, join(ws, 'semi.less'), 'less');
    const symbols = await collectImportedSymbols(doc);

    const semi = symbols.find(s => s.name === '.semi');
    assert.ok(semi);
    // 字符串内的 ; 不参与分隔符判定：顶层逗号分隔，两个参数分别生成 tabstop
    assert.equal(semi.snippet, '.semi(${1:@a: "x;y"}, ${2:@b: 2});');
  } finally {
    cleanup(ws);
  }
});

test('保存被导入文件后引用方缓存失效', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'app'), { recursive: true });
    const themePath = join(ws, 'app', 'theme.less');
    const mainPath = join(ws, 'app', 'main.less');
    writeFileSync(themePath, '@c: #111;\n');
    const doc = makeDocument('@import "./theme";\n.a { color: @c; }\n', mainPath, 'less', 5);

    assert.equal((await collectImportedSymbols(doc)).find(s => s.name === '@c')?.value, '#111');

    writeFileSync(themePath, '@c: #222;\n');
    clearStyleFileCache(Uri.file(themePath));

    assert.equal((await collectImportedSymbols(doc)).find(s => s.name === '@c')?.value, '#222');
  } finally {
    cleanup(ws);
  }
});

test('保存三级依赖链最底层文件后，全部引用方缓存失效（B 导 A、C 导 B 场景）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app');
    mkdirSync(app, { recursive: true });

    // main → a → b → c 三级依赖链
    const cPath = join(app, 'c.less');
    const bPath = join(app, 'b.less');
    const aPath = join(app, 'a.less');
    const mainPath = join(app, 'main.less');
    writeFileSync(cPath, '@c-var: #333;\n');
    writeFileSync(bPath, '@import "./c";\n@b-var: #222;\n');
    writeFileSync(aPath, '@import "./b";\n@a-var: #111;\n');
    const doc = makeDocument('@import "./a";\n', mainPath, 'less', 5);

    // 首轮解析：main 的缓存里合入了 @c-var 的旧值
    assert.equal((await collectImportedSymbols(doc)).find(s => s.name === '@c-var')?.value, '#333');

    // 修改最底层 c.less 并保存
    writeFileSync(cPath, '@c-var: #444;\n');
    clearStyleFileCache(Uri.file(cPath));

    // 若传递依赖失效未生效，main 的缓存会返回旧值 #333
    assert.equal((await collectImportedSymbols(doc)).find(s => s.name === '@c-var')?.value, '#444');
  } finally {
    cleanup(ws);
  }
});

// 回归：阴影等多段值含 rgba 片段但整体不是颜色，不应被判为 Color kind（--shadow-sm 场景）
test('StyleCompletionProvider: 阴影变量判为变量而非颜色', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'app-shadow');
    mkdirSync(app, { recursive: true });
    writeFileSync(
      join(app, 'tokens.less'),
      `--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06);\n--brand: #ff9500;`
    );

    const doc = makeDocument(`@import "./tokens";\n.a { box-shadow: var(--sh`, join(app, 'main.less'), 'less');
    const provider = new StyleCompletionProvider();
    const items = (await provider.provideCompletionItems(doc, new Position(1, 25))) ?? [];

    const shadow = items.find(i => i.label === '--shadow-sm');
    assert.ok(shadow, '应补全 --shadow-sm');
    assert.notEqual(shadow.kind, CompletionItemKind.Color, '阴影变量不应判为颜色');
    // 阴影值不应显示色块（值里含 rgba 但整体不是色）
    assert.ok(!(shadow.documentation as MarkdownString).value.includes('!['), '阴影变量不应显示色块');

    // 纯色变量仍判为 Color 且显示色块
    const doc2 = makeDocument(`@import "./tokens";\n.a { color: var(--br`, join(app, 'main2.less'), 'less');
    const items2 = (await provider.provideCompletionItems(doc2, new Position(1, 21))) ?? [];
    const brand = items2.find(i => i.label === '--brand');
    assert.ok(brand, '应补全 --brand');
    assert.equal(brand.kind, CompletionItemKind.Color, '纯色变量应判为颜色');
    assert.ok((brand.documentation as MarkdownString).value.includes('![#ff9500]('), '纯色变量应显示色块');
  } finally {
    cleanup(ws);
  }
});

test('@use ... as 命名空间：裸 $ 不提示命名空间变量，c.$ 才提示', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'ns');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'colors.scss'), '$primary: #007aff;\n$secondary: #0a84ff;\n');

    // 裸 $ 补全：colors 的变量带 namespace（c），应被排除，不提示
    const bareDoc = makeDocument('@use "./colors" as c;\n.a { color: $p', join(app, 'comp1.scss'), 'scss');
    const provider = new StyleCompletionProvider();
    const bareItems = (await provider.provideCompletionItems(bareDoc, new Position(1, 14))) ?? [];
    assert.ok(!bareItems.some(i => i.label === '$primary'), '裸 $ 不提示命名空间变量');
    assert.ok(!bareItems.some(i => i.label === '$secondary'), '裸 $ 不提示命名空间变量');

    // c.$ 补全：提示 c 命名空间的变量
    const nsDoc = makeDocument('@use "./colors" as c;\n.a { color: c.$p', join(app, 'comp2.scss'), 'scss');
    const nsItems = (await provider.provideCompletionItems(nsDoc, new Position(1, 16))) ?? [];
    assert.ok(
      nsItems.some(i => i.label === '$primary'),
      'c.$ 提示命名空间变量 $primary'
    );
    assert.ok(
      nsItems.some(i => i.label === '$secondary'),
      'c.$ 提示命名空间变量 $secondary'
    );
  } finally {
    cleanup(ws);
  }
});

test('@use 无 as 别名时变量保持裸提示（宽松兼容）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const app = join(ws, 'ns2');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'vars.scss'), '$brand: #f50;\n');

    const doc = makeDocument('@use "./vars";\n.a { color: $br', join(app, 'comp3.scss'), 'scss');
    const provider = new StyleCompletionProvider();
    const items = (await provider.provideCompletionItems(doc, new Position(1, 14))) ?? [];
    assert.ok(
      items.some(i => i.label === '$brand'),
      '无 as 别名变量仍裸提示'
    );
  } finally {
    cleanup(ws);
  }
});
