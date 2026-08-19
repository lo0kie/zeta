import { applyTransformerToSelections, buildCustomTransformers, default as changeCase } from '@/commands/change-case';
import { splitWords, wordTransformers } from '@/utils/case';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test, vi } from 'vitest';
import * as vscode from 'vscode';
import { editorWith, makeDocument, noopEdit, setConfig } from './helpers';
const { Selection, Position } = vscode;

test('splitWords 分词完整性与边界条件', () => {
  assert.deepEqual(splitWords('camelCaseText'), ['camel', 'Case', 'Text']);
  assert.deepEqual(splitWords('PascalCaseText'), ['Pascal', 'Case', 'Text']);
  assert.deepEqual(splitWords('kebab-case-text'), ['kebab', 'case', 'text']);
  assert.deepEqual(splitWords('snake_case_text'), ['snake', 'case', 'text']);
  assert.deepEqual(splitWords('CONSTANT_CASE_TEXT'), ['CONSTANT', 'CASE', 'TEXT']);
  assert.deepEqual(splitWords('HTMLParserAPI'), ['HTML', 'Parser', 'API']); // 连续大写后接小写
  assert.deepEqual(splitWords('ABCCode'), ['ABC', 'Code']);
  assert.deepEqual(splitWords('helloWorld42'), ['hello', 'World42']); // 末尾数字与单词相连
  assert.deepEqual(splitWords('path/to/some.file_name-here'), ['path', 'to', 'some', 'file', 'name', 'here']);
  assert.deepEqual(splitWords('already-snake_case.mixed/path'), ['already', 'snake', 'case', 'mixed', 'path']);
  assert.deepEqual(splitWords('hello\\world'), ['hello', 'world']); // 反斜杠分隔
  assert.deepEqual(splitWords(''), []); // 空串
  assert.deepEqual(splitWords('   '), []); // 仅空白
});

test('12 种内置转换器正确性', () => {
  const sample = 'fooBar_baz-qux';
  assert.equal(wordTransformers['Camel Case'](sample), 'fooBarBazQux');
  assert.equal(wordTransformers['Pascal Case'](sample), 'FooBarBazQux');
  assert.equal(wordTransformers['Kebab Case'](sample), 'foo-bar-baz-qux');
  assert.equal(wordTransformers['Snake Case'](sample), 'foo_bar_baz_qux');
  assert.equal(wordTransformers['Constant Case'](sample), 'FOO_BAR_BAZ_QUX');
  assert.equal(wordTransformers['Upper Case'](sample), 'FOOBARBAZQUX');
  assert.equal(wordTransformers['Lower Case'](sample), 'foobarbazqux');
  assert.equal(wordTransformers['Title Case'](sample), 'Foo Bar Baz Qux');
  assert.equal(wordTransformers['Sentence Case'](sample), 'Foo bar baz qux');
  assert.equal(wordTransformers['Header Case'](sample), 'Foo-Bar-Baz-Qux');
  assert.equal(wordTransformers['Dot Case'](sample), 'foo.bar.baz.qux');
  assert.equal(wordTransformers['Path Case'](sample), 'foo/bar/baz/qux');
});

test('buildCustomTransformers 自定义正则转换构建与非法规则容错', () => {
  // 该用例故意传非法正则以验证容错，会触发 console.warn；静默之，避免正常回归刷噪音日志。
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    setConfig({
      'zeta.case.custom': {
        'Prefix Under': [{ pattern: '^', replacement: '__' }],
        'Invalid Pattern': [{ pattern: '[invalid', replacement: '' }],
        'Invalid Structure': null,
      },
    });

    const custom = buildCustomTransformers();
    assert.ok(custom['Prefix Under']);
    assert.equal(custom['Prefix Under']('hello'), '__hello');
    assert.equal(custom['Invalid Pattern'], undefined);
    assert.equal(custom['Invalid Structure'], undefined);
  } finally {
    warnSpy.mockRestore();
  }
});

test('applyTransformerToSelections 多选区去重与自动选区保持', async () => {
  setConfig({});
  {
    const text = 'foo_bar\nfoo_bar';
    const doc = makeDocument(text, '/virtual/case.ts', 'typescript');

    const sel1 = new Selection(new Position(0, 0), new Position(0, 7));
    const sel2 = new Selection(new Position(0, 0), new Position(0, 7));
    const sel3 = new Selection(new Position(1, 0), new Position(1, 7));

    const editor = editorWith(doc, [sel1, sel2, sel3]);

    await applyTransformerToSelections(editor, wordTransformers['Pascal Case'], true);
    assert.equal(editor.selections.length, 2);
    assert.equal(editor.selections[0].active.character, 6);
    assert.equal(editor.selections[1].active.character, 6);
  }
});

