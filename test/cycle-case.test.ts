import cycleCase, { clearCycleState } from '@/commands/cycle-case';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as vscode from 'vscode';
import { editorWith, makeDocument, noopEdit, setConfig } from './helpers';
const { Selection, Position } = vscode;

function lastApply() {
  return globalThis.__lastApply ?? [];
}

test('cycleCase: 单字符样本在所有格式下无变化时不应用编辑', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case', 'Pascal Case', 'Snake Case', 'Constant Case'] });
  {
    // 纯数字 '42'：所有格式输出均为 '42'，循环一圈无变化 → 不触发编辑
    const doc = makeDocument('42 bb', '/virtual/cc2.ts', 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 2)));
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);
    assert.equal(globalThis.__lastApply, null, '纯数字不应触发编辑');
  }
});

test('cycleCase: 跳过与样本相同的格式，落到第一个有变化的格式', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  {
    // 'fooBar' 已是 Camel：从 Kebab 起找，Kebab 输出 'foo-bar' 有变化 → 应用
    const doc = makeDocument('fooBar x', '/virtual/cc3.ts', 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 6)));
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);
    assert.ok(globalThis.__lastApply, '多字符样本应触发编辑');
    assert.equal(lastApply()[0].text, 'foo-bar');
  }
});

test('cycleCase: 单字符小写字母在 Constant Case 下有变化则应用', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case', 'Pascal Case', 'Snake Case', 'Constant Case'] });
  {
    // 'a' 在 Camel/Kebab/Pascal/Snake 下均为 'a'，但 Constant Case 输出 'A' → 循环跳过无变化格式后应用 'A'
    const doc = makeDocument('a bb', '/virtual/cc1.ts', 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 1)));
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);
    assert.ok(globalThis.__lastApply, '单字符存在有变化格式时应触发编辑');
    assert.equal(lastApply()[0].text, 'A');
  }
});

test('cycleCase: 无任何选区时直接返回不编辑', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  {
    const doc = makeDocument('fooBar x', '/virtual/cc4.ts', 'typescript');
    const editor = editorWith(doc, []);
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);
    assert.equal(globalThis.__lastApply, null);
  }
});

test('cycleCase: 配置 cycleOrder 为空时不编辑', async () => {
  setConfig({ 'zeta.case.cycleOrder': [] });
  {
    const doc = makeDocument('fooBar x', '/virtual/cc5.ts', 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 6)));
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);
    assert.equal(globalThis.__lastApply, null);
  }
});

test('cycleCase: 选区仅为空白时不编辑', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  {
    const doc = makeDocument('   x', '/virtual/cc6.ts', 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 3)));
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);
    assert.equal(globalThis.__lastApply, null);
  }
});

// 回归：VARIANT（Constant Case）连续按键以「一轮」为单位去重循环。
// variant 同时是 Camel/Kebab/Snake 的恒等结果，因此 Snake 不产生新文本、被跳过，
// 一轮去重后 VARIANT → variant → Variant → VARIANT（variant 只出现一次）。
test('cycleCase: VARIANT 一轮去重循环（variant 只一次）', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case', 'Pascal Case', 'Snake Case', 'Constant Case'] });
  {
    // 同一 uri 连续调用以共享循环状态；每次手动更新文本模拟真实按键后的内容
    const uri = '/virtual/ccCycle.ts';
    const step = async (text: string) => {
      const doc = makeDocument(text, uri, 'typescript');
      const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 7)));
      globalThis.__lastApply = null;
      await cycleCase(editor, noopEdit);
      return lastApply()[0].text;
    };

    // 第 1 次：VARIANT(Constant) → 环绕 Camel（variant 是新文本）→ variant
    assert.equal(await step('VARIANT x'), 'variant');
    // 第 2 次：variant → 跳过 Kebab(产生相同 variant)、Pascal(新文本 Variant) → Variant
    assert.equal(await step('variant x'), 'Variant');
    // 第 3 次：Variant → 跳过 Snake(产生已出现的 variant)、Constant(产生已出现的 VARIANT)
    // 一圈无新文本 → 精确回到最初文本 VARIANT
    assert.equal(await step('Variant x'), 'VARIANT');
    // 第 4 次：重新开始新一轮 → variant（variant 未重复出现）
    assert.equal(await step('VARIANT x'), 'variant');
  }
});

