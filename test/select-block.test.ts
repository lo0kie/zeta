import { default as selectBlock } from '@/commands/select-block';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'vitest';
import { Position, Selection } from 'vscode';
import { editorWith, makeDocument, setConfig } from './helpers';

/** 生成一个以 offset 处的光标（空选区） */
function caret(doc: { positionAt: (o: number) => Position }, offset: number): Selection {
  const p = doc.positionAt(offset);
  return new Selection(p, p);
}

test('select-block: 光标在 if 块体内时只选中块内容（不含 if 声明与括号）', () => {
  setConfig({});
  {
    const text = `if (condition) {\n  start\n  xxxxxx\n  end\n}`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    const editor = editorWith(doc, caret(doc, text.indexOf('xxxxxx') + 3));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    assert.equal(doc.getText(editor.selections[0]), `\n  start\n  xxxxxx\n  end\n`, '只选块内容，不含 if (condition) 与括号');
  }
});

test('select-block: 嵌套块时选中光标所在最内层花括号块', () => {
  setConfig({});
  {
    const text = `function outer() {\n  if (a) {\n    inner();\n  }\n}`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    const editor = editorWith(doc, caret(doc, text.indexOf('inner') + 2));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    assert.equal(doc.getText(editor.selections[0]), `\n    inner();\n  `, '选中最内层块内容，不含 if (a) 与括号');
  }
});

test('select-block: 光标不在任何括号内（如 if 关键字上）时不触发，保持原选区', () => {
  setConfig({});
  {
    const text = `if (x > 1) {\n  foo();\n}`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    const editor = editorWith(doc, caret(doc, text.indexOf('if') + 1));
    const before = editor.selection;
    selectBlock(editor);
    assert.equal(editor.selection, before, '光标不在括号内保持原选区');
  }
});

test('select-block: 字符串/正则/注释里的花括号不参与配对', () => {
  setConfig({});
  {
    const text = `const s = "{ }";\nconst re = /}/;\n// { not a block\nfunction f() {\n  return 1;\n}`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    const editor = editorWith(doc, caret(doc, text.indexOf('return') + 2));
    selectBlock(editor);
    assert.equal(doc.getText(editor.selections[0]), `\n  return 1;\n`, '正确选中 function 的块内容');
  }
});

test('select-block: 不在任何块内（顶层无花括号）时保持原选区', () => {
  setConfig({});
  {
    const text = `const a = 1;\nconst b = 2;`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    const editor = editorWith(doc, caret(doc, text.indexOf('const a') + 1));
    const before = editor.selection;
    selectBlock(editor);
    assert.equal(editor.selection, before, '不在块内保持原选区');
  }
});

test('select-block: 多光标命中同一括号块时去重', () => {
  setConfig({});
  {
    const text = `const r = foo(alpha, beta, gamma);`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    // 三个光标都在同一个圆括号内不同位置 → 命中同一块，去重后只剩一个选区
    const editor = editorWith(doc, [
      caret(doc, text.indexOf('alpha')),
      caret(doc, text.indexOf('beta')),
      caret(doc, text.indexOf('gamma')),
    ]);
    selectBlock(editor);
    assert.equal(editor.selections.length, 1, '同一块去重后只剩一个选区');
    assert.equal(doc.getText(editor.selections[0]), `alpha, beta, gamma`, '选区为整个圆括号内容');
  }
});

test('select-block: 光标不在任何块内时多个光标保持各自原选区', () => {
  setConfig({});
  {
    const text = `a = 1;\nb = 2;`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    const before = [caret(doc, text.indexOf('a')), caret(doc, text.indexOf('b'))];
    const editor = editorWith(doc, before);
    selectBlock(editor);
    assert.equal(editor.selections.length, 2);
    assert.equal(doc.getText(editor.selections[0]), '', '保持空选区');
    assert.equal(doc.getText(editor.selections[1]), '', '保持空选区');
  }
});

test('select-block: 光标在圆括号内时选中括号内容（不含括号）', () => {
  setConfig({});
  {
    const text = `const r = foo(a, b, c);`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    const editor = editorWith(doc, caret(doc, text.indexOf('b')));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    assert.equal(doc.getText(editor.selections[0]), `a, b, c`, '只选圆括号内内容，不含括号');
  }
});

