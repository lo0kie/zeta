import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers.mjs';

const { mergeOverlappingRanges, indentUnit, leadingIndent, buildFinalText, remapOffset, positionAt } = await loadModule(
  `export * from './src/utils/edits';`
);

test('mergeOverlappingRanges: 空/单/不重叠/排序', () => {
  assert.deepEqual(mergeOverlappingRanges([]), []);
  assert.deepEqual(mergeOverlappingRanges([{ start: 0, end: 5 }]), [{ start: 0, end: 5 }]);
  assert.deepEqual(mergeOverlappingRanges([{ start: 0, end: 5 }, { start: 10, end: 15 }]), [
    { start: 0, end: 5 },
    { start: 10, end: 15 },
  ]);
  // 乱序输入应被排序
  assert.deepEqual(mergeOverlappingRanges([{ start: 10, end: 15 }, { start: 0, end: 5 }]), [
    { start: 0, end: 5 },
    { start: 10, end: 15 },
  ]);
});

test('mergeOverlappingRanges: 重叠/包含/相邻', () => {
  assert.deepEqual(mergeOverlappingRanges([{ start: 0, end: 10 }, { start: 5, end: 15 }]), [{ start: 0, end: 15 }]);
  assert.deepEqual(mergeOverlappingRanges([{ start: 0, end: 20 }, { start: 5, end: 10 }]), [{ start: 0, end: 20 }]);
  // 相邻（起点等于上一终点）不合并
  assert.deepEqual(mergeOverlappingRanges([{ start: 0, end: 5 }, { start: 5, end: 10 }]), [
    { start: 0, end: 5 },
    { start: 5, end: 10 },
  ]);
  // 三段连续合并为一段
  assert.deepEqual(
    mergeOverlappingRanges([{ start: 0, end: 10 }, { start: 8, end: 12 }, { start: 11, end: 20 }]),
    [{ start: 0, end: 20 }]
  );
});

test('indentUnit: undefined/制表符/空格与 tabSize', () => {
  assert.equal(indentUnit(), '  ');
  assert.equal(indentUnit({ insertSpaces: false }), '\t');
  assert.equal(indentUnit({ insertSpaces: true, tabSize: 2 }), '  ');
  assert.equal(indentUnit({ insertSpaces: true, tabSize: 4 }), '    ');
  assert.equal(indentUnit({ insertSpaces: true }), '  '); // 缺省 tabSize=2
});

test('leadingIndent: 提取行首空白', () => {
  assert.equal(leadingIndent('   abc'), '   ');
  assert.equal(leadingIndent('\t\tx'), '\t\t');
  assert.equal(leadingIndent('abc'), '');
  assert.equal(leadingIndent('  \t mixed'), '  \t '); // 行首空白含尾随空格
});

test('buildFinalText: 插入与替换混合', () => {
  assert.equal(
    buildFinalText('abcdef', [
      { start: 2, end: 2, text: 'X' },
      { start: 4, end: 4, text: 'Y' },
    ]),
    'abXcdYef'
  );
  assert.equal(
    buildFinalText('abcdef', [
      { start: 0, end: 2, text: 'XY' },
      { start: 4, end: 5, text: 'Z' },
    ]),
    'XYcdZf'
  );
  // 同偏移多条编辑按传入顺序拼接
  assert.equal(
    buildFinalText('abc', [
      { start: 1, end: 1, text: 'X' },
      { start: 1, end: 1, text: 'Y' },
    ]),
    'aXYbc'
  );
});

test('remapOffset: 插入位移与替换内部钳制', () => {
  const insert = [{ start: 0, end: 0, text: 'AB' }];
  assert.equal(remapOffset(0, insert), 2);
  assert.equal(remapOffset(1, insert), 3); // 原始偏移 1 被推后到 3
  const replace = [{ start: 0, end: 2, text: 'XY' }];
  assert.equal(remapOffset(0, replace), 0);
  assert.equal(remapOffset(1, replace), 2); // 落入替换内部，钳制到末尾
  assert.equal(remapOffset(3, replace), 3); // 替换之后
});

test('positionAt: 偏移换算 Position（含换行）', () => {
  const text = 'a\nb';
  assert.deepEqual([positionAt(text, 0).line, positionAt(text, 0).character], [0, 0]);
  assert.deepEqual([positionAt(text, 1).line, positionAt(text, 1).character], [0, 1]);
  assert.deepEqual([positionAt(text, 2).line, positionAt(text, 2).character], [1, 0]);
  assert.deepEqual([positionAt(text, 3).line, positionAt(text, 3).character], [1, 1]);
  // 越界偏移被钳制
  assert.deepEqual([positionAt(text, 99).line, positionAt(text, 99).character], [1, 1]);
});
