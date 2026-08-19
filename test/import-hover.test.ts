import { ImportHoverProvider } from '@/providers/import-hover';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import * as vscode from 'vscode';
import { cleanup, hoverText, makeDocument, makeWorkspace, noopToken, setConfig } from './helpers';

const provider = new ImportHoverProvider();

test('相对导入 ./foo：ts 与 less 都显示悬浮，Range 覆盖整个字符串', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'foo.ts'), 'export const foo = 1;');
    writeFileSync(join(ws, 'bar.less'), '@c: red;');

    const tsLine = `import foo from './foo';\n`;
    const tsDoc = makeDocument(tsLine, join(ws, 'main.ts'), 'typescript');
    const tsHover = await provider.provideHover(tsDoc, new vscode.Position(0, 18), noopToken);
    assert.ok(tsHover, 'ts 相对导入应显示悬浮');
    assert.ok(hoverText(tsHover).includes('foo.ts'), 'ts 悬浮应含 foo.ts');

    const lessLine = `@import './bar';\n`;
    const lessDoc = makeDocument(lessLine, join(ws, 'main.less'), 'less');
    const lessHover = await provider.provideHover(lessDoc, new vscode.Position(0, 12), noopToken);
    assert.ok(lessHover, 'less 相对导入应显示悬浮');
    assert.ok(hoverText(lessHover).includes('bar.less'), 'less 悬浮应含 bar.less');

    // Range 应覆盖整个字符串字面量（含引号），供下划线提示
    const qStart = lessLine.indexOf("'");
    const qEnd = lessLine.lastIndexOf("'") + 1;
    assert.equal(lessHover.range!.start.character, qStart);
    assert.equal(lessHover.range!.end.character, qEnd);
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
    assert.equal(
      await provider.provideHover(contentDoc, new vscode.Position(0, 15), noopToken),
      undefined,
      '普通字符串不应有悬浮'
    );

    const bareDoc = makeDocument(`@import 'bootstrap';\n`, join(ws, 'main.less'), 'less');
    assert.equal(
      await provider.provideHover(bareDoc, new vscode.Position(0, 12), noopToken),
      undefined,
      '裸包名不应有悬浮'
    );
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
    const hover = await provider.provideHover(doc, new vscode.Position(0, line.indexOf('foo') + 2), noopToken);
    assert.ok(hover, '应返回 Hover');
    const text = hoverText(hover);
    assert.ok(text.includes('foo.ts'), '应包含 foo.ts 链接');
    assert.ok(text.includes('foo.css'), '应包含 foo.css 链接');
  } finally {
    cleanup(ws);
  }
});