test('applyTransformerToSelections 同行多选区：前一个替换变短后补偿后选区偏移', async () => {
  setConfig({});
  {
    const text = 'hello_world_foo';
    const doc = makeDocument(text, '/virtual/case3.ts', 'typescript');
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 11)),
      new Selection(new Position(0, 12), new Position(0, 15)),
    ]);

    await applyTransformerToSelections(editor, wordTransformers['Camel Case'], true);
    assert.deepEqual(
      [editor.selections[0].start.character, editor.selections[0].end.character],
      [0, 10],
      '第一个选区 hello_world → helloWorld'
    );
    assert.deepEqual(
      [editor.selections[1].start.character, editor.selections[1].end.character],
      [11, 14],
      '后选区 foo 随前一个替换整体左移 1 列'
    );
  }
});

test('applyTransformerToSelections 跨行选区不转换、选区位置保留', async () => {
  setConfig({});
  {
    const text = 'a\nb';
    const doc = makeDocument(text, '/virtual/case4.ts', 'typescript');
    const editor = editorWith(doc, [new Selection(new Position(0, 0), new Position(1, 1))]);

    globalThis.__lastApply = null;
    await applyTransformerToSelections(editor, () => 'x\ny\nz', true);
    // 跨行选区不产生编辑
    assert.equal(globalThis.__lastApply, null, '跨行选区不应触发编辑');
    // 选区位置保留（起点/终点原样）
    const sel = editor.selections[0];
    assert.deepEqual([sel.start.line, sel.start.character], [0, 0]);
    assert.deepEqual([sel.end.line, sel.end.character], [1, 1]);
  }
});

test('changeCase 命令支持由参数直接指定格式', async () => {
  setConfig({});
  {
    const text = 'hello_world';
    const doc = makeDocument(text, '/virtual/case2.ts', 'typescript');
    const editor = editorWith(doc, [new Selection(new Position(0, 0), new Position(0, 11))]);

    await changeCase(editor, noopEdit, 'Kebab Case');
    assert.equal(editor.selections[0].active.character, 'hello-world'.length);
  }
});

test('changeCase: 多光标时 QuickPick 禁用单一预览', async () => {
  setConfig({});
  {
    const text = 'foo_bar\nbaz_qux';
    const doc = makeDocument(text, '/virtual/case_multi.ts', 'typescript');

    let quickPickItems: vscode.QuickPickItem[] = [];
    vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(
      async (items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>) => {
        quickPickItems = [...(await items)];
        return undefined;
      }
    );

    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 7)),
      new Selection(new Position(1, 0), new Position(1, 7)),
    ]);

    await changeCase(editor, noopEdit);
    assert.ok(quickPickItems.length > 0);
    assert.equal(quickPickItems[0].detail, undefined);
    assert.equal(quickPickItems[0].label, 'Camel Case');
  }
});

test('changeCase: 跨行选区不转换，QuickPick 禁用预览', async () => {
  setConfig({});
  {
    const text = 'foo_bar\nbaz_qux';
    const doc = makeDocument(text, '/virtual/case_cross.ts', 'typescript');

    // 跨行单选区：预览应禁用（label 直接是格式名，无 detail）
    let quickPickItems: vscode.QuickPickItem[] = [];
    vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(
      async (items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>) => {
        quickPickItems = [...(await items)];
        return undefined;
      }
    );
    const editor = editorWith(doc, [new Selection(new Position(0, 0), new Position(1, 7))]);
    await changeCase(editor, noopEdit);
    assert.ok(quickPickItems.length > 0);
    assert.equal(quickPickItems[0].detail, undefined, '跨行选区不应有预览样本');
    assert.equal(quickPickItems[0].label, 'Camel Case');
  }
});