test('select-block: 光标在方括号内时选中数组/索引内容', () => {
  setConfig({});
  {
    const text = `const arr = [1, 2, 3];`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    const editor = editorWith(doc, caret(doc, text.indexOf('2')));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    assert.equal(doc.getText(editor.selections[0]), `1, 2, 3`, '只选方括号内内容，不含括号');
  }
});

test('select-block: 混合嵌套时选中包含光标的最内层括号（最近括号）', () => {
  setConfig({});
  {
    const text = `foo(a, [x, {y: bar(1)}], z);`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    // 光标在 bar(1) 的 1 处：最近括号是 bar(1) 的 () → 选中内容 `1`
    const editor = editorWith(doc, caret(doc, text.indexOf('1')));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    assert.equal(doc.getText(editor.selections[0]), `1`, '最近括号是 bar(1) 的圆括号');
  }
});

test('select-block: 光标在 if 条件圆括号内（不在花括号块内）时选中条件内容', () => {
  setConfig({});
  {
    const text = `if (x > 1 && y < 2) { foo(); }`;
    const doc = makeDocument(text, '/virtual/a.ts', 'typescript');
    // 光标在条件内的 y 处：`{` 在光标右侧，光标不在花括号块内 → 回退选圆括号内容
    const editor = editorWith(doc, caret(doc, text.indexOf('y')));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    assert.equal(doc.getText(editor.selections[0]), `x > 1 && y < 2`, '光标不在花括号内时选中条件圆括号内容');
  }
});

test('select-block: CSS 中光标在 var() 实参内时选中圆括号内容', () => {
  setConfig({});
  {
    const text = `[data-focusable-outline]:focus-visible {\n  color: var(--fretboard-focus-color);\n  outline: 2px solid currentColor;\n}`;
    const doc = makeDocument(text, '/virtual/a.css', 'css');
    // 光标在 var(--x) 实参内 → 最近括号是 var() 的 () → 选中内容 --fretboard-focus-color
    const editor = editorWith(doc, caret(doc, text.indexOf('--fretboard-focus-color') + 1));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    assert.equal(doc.getText(editor.selections[0]), `--fretboard-focus-color`, '选中 var() 圆括号内容');
  }
});

test('select-block: CSS 中光标在花括号块内但不圆括号内（分号后）时选中花括号块', () => {
  setConfig({});
  {
    const text = `[data-focusable-outline]:focus-visible {\n  color: var(--fretboard-focus-color);\n  outline: 2px solid currentColor;\n}`;
    const doc = makeDocument(text, '/virtual/a.css', 'css');
    // 光标在 outline 行的 `solid` 后（分号前，不在任何 () 内，仅在 {} 内）→ 选中花括号块内容
    const caretPos = text.indexOf('currentColor') + 2;
    const editor = editorWith(doc, caret(doc, caretPos));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    assert.equal(
      doc.getText(editor.selections[0]),
      `\n  color: var(--fretboard-focus-color);\n  outline: 2px solid currentColor;\n`,
      '光标不在圆括号内时选中外层花括号块内容'
    );
  }
});

test('select-block: Vue 动态属性 :class="[...]" 内可选中块（不再被整段当字符串跳过）', () => {
  setConfig({});
  {
    const text = `<button :class="[sizeClass, themeClass, variantClass, roundedClass, { 'is-icon-only': iconOnly, 'is-texted': texted }]">x</button>`;
    const doc = makeDocument(text, '/virtual/c.vue', 'vue');
    // 光标在对象字面量 iconOnly 处 → 最近括号是 { }，选中对象内容
    const editor = editorWith(doc, caret(doc, text.indexOf('iconOnly') + 2));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1, '光标在对象字面量内应命中块');
    assert.equal(
      doc.getText(editor.selections[0]),
      ` 'is-icon-only': iconOnly, 'is-texted': texted `,
      '选中对象字面量内容'
    );
  }
});

test('select-block: Vue 动态属性内光标在数组处选中数组块', () => {
  setConfig({});
  {
    const text = `<button :class="[sizeClass, themeClass, { active: isActive }]">x</button>`;
    const doc = makeDocument(text, '/virtual/c.vue', 'vue');
    // 光标在 themeClass 处 → 最近括号是 [ ]，选中数组内容
    const editor = editorWith(doc, caret(doc, text.indexOf('themeClass') + 2));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1, '光标在数组内应命中块');
    assert.equal(
      doc.getText(editor.selections[0]),
      `sizeClass, themeClass, { active: isActive }`,
      '选中数组内容'
    );
  }
});