// 精确回归：start 非任何格式规范输出（混合分隔符）时，一圈结束必须精确回到 start，
// 而非「找不到对应格式就停在当前」。旧实现 startIndexForStart=-1 会返回 undefined（不切换）。
test('cycleCase: start 非规范输出时仍精确回归到最初文本', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Snake Case'] });
  {
    const uri = '/virtual/ccExact.ts';
    // 初始文本 'my-variant_name' 不是 Camel 也不是 Snake 的规范输出。
    // 用非空选区显式选中整词；因各步词长不同，按传入长度取选区。
    const step = async (text: string, len: number) => {
      const doc = makeDocument(text, uri, 'typescript');
      const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, len)));
      globalThis.__lastApply = null;
      await cycleCase(editor, noopEdit);
      return lastApply()[0].text;
    };

    // 第 1 次：Camel 产生新文本 → myVariantName
    assert.equal(await step('my-variant_name x', 15), 'myVariantName');
    // 第 2 次：Camel 下一个 Snake → my_variant_name（不在本轮已出现文本中）
    assert.equal(await step('myVariantName x', 13), 'my_variant_name');
    // 第 3 次：Snake 下一个 Camel → myVariantName（已出现，跳过）→ 一圈无新文本
    // → 精确回到最初文本 my-variant_name（旧实现会因找不到对应格式而不切换）
    assert.equal(await step('my_variant_name x', 15), 'my-variant_name');
  }
});

// 回归：反向选区循环切换格式后方向必须保持（remapSelections 需按 anchor/active 顺序构造）。
test('cycleCase: 反向选区循环切换后方向保持不变', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  {
    const text = 'fooBar baz';
    const doc = makeDocument(text, '/virtual/ccRev.ts', 'typescript');
    // 反向选区：anchor 在 6、active 在 0，向左选中 'fooBar'（Camel → Kebab 有变化）
    const editor = editorWith(doc, new Selection(new Position(0, 6), new Position(0, 0)));
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);
    assert.equal(lastApply()[0].text, 'foo-bar');
    const sel = editor.selections[0];
    assert.equal(sel.isReversed, true, '反向选区方向应保持');
    assert.deepEqual([sel.anchor.line, sel.anchor.character], [0, 7]);
    assert.deepEqual([sel.active.line, sel.active.character], [0, 0]);
  }
});

// 回归：多光标时每个选区必须按自身文本独立计算循环步进，
// 不能共用第一个选区的样本（否则格式不同的词会被套用同一个转换）。
test('cycleCase: 多光标各自按自身格式前进一格', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  {
    // 'directives'（小写）→ Kebab 'directives'（无变化）→ Camel 'directives'（无变化）→ 一圈无变化 → 放弃（不编辑）
    // 因此用 'vTooltip'（Camel）与 'directive-name'（Kebab）验证：前者 → Kebab，后者 → Camel
    const text = 'vTooltip directive-name';
    const doc = makeDocument(text, '/virtual/ccMulti.ts', 'typescript');
    // 两个非空选区：'vTooltip'（0-8）、'directive-name'（9-23）
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 8)),
      new Selection(new Position(0, 9), new Position(0, 23)),
    ]);
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);

    const edits = lastApply();
    assert.equal(edits.length, 2, '两个选区都应产生编辑');
    // 按文本偏移排序后断言：'vTooltip' 前进一格到 Kebab 'v-tooltip'，'directive-name' 前进到 Camel 'directiveName'
    const sorted = [...edits].sort((a, b) => a.range.start.character - b.range.start.character);
    assert.equal(sorted[0].text, 'v-tooltip');
    assert.equal(sorted[1].text, 'directiveName');
  }
});

test('cycleCase: 多光标含无变化样本时其余选区仍独立转换', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case', 'Pascal Case'] });
  {
    // 'directives'（小写）在 Camel/Kebab 下无变化，Pascal 'Directives' 有变化 → 应转 Pascal
    // 'vTooltip'（Camel）→ Kebab 'v-tooltip'
    const text = 'directives vTooltip';
    const doc = makeDocument(text, '/virtual/ccMulti2.ts', 'typescript');
    // 'directives'（0-10）、'vTooltip'（11-19）
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 10)),
      new Selection(new Position(0, 11), new Position(0, 19)),
    ]);
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);

    const edits = lastApply();
    assert.equal(edits.length, 2, '两个选区都应产生编辑');
    const sorted = [...edits].sort((a, b) => a.range.start.character - b.range.start.character);
    assert.equal(sorted[0].text, 'Directives');
    assert.equal(sorted[1].text, 'v-tooltip');
  }
});

