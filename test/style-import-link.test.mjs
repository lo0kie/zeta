import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, loadModule, makeDocument, makeWorkspace, setConfig } from './helpers.mjs';

const { StyleImportLinkProvider } = await loadModule(`
  export { StyleImportLinkProvider } from './src/providers/style-import-link';
`);

const provider = new StyleImportLinkProvider();

const normSep = p => (p ? p.replace(/\\/g, '/') : p);

function linkInfo(links) {
  return (links ?? []).map(l => ({
    target: l.target?.fsPath,
    range: l.range && [
      l.range.start.line,
      l.range.start.character,
      l.range.end.line,
      l.range.end.character,
    ],
  }));
}

function makeTsconfig(ws) {
  writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));
}

test('less @import 别名 + tsconfig：链接指向 tokens.module.less，范围覆盖整个字符串', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'assets'), { recursive: true });
    writeFileSync(join(ws, 'src', 'assets', 'tokens.module.less'), ':export { a: 1 }');
    makeTsconfig(ws);

    const line = `@import '@/assets/tokens.module';\n`;
    const doc = makeDocument(line, join(ws, 'src', 'styles', 'main.less'), 'less');
    const links = await provider.provideDocumentLinks(doc);

    assert.equal(links.length, 1, '应生成 1 条链接');
    const [link] = links;
    assert.ok(link.target, '应指向真实文件');
    assert.equal(normSep(link.target.fsPath), normSep(join(ws, 'src', 'assets', 'tokens.module.less')));

    const qStart = line.indexOf("'");
    const qEnd = line.lastIndexOf("'") + 1;
    assert.equal(link.range.start.line, 0);
    assert.equal(link.range.start.character, qStart, '起点应在字符串开头引号处');
    assert.equal(link.range.end.character, qEnd, '终点应在字符串结尾引号后');
    assert.equal(
      line.slice(link.range.start.character, link.range.end.character),
      "'@/assets/tokens.module'",
      '链接范围应恰好覆盖整个字符串字面量（含引号）'
    );
  } finally {
    cleanup(ws);
  }
});

test('相对路径 @import ./vars 链接到 vars.less', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'styles'), { recursive: true });
    writeFileSync(join(ws, 'src', 'styles', 'vars.less'), '@c: red;');
    const doc = makeDocument(`@import './vars';\n`, join(ws, 'src', 'styles', 'main.less'), 'less');
    const links = await provider.provideDocumentLinks(doc);
    assert.equal(links.length, 1);
    assert.equal(normSep(links[0].target.fsPath), normSep(join(ws, 'src', 'styles', 'vars.less')));
  } finally {
    cleanup(ws);
  }
});

test('@use 别名导入同样生成链接', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'theme'), { recursive: true });
    writeFileSync(join(ws, 'src', 'theme', 'index.scss'), '$primary: #fff;');
    makeTsconfig(ws);
    const doc = makeDocument(`@use '@/theme';\n`, join(ws, 'src', 'styles', 'main.scss'), 'scss');
    const links = await provider.provideDocumentLinks(doc);
    assert.equal(links.length, 1);
    assert.equal(normSep(links[0].target.fsPath), normSep(join(ws, 'src', 'theme', 'index.scss')));
  } finally {
    cleanup(ws);
  }
});

test('url() 引号路径生成链接', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'img'), { recursive: true });
    writeFileSync(join(ws, 'src', 'img', 'logo.less'), '');
    makeTsconfig(ws);
    const doc = makeDocument(`.logo { background: url('@/img/logo'); }\n`, join(ws, 'src', 'styles', 'main.less'), 'less');
    const links = await provider.provideDocumentLinks(doc);
    assert.equal(links.length, 1);
    assert.equal(normSep(links[0].target.fsPath), normSep(join(ws, 'src', 'img', 'logo.less')));
  } finally {
    cleanup(ws);
  }
});

test('同一行多个导入生成多条链接', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'a.less'), '');
    writeFileSync(join(ws, 'b.less'), '');
    const doc = makeDocument(`@import './a'; @import './b';\n`, join(ws, 'main.less'), 'less');
    const links = await provider.provideDocumentLinks(doc);
    assert.equal(links.length, 2, '两个导入各生成一条链接');
    assert.equal(normSep(links[0].target.fsPath), normSep(join(ws, 'a.less')));
    assert.equal(normSep(links[1].target.fsPath), normSep(join(ws, 'b.less')));
  } finally {
    cleanup(ws);
  }
});

test('裸模块说明符 @import bootstrap 不生成链接（避免误解析）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'bootstrap.less'), '');
    const doc = makeDocument(`@import 'bootstrap';\n`, join(ws, 'main.less'), 'less');
    const links = await provider.provideDocumentLinks(doc);
    assert.equal(links.length, 0, '裸包名不应生成链接');
  } finally {
    cleanup(ws);
  }
});

test('外部 URL 不生成本地链接', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument(
      `.logo { background: url('https://cdn.example.com/x.png'); }\n@import '//fonts/x.css';\n`,
      join(ws, 'main.less'),
      'less'
    );
    const links = await provider.provideDocumentLinks(doc);
    assert.equal(links.length, 0, '外部/协议相对 URL 不应生成链接');
  } finally {
    cleanup(ws);
  }
});

test('非导入位置的普通字符串不生成链接', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument(`.tip::before { content: "hello"; }\n`, join(ws, 'main.less'), 'less');
    const links = await provider.provideDocumentLinks(doc);
    assert.equal(links.length, 0);
  } finally {
    cleanup(ws);
  }
});
