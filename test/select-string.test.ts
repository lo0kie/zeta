import selectString from '@/commands/select-string';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Position, Selection } from 'vscode';
import { editorWith, makeDocument, setConfig } from './helpers';

test('select-string: 光标在内容中或边界引号上均能准确选中字符串内容', () => {
  setConfig({});
  {
    const text = `const a = 'hello'; const b = "world";`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');

    // 光标 1：hello 内容中间；光标 2：world 开引号上（利用多光标一次处理，避免重复构建环境）
    const editor = editorWith(doc, [
      new Selection(new Position(0, text.indexOf('hello') + 2), new Position(0, text.indexOf('hello') + 2)),
      new Selection(new Position(0, text.indexOf('"world"')), new Position(0, text.indexOf('"world"'))),
    ]);
    selectString(editor);

    assert.equal(editor.selections.length, 2, '两个光标都保留');
    const content = editor.selections[0];
    assert.equal(doc.getText(content), 'hello', '光标在内容中选中内容');
    assert.equal(content.start.character, text.indexOf("'") + 1, '起点是开引号后（内容起点）');
    assert.equal(content.end.character, text.indexOf("'", text.indexOf('hello')), '终点是闭引号前（内容终点）');
    assert.equal(doc.getText(editor.selections[1]), 'world', '光标在引号上同样选中内容');
  }
});

test('select-string: 光标不在字符串内（注释/正则/普通标识符）时不动作', () => {
  setConfig({});
  {
    const text = `// 'fake'\nconst re = /'x'/;\nconst word = abc;`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    const lines = text.split('\n');

    // 注释内的引号
    const caretComment = lines[0].indexOf("'") + 1;
    const ed1 = editorWith(doc, new Selection(new Position(0, caretComment), new Position(0, caretComment)));
    const before1 = ed1.selection;
    selectString(ed1);
    assert.equal(ed1.selection, before1, '注释内不选中');

    // 正则内的引号
    const caretRegex = lines[1].indexOf("'") + 1;
    const ed2 = editorWith(doc, new Selection(new Position(1, caretRegex), new Position(1, caretRegex)));
    const before2 = ed2.selection;
    selectString(ed2);
    assert.equal(ed2.selection, before2, '正则内不选中');

    // 普通标识符
    const caretWord = lines[2].indexOf('abc') + 1;
    const ed3 = editorWith(doc, new Selection(new Position(2, caretWord), new Position(2, caretWord)));
    const before3 = ed3.selection;
    selectString(ed3);
    assert.equal(ed3.selection, before3, '普通标识符不选中');
  }
});

test('select-string: 多光标分别选中各自所在字符串；不在字符串内的保持原样', () => {
  setConfig({});
  {
    const text = `a = 'one'; b = "two"; c = 123;`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');

    // 光标 1：'one' 内；光标 2：注释外 "two" 内；光标 3：数字 123 上（不在字符串内）
    const caretOne = text.indexOf('one') + 1;
    const caretTwo = text.indexOf('two') + 1;
    const caretNum = text.indexOf('123') + 1;
    const editor = editorWith(doc, [
      new Selection(new Position(0, caretOne), new Position(0, caretOne)),
      new Selection(new Position(0, caretTwo), new Position(0, caretTwo)),
      new Selection(new Position(0, caretNum), new Position(0, caretNum)),
    ]);

    selectString(editor);

    assert.equal(editor.selections.length, 3, '三个光标都保留');
    const ranges = editor.selections.map(s => doc.getText(s));
    assert.ok(ranges.includes('one'), '光标 1 选中 one 内容');
    assert.ok(ranges.includes('two'), '光标 2 选中 two 内容');
    // 光标 3 不在字符串内：按索引精确断言保持空选区（不用 || 兼容两种结果，防止 '123' 误选时仍通过）
    assert.equal(doc.getText(editor.selections[2]), '', '光标 3 不在字符串内，保持空选区');
  }
});

test('select-string: 多个光标命中同一字符串时去重', () => {
  setConfig({});
  {
    const text = `x = 'same';`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    const caret1 = text.indexOf('same') + 1;
    const caret2 = text.indexOf('same') + 3;

    const editor = editorWith(doc, [
      new Selection(new Position(0, caret1), new Position(0, caret1)),
      new Selection(new Position(0, caret2), new Position(0, caret2)),
    ]);

    selectString(editor);

    assert.equal(editor.selections.length, 1, '同一字符串只保留一个选区');
    assert.equal(doc.getText(editor.selections[0]), 'same');
  }
});
