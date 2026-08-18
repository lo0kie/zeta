import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, loadModule, makeDocument, makeWorkspace, setConfig } from './helpers.mjs';

const { ImportHoverProvider } = await loadModule(`
  export { ImportHoverProvider } from './src/providers/import-hover';
`);

const provider = new ImportHoverProvider();

const normSep = p => (p ? p.replace(/\\/g, '/') : p);

test('ts 文件导入：悬浮显示打开链接与跳转目标路径', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'components'), { recursive: true });
    writeFileSync(join(ws, 'src', 'components', 'Button.tsx'), 'export const Button = () => null;');
    writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));

    const line = `import Button from '@/components/Button';\n`;
    const doc = makeDocument(line, join(ws, 'src', 'main.ts'), 'typescript');
    const hover = await provider.provideHover(doc, { line: 0, character: line.indexOf('@/components/Button') + 5 });

    assert.ok(hover, '应返回 Hover');
    const text = (hover.contents.value ?? '').replace(/\\/g, '/');
    assert.ok(text.includes(normSep(join(ws, 'src', 'components', 'Button.tsx'))), '应包含解析出的路径');
    assert.ok(text.includes('command:zeta.openResolvedImport'), '应包含可点击的打开命令链接');
    assert.ok(text.includes('跳转目标'), '应包含纯文本跳转目标');
  } finally {
    cleanup(ws);
  }
});

test('相对导入 ./foo：ts 与 less 都显示悬浮', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'foo.ts'), 'export const foo = 1;');
    writeFileSync(join(ws, 'bar.less'), '@c: red;');

    const tsLine = `import foo from './foo';\n`;
    const tsDoc = makeDocument(tsLine, join(ws, 'main.ts'), 'typescript');
    const tsHover = await provider.provideHover(tsDoc, { line: 0, character: 18 });
    assert.ok(tsHover, 'ts 相对导入应显示悬浮');
    assert.ok((tsHover.contents.value ?? '').includes('foo.ts'), 'ts 悬浮应含 foo.ts');

    const lessLine = `@import './bar';\n`;
    const lessDoc = makeDocument(lessLine, join(ws, 'main.less'), 'less');
    const lessHover = await provider.provideHover(lessDoc, { line: 0, character: 12 });
    assert.ok(lessHover, 'less 相对导入应显示悬浮');
    assert.ok((lessHover.contents.value ?? '').includes('bar.less'), 'less 悬浮应含 bar.less');
  } finally {
    cleanup(ws);
  }
});

test('样式别名导入：悬浮指向解析出的 .less', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'assets'), { recursive: true });
    writeFileSync(join(ws, 'src', 'assets', 'tokens.module.less'), ':export { a: 1 }');
    writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));

    const line = `@import '@/assets/tokens.module';\n`;
    const doc = makeDocument(line, join(ws, 'src', 'styles', 'main.less'), 'less');
    const hover = await provider.provideHover(doc, { line: 0, character: line.indexOf('tokens.module') + 5 });

    assert.ok(hover, '应返回 Hover');
    const text = (hover.contents.value ?? '').replace(/\\/g, '/');
    assert.ok(text.includes(normSep(join(ws, 'src', 'assets', 'tokens.module.less'))), '应包含解析出的 .less');
    assert.ok(text.includes('command:zeta.openResolvedImport'), '应包含打开命令链接');

    const qStart = line.indexOf("'");
    const qEnd = line.lastIndexOf("'") + 1;
    assert.equal(hover.range.start.character, qStart);
    assert.equal(hover.range.end.character, qEnd);
  } finally {
    cleanup(ws);
  }
});

test('非路径字符串与裸模块导入不产生悬浮', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'bootstrap.less'), '');

    const contentDoc = makeDocument(`const msg = "hello world";\n`, join(ws, 'main.ts'), 'typescript');
    assert.equal(await provider.provideHover(contentDoc, { line: 0, character: 15 }), undefined, '普通字符串不应有悬浮');

    const bareDoc = makeDocument(`@import 'bootstrap';\n`, join(ws, 'main.less'), 'less');
    assert.equal(await provider.provideHover(bareDoc, { line: 0, character: 12 }), undefined, '裸包名不应有悬浮');
  } finally {
    cleanup(ws);
  }
});

test('多个命中时悬浮逐行列出全部打开链接', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'foo.ts'), 'export const a = 1;');
    writeFileSync(join(ws, 'foo.css'), '.foo { color: red; }');
    const line = `@import './foo';\n`;
    const doc = makeDocument(line, join(ws, 'main.less'), 'less');
    const hover = await provider.provideHover(doc, { line: 0, character: line.indexOf('foo') + 2 });
    assert.ok(hover, '应返回 Hover');
    const text = hover.contents.value ?? '';
    assert.ok(text.includes('foo.ts'), '应包含 foo.ts 链接');
    assert.ok(text.includes('foo.css'), '应包含 foo.css 链接');
  } finally {
    cleanup(ws);
  }
});
