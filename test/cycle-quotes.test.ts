import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as vscode from 'vscode';
import { editorWith, makeDocument, setConfig } from './helpers';
import cycleQuotes from '@/commands/cycle-quotes';
const { Selection, Position } = vscode;

function lastApply() {
  return globalThis.__lastApply ?? [];
}

test('cycleQuotes: 普通单双引号与模板字符串三态循环', async () => {
  setConfig({});
  {
    const text = 'const a = \'hello\';\nconst b = "world";\nconst c = `zeta`;';
    const doc = makeDocument(text, '/virtual/q1.ts', 'typescript');

    const editor1 = editorWith(doc, new Selection(new Position(0, 12), new Position(0, 12)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor1);
    assert.equal(lastApply()[0].text, '"hello"');

    const editor2 = editorWith(doc, new Selection(new Position(1, 12), new Position(1, 12)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor2);
    assert.equal(lastApply()[0].text, '`world`');

    const editor3 = editorWith(doc, new Selection(new Position(2, 12), new Position(2, 12)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor3);
    assert.equal(lastApply()[0].text, "'zeta'");
  }
});

test('cycleQuotes: 拼接链自动合并为模板字符串', async () => {
  setConfig({});
  {
    const text = 'const s = "a" + "b";';
    const doc = makeDocument(text, '/virtual/q2.ts', 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 13), new Position(0, 13)), {});
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '`ab`');
  }
});

