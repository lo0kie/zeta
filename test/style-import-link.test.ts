import { StyleImportLinkProvider } from '@/providers/style-import-link';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { cleanup, makeDocument, makeWorkspace, noopToken, normSep, setConfig } from './helpers';

const provider = new StyleImportLinkProvider();

test('相对路径 @import ./vars 链接到 vars.less，范围覆盖整个字符串', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'styles'), { recursive: true });
    writeFileSync(join(ws, 'src', 'styles', 'vars.less'), '@c: red;');
    const line = `@import './vars';\n`;
    const doc = makeDocument(line, join(ws, 'src', 'styles', 'main.less'), 'less');
    const links = await provider.provideDocumentLinks(doc, noopToken);
    assert.equal(links.length, 1);
    assert.equal(normSep(links[0].target!.fsPath), normSep(join(ws, 'src', 'styles', 'vars.less')));

    // 链接 Range 应恰好覆盖整个字符串字面量（含引号），供下划线提示
    const qStart = line.indexOf("'");
    const qEnd = line.lastIndexOf("'") + 1;
    assert.equal(links[0].range.start.line, 0);
    assert.equal(links[0].range.start.character, qStart, '起点应在字符串开头引号处');
    assert.equal(links[0].range.end.character, qEnd, '终点应在字符串结尾引号后');
    assert.equal(
      line.slice(links[0].range.start.character, links[0].range.end.character),
      "'./vars'",
      '链接范围应恰好覆盖整个字符串字面量（含引号）'
    );
  } finally {
    cleanup(ws);
  }
});

test('@use 相对导入同样生成链接（目录 index 回退）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'theme'), { recursive: true });
    writeFileSync(join(ws, 'src', 'theme', 'index.scss'), '$primary: #fff;');
    const doc = makeDocument(`@use '../theme';\n`, join(ws, 'src', 'styles', 'main.scss'), 'scss');
    const links = await provider.provideDocumentLinks(doc, noopToken);
    assert.equal(links.length, 1);
    assert.equal(normSep(links[0].target!.fsPath), normSep(join(ws, 'src', 'theme', 'index.scss')));
  } finally {
    cleanup(ws);
  }
});

test('url() 相对路径生成链接', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'img'), { recursive: true });
    writeFileSync(join(ws, 'src', 'img', 'logo.less'), '');
    const doc = makeDocument(
      `.logo { background: url('../img/logo'); }\n`,
      join(ws, 'src', 'styles', 'main.less'),
      'less'
    );
    const links = await provider.provideDocumentLinks(doc, noopToken);
    assert.equal(links.length, 1);
    assert.equal(normSep(links[0].target!.fsPath), normSep(join(ws, 'src', 'img', 'logo.less')));
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
    const links = await provider.provideDocumentLinks(doc, noopToken);
    assert.equal(links.length, 2, '两个导入各生成一条链接');
    assert.equal(normSep(links[0].target!.fsPath), normSep(join(ws, 'a.less')));
    assert.equal(normSep(links[1].target!.fsPath), normSep(join(ws, 'b.less')));
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
    const links = await provider.provideDocumentLinks(doc, noopToken);
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
    const links = await provider.provideDocumentLinks(doc, noopToken);
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
    const links = await provider.provideDocumentLinks(doc, noopToken);
    assert.equal(links.length, 0);
  } finally {
    cleanup(ws);
  }
});