test('cycleCase: 多光标空光标选区按各自单词转换并保持光标位置', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  {
    // 两个空光标分别落在 'vTooltip' 的 'T'（字符 1）与 'directiveName' 的 'N'（字符 13）
    // 均为独立 camel 单词（不用连字符词：getWordRangeAtPosition 会把连字符词拆成两段，
    // 光标落在后一段时只取后段单词，属于预期行为而非本 bug 范畴）
    const text = 'vTooltip directiveName';
    const doc = makeDocument(text, '/virtual/ccMulti3.ts', 'typescript');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 1), new Position(0, 1)),
      new Selection(new Position(0, 13), new Position(0, 13)),
    ]);
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);

    const edits = lastApply();
    assert.equal(edits.length, 2, '两个空光标单词都应转换');
    const sorted = [...edits].sort((a, b) => a.range.start.character - b.range.start.character);
    assert.equal(sorted[0].text, 'v-tooltip');
    assert.equal(sorted[1].text, 'directive-name');
    // 光标被重映射回新文本内同相对位置（不漂移）
    // 第一个光标相对 'vTooltip' 起点偏移 1 → 新文本 'v-tooltip' 内字符 1
    // 第二个光标相对 'directiveName' 起点偏移 13-9=4；新文本中 'directive-name' 因
    // 前面替换变长（8→9）起点从 9 移到 10 → 光标落 10+4=14
    assert.deepEqual([editor.selections[0].active.line, editor.selections[0].active.character], [0, 1]);
    assert.deepEqual([editor.selections[1].active.line, editor.selections[1].active.character], [0, 14]);
  }
});

// 回归：跨行选区不转换，仅保留选区位置（多行整段文本套单词格式转换结果不可预期）。
test('cycleCase: 跨行选区不转换、选区位置保留', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  {
    const text = 'foo_bar\nbaz_qux';
    const doc = makeDocument(text, '/virtual/ccCross.ts', 'typescript');
    const editor = editorWith(doc, [new Selection(new Position(0, 0), new Position(1, 7))]);
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);
    assert.equal(globalThis.__lastApply, null, '跨行选区不应触发编辑');
    const sel = editor.selections[0];
    assert.deepEqual([sel.start.line, sel.start.character], [0, 0]);
    assert.deepEqual([sel.end.line, sel.end.character], [1, 7]);
  }
});

// 回归：跨行选区 + 同行选区混用，仅同行选区转换（跨行选区被跳过但仍保留位置）。
test('cycleCase: 跨行选区与同行选区混用时仅同行选区转换', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  {
    const text = 'foo_bar\nbaz_qux';
    const doc = makeDocument(text, '/virtual/ccCrossMix.ts', 'typescript');
    // 跨行选区（0,0)-(1,7) + 同行选区（1,0)-(1,7）
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(1, 7)),
      new Selection(new Position(1, 0), new Position(1, 7)),
    ]);
    globalThis.__lastApply = null;
    await cycleCase(editor, noopEdit);
    const edits = lastApply();
    assert.equal(edits.length, 1, '仅同行选区 baz_qux 转换');
    // baz_qux（snake）非任何已知格式，cycleCase 首次从第 1 个格式 Camel 起找新文本 → bazQux
    assert.equal(edits[0].text, 'bazQux');
  }
});

// 文档关闭后其循环状态被清理：同一 uri 的 key 删除，下次调用重新初始化（从最初文本再次开始循环）。
test('clearCycleState: 清理后同一文档循环状态重置', async () => {
  setConfig({ 'zeta.case.cycleOrder': ['Camel Case', 'Kebab Case'] });
  {
    const uri = '/virtual/ccClear.ts';
    const step = async (text: string) => {
      const doc = makeDocument(text, uri, 'typescript');
      // 选中 'fooBar'（6 字符，不含空格）
      const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 6)));
      globalThis.__lastApply = null;
      await cycleCase(editor, noopEdit);
      return lastApply()[0].text;
    };

    // 建立状态：fooBar → foo-bar（第 1 步）
    assert.equal(await step('fooBar x'), 'foo-bar');
    // 模拟文档关闭：清理该 uri 的状态
    clearCycleState(vscode.Uri.file(uri));
    // 再打开同一 uri（模拟重新打开文档）：状态已重置，应回到第 1 步而非继续循环
    assert.equal(await step('fooBar x'), 'foo-bar', '清理后循环状态重置，从第 1 步重新开始');
  }
});