test('changeCase: 跨行选区 + 同行选区混用，仅同行选区转换', async () => {
  setConfig({});
  {
    const text = 'foo_bar\nbaz_qux';
    const doc = makeDocument(text, '/virtual/case_cross_mix.ts', 'typescript');
    // 跨行选区（0,0)-(1,7) + 同行选区（1,0)-(1,7）
    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(1, 7)),
      new Selection(new Position(1, 0), new Position(1, 7)),
    ]);

    globalThis.__lastApply = null;
    await changeCase(editor, noopEdit, 'Kebab Case');
    const ops: Array<{ text: string }> = globalThis.__lastApply ?? [];
    assert.equal(ops.length, 1, '仅同行选区 baz_qux 转换');
    assert.equal(ops[0].text, 'baz-qux');
  }
});

test('applyTransformerToSelections: 非空选区与空光标共存时，仅转换非空选区且保留空光标位置', async () => {
  setConfig({});
  {
    const text = 'foo_bar\nbaz_qux\nhello_world';
    const doc = makeDocument(text, '/virtual/case_mixed.ts', 'typescript');

    const editor = editorWith(doc, [
      new Selection(new Position(0, 0), new Position(0, 7)), // 选中 foo_bar
      new Selection(new Position(1, 3), new Position(1, 3)), // 空光标停在 baz_qux 内部
      new Selection(new Position(2, 0), new Position(2, 11)), // 选中 hello_world
    ]);

    globalThis.__lastApply = null;
    await applyTransformerToSelections(editor, wordTransformers['Pascal Case'], true);

    // 仅第 0 行与第 2 行生成编辑，第 1 行不生成编辑
    const ops: Array<{ text: string }> = globalThis.__lastApply ?? [];
    assert.equal(ops.length, 2);
    assert.equal(ops[0].text, 'FooBar');
    assert.equal(ops[1].text, 'HelloWorld');

    // 验证光标：非空选区保持选中，空光标保持 isEmpty 为 true
    assert.equal(editor.selections.length, 3);
    assert.equal(editor.selections[0].isEmpty, false);
    assert.equal(editor.selections[1].isEmpty, true);
    assert.equal(editor.selections[2].isEmpty, false);
  }
});

test('applyTransformerToSelections: 全空光标时自动识别光标单词但保持为单点光标 (不强制扩选)', async () => {
  setConfig({});
  {
    const text = 'foo_bar baz_qux';
    const doc = makeDocument(text, '/virtual/case_all_empty.ts', 'typescript');

    const editor = editorWith(doc, [
      new Selection(new Position(0, 2), new Position(0, 2)),
      new Selection(new Position(0, 10), new Position(0, 10)),
    ]);

    globalThis.__lastApply = null;
    await applyTransformerToSelections(editor, wordTransformers['Pascal Case'], true);

    const ops: Array<{ text: string }> = globalThis.__lastApply ?? [];
    assert.equal(ops.length, 2);
    assert.equal(ops[0].text, 'FooBar');
    assert.equal(ops[1].text, 'BazQux');

    // 光标维持单点形态，不扩展为选区
    assert.equal(editor.selections.length, 2);
    assert.equal(editor.selections[0].isEmpty, true);
    assert.equal(editor.selections[1].isEmpty, true);
  }
});

test('wordTransformers: 边界条件、等幂性与特殊单词处理', () => {
  const t = wordTransformers;

  // 1. 极端输入
  for (const name of Object.keys(t) as Array<keyof typeof t>) {
    assert.equal(t[name](''), '', `${name} 空串应返回空`);
    assert.equal(typeof t[name]('a'), 'string', `${name} 单字符应返回字符串`);
    assert.equal(t[name]('a').length, 1, `${name} 单字符长度应为 1`);
    assert.equal(t[name]('123'), '123', `${name} 纯数字应保持不变`);
  }

  // 2. 已处于目标格式时幂等
  assert.equal(t['Camel Case']('helloWorld'), 'helloWorld');
  assert.equal(t['Snake Case']('hello_world'), 'hello_world');
  assert.equal(t['Kebab Case']('hello-world'), 'hello-world');
  assert.equal(t['Pascal Case']('HelloWorld'), 'HelloWorld');
  assert.equal(t['Constant Case']('HELLO_WORLD'), 'HELLO_WORLD');

  // 3. 含大写/特殊前缀的单词
  assert.equal(t['Snake Case']('HelloWorld'), 'hello_world'); // 帕斯卡转蛇形：首字母保持
  assert.equal(t['Constant Case']('myVarName'), 'MY_VAR_NAME'); // 常量格式：全大写下划线
  assert.equal(t['Dot Case']('MyComponent'), 'my.component'); // 点格式保持小写
  assert.equal(t['Path Case']('MyComponent'), 'my/component'); // 路径格式保持小写
});
