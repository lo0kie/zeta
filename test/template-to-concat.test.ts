import splitTemplateToConcat from '@/commands/template-to-concat';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as vscode from 'vscode';
import { editorWith, makeDocument, setConfig } from './helpers';
const { Selection, Position } = vscode;

function lastApply() {
  return globalThis.__lastApply ?? [];
}

test('templateToConcat: 含表达式的模板拆为拼接', async () => {
  setConfig({});
  {
    const text = 'const s = `hello ${name}`;';
    const doc = makeDocument(text, '/virtual/t1.ts', 'typescript');
    // 光标在模板内
    const editor = editorWith(doc, new Selection(new Position(0, 13), new Position(0, 13)));
    globalThis.__lastApply = null;
    await splitTemplateToConcat(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1, '应产生一次编辑');
    assert.equal(ops[0].text, "'hello ' + name");
  }
});

test('templateToConcat: 多表达式模板拆为多段拼接', async () => {
  setConfig({});
  {
    const text = 'const s = `a ${x} b ${y} c`;';
    const doc = makeDocument(text, '/virtual/t2.ts', 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 13), new Position(0, 13)));
    globalThis.__lastApply = null;
    await splitTemplateToConcat(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, "'a ' + x + ' b ' + y + ' c'");
  }
});

test('templateToConcat: 无表达式的纯文本模板不拆', async () => {
  setConfig({});
  {
    const text = 'const s = `plain`;';
    const doc = makeDocument(text, '/virtual/t3.ts', 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 13), new Position(0, 13)));
    globalThis.__lastApply = null;
    await splitTemplateToConcat(editor);
    assert.equal(lastApply().length, 0, '无表达式不编辑');
  }
});

test('templateToConcat: 多光标命中同一模板只转换一次', async () => {
  setConfig({});
  {
    const text = 'const s = `${a}${b}`;';
    const doc = makeDocument(text, '/virtual/t4.ts', 'typescript');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 11), new Position(0, 11)),
      new Selection(new Position(0, 14), new Position(0, 14)),
    ]);
    globalThis.__lastApply = null;
    await splitTemplateToConcat(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1, '同一模板只转换一次');
    assert.equal(ops[0].text, 'a + b');
  }
});

test('templateToConcat: 转换后光标保持相对位置，不因长度变化漂移', async () => {
  setConfig({});
  {
    // 用户场景：模板拆成拼接后文本长度变化，光标须保持在「前段文本」内的原相对位置
    const text = 'const msg = `已扫描 ${n} 个和弦`;';
    const doc = makeDocument(text, '/virtual/t5.ts', 'typescript');
    // 光标在「已扫描 」文本内（前缀，位于 `${` 之前）
    const prefixEnd = text.indexOf('${');
    const caretOffset = prefixEnd - 1; // 前缀文本内某处
    const editor = editorWith(doc, new Selection(new Position(0, caretOffset), new Position(0, caretOffset)));
    globalThis.__lastApply = null;
    await splitTemplateToConcat(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1, '应产生一次编辑');
    assert.equal(ops[0].text, `'已扫描 ' + n + ' 个和弦'`);
    // 光标应映射到新拼接文本中「'已扫描 '」字符串内部相同相对位置
    // 原前缀起点 = 反引号后 1，光标偏移 1 相对前缀起点；新前缀 "'已扫描 '" 起点相同偏移仍有效
    const sel = editor.selections[0];
    assert.deepEqual([sel.active.line, sel.active.character], [0, caretOffset], '光标应保持在文本内原相对位置');
  }
});

test('templateToConcat: 非空选区选中模板前缀文本，转换后选区保持原相对区间', async () => {
  setConfig({});
  {
    const text = 'const msg = `已扫描 ${n} 个和弦`;';
    const doc = makeDocument(text, '/virtual/t6.ts', 'typescript');
    const prefixStart = text.indexOf('已扫描');
    // 选中「已扫描 」前缀（不含 ${）
    const editor = editorWith(doc, new Selection(new Position(0, prefixStart), new Position(0, prefixStart + 3)));
    globalThis.__lastApply = null;
    await splitTemplateToConcat(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, `'已扫描 ' + n + ' 个和弦'`);
    // 选区应仍映射到新文本中「'已扫描 '」字符串内的相同相对区间
    const sel = editor.selections[0];
    assert.deepEqual([sel.start.line, sel.start.character], [0, prefixStart], '选区起点应保持相对位置');
    assert.deepEqual([sel.end.line, sel.end.character], [0, prefixStart + 3], '选区终点应保持相对位置');
  }
});

test('templateToConcat: 拼接链自动合并为模板字符串', async () => {
  setConfig({});
  {
    const text = "const s = 'a' + x + 'b';";
    const doc = makeDocument(text, '/virtual/t7.ts', 'typescript');
    // 光标在拼接链内的字符串 'a' 中
    const editor = editorWith(doc, new Selection(new Position(0, 12), new Position(0, 12)));
    globalThis.__lastApply = null;
    await splitTemplateToConcat(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1, '拼接链应合并为模板');
    assert.equal(ops[0].text, '`a${x}b`');
  }
});

test('templateToConcat: 拼接链转换后光标保持在模板内相对位置', async () => {
  setConfig({});
  {
    const text = "const s = 'a' + x + 'b';";
    const doc = makeDocument(text, '/virtual/t8.ts', 'typescript');
    const chainStart = text.indexOf("'a'");
    // 光标在 'a' 的内容 a 内（相对链起点 offset 1 = 引号后 1）
    const editor = editorWith(doc, new Selection(new Position(0, chainStart + 1), new Position(0, chainStart + 1)));
    globalThis.__lastApply = null;
    await splitTemplateToConcat(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '`a${x}b`');
    // 模板 `` `a${x}b` `` 中 a 的起点 = 反引号后 1 → 文档 offset = 原链起点 + 1
    const sel = editor.selections[0];
    assert.deepEqual([sel.active.line, sel.active.character], [0, chainStart + 1], '光标应映射到模板前缀 a 内');
  }
});

test('templateToConcat: 拼接链整体选中时转换后选中整个模板', async () => {
  setConfig({});
  {
    const text = "const s = 'a' + x;";
    const doc = makeDocument(text, '/virtual/t9.ts', 'typescript');
    const chainStart = text.indexOf("'a'");
    // 选中整条链 "'a' + x"
    const editor = editorWith(
      doc,
      new Selection(new Position(0, chainStart), new Position(0, chainStart + "'a' + x".length))
    );
    globalThis.__lastApply = null;
    await splitTemplateToConcat(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '`a${x}`');
    // 选区应覆盖整个新模板 `` `a${x}` ``
    const sel = editor.selections[0];
    const newStart = text.indexOf("'a'");
    assert.deepEqual([sel.start.line, sel.start.character], [0, newStart], '选区起点应在新模板起点');
    assert.deepEqual([sel.end.line, sel.end.character], [0, newStart + '`a${x}`'.length], '选区终点应在新模板末尾');
  }
});