// 回归：选中/光标在拼接链内时，整条链按 ' → " → ` 顺序整体推进——
// 单引号拼接链先整体换双引号（保留拼接结构），再执行才合并为模板。
test('cycleQuotes: 单引号拼接链整体换为双引号（保留拼接）', async () => {
  setConfig({});
  {
    const text = `const s = '已扫描本地数据，修复并对齐了 ' + repairedCount + ' 个和弦！';`;
    const doc = makeDocument(text, '/virtual/q_concat1.ts', 'typescript');
    // 光标在第一个字符串内
    const editor = editorWith(doc, new Selection(new Position(0, 13), new Position(0, 13)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1, '整条链应整体处理');
    assert.equal(ops[0].text, `"已扫描本地数据，修复并对齐了 " + repairedCount + " 个和弦！"`);
  }
});

test('cycleQuotes: 选中整条单引号拼接链整体换为双引号', async () => {
  setConfig({});
  {
    const text = `const s = '已扫描本地数据，修复并对齐了 ' + repairedCount + ' 个和弦！';`;
    const doc = makeDocument(text, '/virtual/q_concat2.ts', 'typescript');
    const start = text.indexOf("'已");
    const end = text.lastIndexOf("' 个") + "' 个和弦！'".length;
    const editor = editorWith(doc, new Selection(new Position(0, start), new Position(0, end)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1, '整条链应整体处理');
    assert.equal(ops[0].text, `"已扫描本地数据，修复并对齐了 " + repairedCount + " 个和弦！"`);
  }
});

test('cycleQuotes: 双引号拼接链合并为模板字符串', async () => {
  setConfig({});
  {
    const text = `const s = "已扫描本地数据，修复并对齐了 " + repairedCount + " 个和弦！";`;
    const doc = makeDocument(text, '/virtual/q_concat3.ts', 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 13), new Position(0, 13)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '`已扫描本地数据，修复并对齐了 ${repairedCount} 个和弦！`');
  }
});

// 回归：选区起止落在拼接链内部（不含两端引号）时，也应识别整条链并整体处理。
test('cycleQuotes: 选区不含两端引号仍命中整条拼接链', async () => {
  setConfig({});
  {
    const text = `start'已扫描本地数据，修复并对齐了 ' + repairedCount + ' 个和弦！'end`;
    const doc = makeDocument(text, '/virtual/q_concat4.ts', 'typescript');
    // 选区从第一个引号之后到最后一个引号之前（不含两端引号，覆盖链主体）
    const selStart = text.indexOf("'已") + 1;
    const selEnd = text.lastIndexOf("'end");
    const editor = editorWith(doc, new Selection(new Position(0, selStart), new Position(0, selEnd)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1, '整条拼接链应整体处理');
    assert.equal(ops[0].text, `"已扫描本地数据，修复并对齐了 " + repairedCount + " 个和弦！"`);
  }
});

test('cycleQuotes: JS/Vue 对象字面量中的属性 Key 绝不转为反引号', async () => {
  setConfig({});
  {
    const text = `const obj = { 'is-active': true };`;
    const doc = makeDocument(text, '/virtual/obj.ts', 'typescript');
    const quoteIndex = text.indexOf("'is-active'");
    const editor = editorWith(doc, new Selection(new Position(0, quoteIndex + 2), new Position(0, quoteIndex + 2)));

    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, '"is-active"');

    const doc2 = makeDocument(`const obj = { "is-active": true };`, '/virtual/obj2.ts', 'typescript');
    const editor2 = editorWith(doc2, new Selection(new Position(0, quoteIndex + 2), new Position(0, quoteIndex + 2)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor2);
    assert.equal(lastApply()[0].text, "'is-active'");
  }
});

test('cycleQuotes: Vue 动态指令属性值切换外层引号并反转内部冲突引号', async () => {
  setConfig({});
  {
    const text = `<template><comp :formatter="val => 'CAPO ' + val" /></template>`;
    const doc = makeDocument(text, '/virtual/q3.vue', 'vue');
    const quoteIndex = text.indexOf('"val =>');
    const editor = editorWith(doc, new Selection(new Position(0, quoteIndex), new Position(0, quoteIndex)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, `'val => "CAPO " + val'`);
  }
});

test('cycleQuotes: 多行模板字符串转普通引号自动处理换行转义', async () => {
  setConfig({});
  {
    const text = 'const msg = `hello\nworld`;';
    const doc = makeDocument(text, '/virtual/q4.ts', 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 14), new Position(0, 14)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, "'hello\\nworld'");
  }
});

// 回归：多光标选中不同字符串时，每个光标（含空光标）都独立转换其所在字符串——
// 非空选区存在不能导致其他字符串的空光标被忽略（旧实现会无条件跳过所有空光标）。
test('cycleQuotes: 选区与其他字符串空光标并存时各自独立转换', async () => {
  setConfig({});
  {
    const text = "const a = 'hello';\nconst b = 'world';";
    const doc = makeDocument(text, '/virtual/q_mixed.ts', 'typescript');

    const editor = editorWith(
      doc,
      [
        new Selection(new Position(0, 10), new Position(0, 17)), // 完整选中 'hello'
        new Selection(new Position(1, 12), new Position(1, 12)), // 光标停在 'world' 内部
      ],
      {}
    );

    globalThis.__lastApply = null;
    await cycleQuotes(editor);

    // 两个字符串各自转换
    const ops = lastApply();
    assert.equal(ops.length, 2);
    const sorted = [...ops].sort((a, b) => a.range.start.line - b.range.start.line);
    assert.equal(sorted[0].text, '"hello"');
    assert.equal(sorted[1].text, '"world"');
    // 光标保持相对位置（不漂到字符串末尾）
    const sel = editor.selections[1];
    assert.deepEqual([sel.active.line, sel.active.character], [1, 12]);
  }
});

// 回归：切换引号后光标位置必须保持（applyEdit 的默认行为会让光标漂移到替换末尾）。
test('cycleQuotes: 空光标在字符串内部时切换后保持原相对位置', async () => {
  setConfig({});
  {
    const text = "const a = 'hello';";
    const doc = makeDocument(text, '/virtual/q_cursor.ts', 'typescript');
    const caretOffset = text.indexOf('hello') + 1; // 'e' 处
    const editor = editorWith(doc, new Selection(new Position(0, caretOffset), new Position(0, caretOffset)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, '"hello"');
    // 光标应仍在最终文本的同一相对位置（'e' 处），而非漂到字符串末尾
    const sel = editor.selections[0];
    assert.deepEqual([sel.active.line, sel.active.character], [0, caretOffset]);
  }
});

test('cycleQuotes: 拼接链合并为模板后光标映射到链内对应位置', async () => {
  setConfig({});
  {
    const text = 'const s = "a" + "b";';
    const doc = makeDocument(text, '/virtual/q_cursor2.ts', 'typescript');
    const caretOffset = text.indexOf('"a"') + 1; // 'a' 处
    const editor = editorWith(doc, new Selection(new Position(0, caretOffset), new Position(0, caretOffset)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, '`ab`');
    // 光标相对链起点偏移 1（原 `"a"` 起点之后 1 = 'a'）映射到 `ab` 的 'a'
    const sel = editor.selections[0];
    const chainStart = text.indexOf('"a"');
    assert.deepEqual([sel.active.line, sel.active.character], [0, chainStart + 1]);
  }
});

// 回归：同一字符串内有两个空光标时，切换引号后两个光标都必须保持相对位置，
// 第二个光标不能被钳制到替换末尾（旧实现只对第一个光标记录了 relativeOffset）。
test('cycleQuotes: 同一字符串内两个空光标切换后都保持相对位置', async () => {
  setConfig({});
  {
    const text = "const a = 'hello';";
    const doc = makeDocument(text, '/virtual/q_cursor3.ts', 'typescript');
    // 光标1 在 'h'（'hello' 起点后 1），光标2 在 'l'（'hello' 起点后 2）
    const helloStart = text.indexOf('hello');
    const editor = editorWith(doc, [
      new Selection(new Position(0, helloStart + 1), new Position(0, helloStart + 1)),
      new Selection(new Position(0, helloStart + 2), new Position(0, helloStart + 2)),
    ]);
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, '"hello"');
    // 两个光标都应映射到新字符串内相同相对位置，而不是跳到末尾
    const sel0 = editor.selections[0];
    const sel1 = editor.selections[1];
    assert.deepEqual([sel0.active.line, sel0.active.character], [0, helloStart + 1]);
    assert.deepEqual([sel1.active.line, sel1.active.character], [0, helloStart + 2]);
  }
});

// 回归：非空选区选中字符串内部一部分（不含引号）时，切换引号后选区必须保持
// 原相对区间，不能塌缩到字符串末尾（旧实现用 remapOffset 会把落点钳制到替换末尾）。
test('cycleQuotes: 非空选区在字符串内部切换后保持原相对区间', async () => {
  setConfig({});
  {
    const text = "const a = 'hello';";
    const doc = makeDocument(text, '/virtual/q_sel1.ts', 'typescript');
    // 选中 'hello' 的 'ell'（不含引号）
    const helloStart = text.indexOf('hello');
    const editor = editorWith(doc, new Selection(new Position(0, helloStart + 1), new Position(0, helloStart + 4)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, '"hello"');
    // 选区应仍选中新字符串内的相同相对区间（'ell'），而不是塌缩到末尾
    const sel = editor.selections[0];
    assert.deepEqual([sel.start.line, sel.start.character], [0, helloStart + 1]);
    assert.deepEqual([sel.end.line, sel.end.character], [0, helloStart + 4]);
  }
});

test('cycleQuotes: 非空选区完全包含字符串时切换后保持选区整体', async () => {
  setConfig({});
  {
    const text = "const a = 'hello';";
    const doc = makeDocument(text, '/virtual/q_sel2.ts', 'typescript');
    // 选中整个字符串字面量 'hello'（含引号）
    const strStart = text.indexOf("'hello'");
    const editor = editorWith(doc, new Selection(new Position(0, strStart), new Position(0, strStart + 7)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, '"hello"');
    // 选区起点在替换起点（remapOffset 不变），终点在替换终点（不落在替换内部）
    const sel = editor.selections[0];
    assert.deepEqual([sel.start.line, sel.start.character], [0, strStart]);
    assert.deepEqual([sel.end.line, sel.end.character], [0, strStart + 7]);
  }
});

// 回归：反向选区（向左选择，anchor > active）切换引号后方向必须保持，
// 不能因 Selection 构造参数被归一化而变成正向选区。
test('cycleQuotes: 反向选区切换引号后方向保持不变', async () => {
  setConfig({});
  {
    const text = "const a = 'hello';";
    const doc = makeDocument(text, '/virtual/q_rev.ts', 'typescript');
    const helloStart = text.indexOf('hello');
    // 反向选区：anchor 在 +4（后）、active 在 +1（前），选中 'ell'（向左）
    const editor = editorWith(doc, new Selection(new Position(0, helloStart + 4), new Position(0, helloStart + 1)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, '"hello"');
    const sel = editor.selections[0];
    assert.equal(sel.isReversed, true, '反向选区方向应保持');
    assert.deepEqual([sel.anchor.line, sel.anchor.character], [0, helloStart + 4]);
    assert.deepEqual([sel.active.line, sel.active.character], [0, helloStart + 1]);
  }
});

test('cycleQuotes: 正向选区切换引号后方向保持不变', async () => {
  setConfig({});
  {
    const text = "const a = 'hello';";
    const doc = makeDocument(text, '/virtual/q_fwd.ts', 'typescript');
    const helloStart = text.indexOf('hello');
    // 正向选区：anchor 在 +1、active 在 +4，选中 'ell'（向右）
    const editor = editorWith(doc, new Selection(new Position(0, helloStart + 1), new Position(0, helloStart + 4)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, '"hello"');
    const sel = editor.selections[0];
    assert.equal(sel.isReversed, false, '正向选区方向应保持');
    assert.deepEqual([sel.anchor.line, sel.anchor.character], [0, helloStart + 1]);
    assert.deepEqual([sel.active.line, sel.active.character], [0, helloStart + 4]);
  }
});

// 回归：非空选区与空光标落在同一个字符串内时，光标必须保持相对位置，
// 不能因 hasNonEmpty 分支被无条件记录普通位置而被 remapOffset 钳制到替换末尾。
test('cycleQuotes: 非空选区与同字符串内空光标并存时光标保持相对位置', async () => {
  setConfig({});
  {
    const text = "const a = 'hello';";
    const doc = makeDocument(text, '/virtual/q_sel3.ts', 'typescript');
    const helloStart = text.indexOf('hello');
    // 选区选中 'hel'（helloStart+1 ~ +4），空光标在 'lo' 的 'l' 处（helloStart+3）
    const editor = editorWith(doc, [
      new Selection(new Position(0, helloStart + 1), new Position(0, helloStart + 4)),
      new Selection(new Position(0, helloStart + 3), new Position(0, helloStart + 3)),
    ]);
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, '"hello"');
    // 选区保持原相对区间
    const sel0 = editor.selections[0];
    assert.deepEqual([sel0.start.line, sel0.start.character], [0, helloStart + 1]);
    assert.deepEqual([sel0.end.line, sel0.end.character], [0, helloStart + 4]);
    // 光标保持原相对位置（不跳到字符串末尾）
    const sel1 = editor.selections[1];
    assert.deepEqual([sel1.active.line, sel1.active.character], [0, helloStart + 3]);
  }
});

// 回归（用户场景）：多行光标选中不同字符串，其中一个字符串有两个光标
// （非空选区 + 空光标），其他行/其他字符串的光标不能被忽略——每个字符串独立转换。
test('cycleQuotes: 一个字符串含选区和光标时其他字符串仍各自转换', async () => {
  setConfig({});
  {
    const text = "const a = 'hello';\nconst b = 'world';\nconst c = 'zeta';";
    const doc = makeDocument(text, '/virtual/q_multi.ts', 'typescript');
    // Position 的 character 是行内索引，需按行取 indexOf
    const lines = text.split('\n');
    const helloStart = lines[0].indexOf('hello');
    const worldStart = lines[1].indexOf('world');
    const zetaStart = lines[2].indexOf('zeta');
    const editor = editorWith(
      doc,
      [
        new Selection(new Position(0, helloStart + 1), new Position(0, helloStart + 4)), // 'hello' 内选区 'hel'
        new Selection(new Position(0, helloStart + 3), new Position(0, helloStart + 3)), // 'hello' 内空光标
        new Selection(new Position(1, worldStart + 1), new Position(1, worldStart + 1)), // 'world' 内空光标
        new Selection(new Position(2, zetaStart + 1), new Position(2, zetaStart + 1)), // 'zeta' 内空光标
      ],
      {}
    );
    globalThis.__lastApply = null;
    await cycleQuotes(editor);

    const ops = lastApply();
    // 三个不同字符串各自转换（'hello' 的两个光标命中同一 token，只转换一次）
    assert.equal(ops.length, 3, '三个字符串都应转换');
    const sorted = [...ops].sort((a, b) => a.range.start.line - b.range.start.line);
    assert.equal(sorted[0].text, '"hello"');
    assert.equal(sorted[1].text, '"world"');
    assert.equal(sorted[2].text, '"zeta"');

    // 选区与空光标在 'hello' 内保持相对位置
    const sel0 = editor.selections[0];
    assert.deepEqual([sel0.start.line, sel0.start.character], [0, helloStart + 1]);
    assert.deepEqual([sel0.end.line, sel0.end.character], [0, helloStart + 4]);
    const sel1 = editor.selections[1];
    assert.deepEqual([sel1.active.line, sel1.active.character], [0, helloStart + 3]);
    // 'world' 与 'zeta' 的空光标保持相对位置
    const sel2 = editor.selections[2];
    assert.deepEqual([sel2.active.line, sel2.active.character], [1, worldStart + 1]);
    const sel3 = editor.selections[3];
    assert.deepEqual([sel3.active.line, sel3.active.character], [2, zetaStart + 1]);
  }
});

test('cycleQuotes: HTML 纯文本属性含自然语言撇号切换引号时转义为 HTML Entity', async () => {
  setConfig({});
  {
    const text = `<input placeholder="Don't click" />`;
    const doc = makeDocument(text, '/virtual/attr_apos.html', 'html');
    const quoteIndex = text.indexOf('"Don\'t click"');
    const editor = editorWith(doc, new Selection(new Position(0, quoteIndex), new Position(0, quoteIndex)));

    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(lastApply()[0].text, `'Don&#39;t click'`);

    const doc2 = makeDocument(`<input placeholder='Don&#39;t click' />`, '/virtual/attr_apos2.html', 'html');
    const editor2 = editorWith(doc2, new Selection(new Position(0, quoteIndex), new Position(0, quoteIndex)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor2);
    assert.equal(lastApply()[0].text, `"Don't click"`);
  }
});

// 回归：跨行非空选区不切换引号（跨越多个字符串、语义不明确），仅保留选区位置。
// 单光标跨行时命令面板/快捷键已由 zeta.caseDisabled 禁用，此行为层保护覆盖其余触发途径。
test('cycleQuotes: 跨行选区不切换引号、选区位置保留', async () => {
  setConfig({});
  {
    const text = "const a = 'hello';\nconst b = 'world';";
    const doc = makeDocument(text, '/virtual/q_cross.ts', 'typescript');
    // 跨行选区从第 0 行到第 1 行末尾，跨越 'hello' 与 'world' 两个字符串
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(1, "const b = 'world';".length)));
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    assert.equal(globalThis.__lastApply, null, '跨行选区不应切换任何引号');
    const sel = editor.selections[0];
    assert.deepEqual([sel.start.line, sel.start.character], [0, 0]);
    assert.deepEqual([sel.end.line, sel.end.character], [1, "const b = 'world';".length]);
  }
});

// 回归：跨行选区 + 同行选区混用，跨行选区被跳过，同行选区仍正常切换引号。
test('cycleQuotes: 跨行选区与同行选区混用时仅同行选区切换', async () => {
  setConfig({});
  {
    const text = "const a = 'hello';\nconst b = 'world';";
    const doc = makeDocument(text, '/virtual/q_cross_mix.ts', 'typescript');
    const worldStart = text.split('\n')[1].indexOf('world');
    // 跨行选区（0,0)-(1,end) + 同行选区（1, world 内光标）
    const editor = editorWith(
      doc,
      [
        new Selection(new Position(0, 0), new Position(1, "const b = 'world';".length)),
        new Selection(new Position(1, worldStart + 1), new Position(1, worldStart + 1)),
      ],
      {}
    );
    globalThis.__lastApply = null;
    await cycleQuotes(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1, '仅同行空光标选区切换引号');
    assert.equal(ops[0].text, '"world"');
  }
});
