import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, loadModule, makeDocument, makeWorkspace, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const vscode = require(shimPath);
const { Selection, Position } = vscode;

const {
  splitWords,
  wordTransformers,
  buildCustomTransformers,
  applyTransformerToSelections,
  default: changeCase,
} = await loadModule(`
  export { splitWords, wordTransformers } from './src/utils/case';
  export { buildCustomTransformers, applyTransformerToSelections, default } from './src/commands/change-case';
`);

test('splitWords 边界分词能力', () => {
  assert.deepEqual(splitWords('camelCaseText'), ['camel', 'Case', 'Text']);
  assert.deepEqual(splitWords('PascalCaseText'), ['Pascal', 'Case', 'Text']);
  assert.deepEqual(splitWords('kebab-case-text'), ['kebab', 'case', 'text']);
  assert.deepEqual(splitWords('snake_case_text'), ['snake', 'case', 'text']);
  assert.deepEqual(splitWords('CONSTANT_CASE_TEXT'), ['CONSTANT', 'CASE', 'TEXT']);
  assert.deepEqual(splitWords('HTMLParserAPI'), ['HTML', 'Parser', 'API']);
  assert.deepEqual(splitWords('path/to/some.file_name-here'), ['path', 'to', 'some', 'file', 'name', 'here']);
  assert.deepEqual(splitWords(''), []);
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
  const ws = makeWorkspace();
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
    cleanup(ws);
  }
});

test('applyTransformerToSelections 多选区去重与自动选区保持', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'foo_bar\nfoo_bar';
    const doc = makeDocument(text, join(ws, 'case.ts'), 'typescript');

    const sel1 = new Selection(new Position(0, 0), new Position(0, 7));
    const sel2 = new Selection(new Position(0, 0), new Position(0, 7));
    const sel3 = new Selection(new Position(1, 0), new Position(1, 7));

    const editor = {
      document: doc,
      selections: [sel1, sel2, sel3],
    };

    await applyTransformerToSelections(editor, wordTransformers['Pascal Case'], true);
    assert.equal(editor.selections.length, 2);
    assert.equal(editor.selections[0].active.character, 6);
    assert.equal(editor.selections[1].active.character, 6);
  } finally {
    cleanup(ws);
  }
});

test('applyTransformerToSelections 同行多选区：前一个替换变短后补偿后选区偏移', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'hello_world_foo';
    const doc = makeDocument(text, join(ws, 'case3.ts'), 'typescript');
    const editor = {
      document: doc,
      selections: [
        new Selection(new Position(0, 0), new Position(0, 11)),
        new Selection(new Position(0, 12), new Position(0, 15)),
      ],
    };

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
  } finally {
    cleanup(ws);
  }
});

test('applyTransformerToSelections 跨行自定义规则改行数后选区按最终文本重算', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'a\nb';
    const doc = makeDocument(text, join(ws, 'case4.ts'), 'typescript');
    const editor = {
      document: doc,
      selections: [new Selection(new Position(0, 0), new Position(1, 1))],
    };

    await applyTransformerToSelections(editor, () => 'x\ny\nz', true);
    assert.deepEqual(
      [editor.selections[0].active.line, editor.selections[0].active.character],
      [2, 1],
      '选区终点跟随最终文本到第 3 行末尾'
    );
  } finally {
    cleanup(ws);
  }
});

test('changeCase 命令支持由参数直接指定格式', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'hello_world';
    const doc = makeDocument(text, join(ws, 'case2.ts'), 'typescript');
    const editor = {
      document: doc,
      selections: [new Selection(new Position(0, 0), new Position(0, 11))],
    };

    await changeCase(editor, {}, 'Kebab Case');
    assert.equal(editor.selections[0].active.character, 'hello-world'.length);
  } finally {
    cleanup(ws);
  }
});

test('changeCase: 多光标时 QuickPick 禁用单一预览', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'foo_bar\nbaz_qux';
    const doc = makeDocument(text, join(ws, 'case_multi.ts'), 'typescript');

    let quickPickItems = [];
    const origQuickPick = vscode.window.showQuickPick;
    vscode.window.showQuickPick = async items => {
      quickPickItems = items;
      return undefined;
    };

    const editor = {
      document: doc,
      selections: [
        new Selection(new Position(0, 0), new Position(0, 7)),
        new Selection(new Position(1, 0), new Position(1, 7)),
      ],
    };

    try {
      await changeCase(editor, {});
      assert.ok(quickPickItems.length > 0);
      assert.equal(quickPickItems[0].detail, undefined);
      assert.equal(quickPickItems[0].label, 'Camel Case');
    } finally {
      vscode.window.showQuickPick = origQuickPick;
    }
  } finally {
    cleanup(ws);
  }
});

test('applyTransformerToSelections: 非空选区与空光标共存时，仅转换非空选区且保留空光标位置', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'foo_bar\nbaz_qux\nhello_world';
    const doc = makeDocument(text, join(ws, 'case_mixed.ts'), 'typescript');

    const editor = {
      document: doc,
      selections: [
        new Selection(new Position(0, 0), new Position(0, 7)), // 选中 foo_bar
        new Selection(new Position(1, 3), new Position(1, 3)), // 空光标停在 baz_qux 内部
        new Selection(new Position(2, 0), new Position(2, 11)), // 选中 hello_world
      ],
    };

    globalThis.__lastApply = null;
    await applyTransformerToSelections(editor, wordTransformers['Pascal Case'], true);

    // 仅第 0 行与第 2 行生成编辑，第 1 行不生成编辑
    const ops = globalThis.__lastApply ?? [];
    assert.equal(ops.length, 2);
    assert.equal(ops[0].text, 'FooBar');
    assert.equal(ops[1].text, 'HelloWorld');

    // 验证光标：非空选区保持选中，空光标保持 isEmpty 为 true
    assert.equal(editor.selections.length, 3);
    assert.equal(editor.selections[0].isEmpty, false);
    assert.equal(editor.selections[1].isEmpty, true);
    assert.equal(editor.selections[2].isEmpty, false);
  } finally {
    cleanup(ws);
  }
});

test('applyTransformerToSelections: 全空光标时自动识别光标单词但保持为单点光标 (不强制扩选)', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'foo_bar baz_qux';
    const doc = makeDocument(text, join(ws, 'case_all_empty.ts'), 'typescript');

    const editor = {
      document: doc,
      selections: [
        new Selection(new Position(0, 2), new Position(0, 2)),
        new Selection(new Position(0, 10), new Position(0, 10)),
      ],
    };

    globalThis.__lastApply = null;
    await applyTransformerToSelections(editor, wordTransformers['Pascal Case'], true);

    const ops = globalThis.__lastApply ?? [];
    assert.equal(ops.length, 2);
    assert.equal(ops[0].text, 'FooBar');
    assert.equal(ops[1].text, 'BazQux');

    // 光标维持单点形态，不扩展为选区
    assert.equal(editor.selections.length, 2);
    assert.equal(editor.selections[0].isEmpty, true);
    assert.equal(editor.selections[1].isEmpty, true);
  } finally {
    cleanup(ws);
  }
});
