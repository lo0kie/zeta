import unwrapTags from '@/commands/unwrap-tags';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as vscode from 'vscode';
import { editorWith, makeDocument, setConfig } from './helpers';

const { Selection, Position } = vscode;

function lastApply(): Array<{ range: vscode.Range; text: string }> {
  return globalThis.__lastApply ?? [];
}

function applyOpsToText(text: string, doc: vscode.TextDocument, ops: Array<{ range: vscode.Range; text: string }>) {
  const edits = ops
    .map(op => ({ start: doc.offsetAt(op.range.start), end: doc.offsetAt(op.range.end), text: op.text }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let cursor = 0;
  for (const e of edits) {
    out += text.slice(cursor, e.start);
    out += e.text;
    cursor = e.end;
  }
  out += text.slice(cursor);
  return out;
}

test('unwrapTags: 单行标签移除', async () => {
  setConfig({});
  {
    const doc = makeDocument('<span>text</span>', '/virtual/u1.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 3), new Position(0, 3)));
    globalThis.__lastApply = null;
    await unwrapTags(editor);
    const ops = lastApply();
    assert.equal(ops.length, 2);
    const texts = ops.map(o => doc.getText(o.range)).sort();
    assert.deepEqual(texts, ['</span>', '<span>'].sort());
  }
});

test('unwrapTags: 多行空标签删除区间相邻不重叠', async () => {
  setConfig({});
  {
    const doc = makeDocument('<div>\n</div>', '/virtual/u2.html', 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 1), new Position(0, 1)));
    globalThis.__lastApply = null;
    await unwrapTags(editor);
    const ops = lastApply();
    assert.equal(ops.length, 2);
    const [r1, r2] = ops.map(o => o.range);
    assert.deepEqual([r1.start.line, r1.start.character, r1.end.line, r1.end.character], [0, 0, 1, 0]);
    assert.deepEqual([r2.start.line, r2.start.character, r2.end.line, r2.end.character], [1, 0, 1, 6]);
    assert.ok(r1.end.line === r2.start.line && r1.end.character === r2.start.character);
  }
});

test('unwrapTags: 嵌套标签与多光标同时解构', async () => {
  setConfig({});
  {
    const text = '<div><span>item 1</span></div>\n<section><p>item 2</p></section>';
    const doc = makeDocument(text, '/virtual/u3.html', 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 7), new Position(0, 7)),
      new Selection(new Position(1, 11), new Position(1, 11)),
    ]);
    globalThis.__lastApply = null;
    await unwrapTags(editor);
    assert.equal(lastApply().length, 4);
  }
});

test('unwrapTags: 多光标命中同一标签对去重', async () => {
  setConfig({});
  {
    const text = '<div>x</div>';
    const doc = makeDocument(text, '/virtual/u4.html', 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 2), new Position(0, 2)),
      new Selection(new Position(0, 3), new Position(0, 3)),
      new Selection(new Position(0, 4), new Position(0, 4)),
    ]);
    globalThis.__lastApply = null;
    await unwrapTags(editor);
    const ops = lastApply();
    assert.equal(ops.length, 2);
    const ranges = ops.map(o => o.range).sort((a, b) => a.start.compareTo(b.start));
    for (let i = 1; i < ranges.length; i++) {
      assert.ok(ranges[i].start.compareTo(ranges[i - 1].end) >= 0);
    }
    assert.equal(applyOpsToText(text, doc, ops), 'x');
  }
});

test('unwrapTags: 嵌套多行标签解构重叠区间合并', async () => {
  setConfig({});
  {
    const text = '<div>\n  <span>x</span>\n</div>';
    const doc = makeDocument(text, '/virtual/u5.html', 'html');
    const editor = editorWith(doc, [
      new Selection(new Position(1, 6), new Position(1, 6)),
      new Selection(new Position(0, 1), new Position(0, 1)),
    ]);
    globalThis.__lastApply = null;
    await unwrapTags(editor);
    const ops = lastApply();
    const ranges = ops.map(o => [doc.offsetAt(o.range.start), doc.offsetAt(o.range.end)]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) {
      assert.ok(ranges[i][0] >= ranges[i - 1][1]);
    }
    assert.equal(applyOpsToText(text, doc, ops), 'x\n');
  }
});

test('unwrapTags: Fragment 内光标解包最内层 div，Fragment 保留', async () => {
  setConfig({});
  {
    const text = '<>\n  <div>hi</div>\n</>';
    const doc = makeDocument(text, '/virtual/u6.tsx', 'typescriptreact');
    // 光标在 div 内：findTagPairAt 选最内层是 div，unwrap div，Fragment 配对不干扰
    const caret = text.indexOf('hi') + 1;
    const line = text.slice(0, caret).split('\n').length - 1;
    const col = caret - text.lastIndexOf('\n', caret) - 1;
    const editor = editorWith(doc, new Selection(new Position(line, col), new Position(line, col)));
    globalThis.__lastApply = null;
    await unwrapTags(editor);
    const ops = lastApply();
    assert.ok(ops.length > 0, '应删除 div 标签');
    assert.equal(applyOpsToText(text, doc, ops), '<>\n  hi\n</>', 'div 解包后 Fragment 保留');
  }
});

test('unwrapTags: 仅 Fragment（光标不在内层标签）时可解包', async () => {
  setConfig({});
  {
    const text = '<>\n  <span>x</span>\n  <span>y</span>\n</>';
    const doc = makeDocument(text, '/virtual/u7.tsx', 'typescriptreact');
    // 光标在 Fragment 内的空白处（span 之间），不在任何内层标签内 → 解包 Fragment
    const caret = text.indexOf('span>y') - 3;
    const line = text.slice(0, caret).split('\n').length - 1;
    const col = caret - text.lastIndexOf('\n', caret) - 1;
    const editor = editorWith(doc, new Selection(new Position(line, col), new Position(line, col)));
    globalThis.__lastApply = null;
    await unwrapTags(editor);
    const ops = lastApply();
    assert.ok(ops.length > 0, '应删除 Fragment 标签');
    const result = applyOpsToText(text, doc, ops);
    assert.ok(result.includes('<span>x</span>') && result.includes('<span>y</span>'), '内层 span 保留');
    assert.ok(!result.includes('<>') && !result.includes('</>'), 'Fragment 标签已移除');
  }
});
