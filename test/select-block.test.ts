import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Position, Selection } from 'vscode';
import { editorWith, makeDocument, setConfig } from './helpers';
import selectBlock from '@/commands/select-block';

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
    assert.equal(
      doc.getText(editor.selections[0]),
      `\n  start\n  xxxxxx\n  end\n`,
      '只选块内容，不含 if (condition) 与括号'
    );
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
    assert.equal(doc.getText(editor.selections[0]), `sizeClass, themeClass, { active: isActive }`, '选中数组内容');
  }
});

test('select-block: JSON 光标在对象键值块内时选中该块内容', () => {
  setConfig({});
  {
    const text = `{\n  "name": "zeta",\n  "scripts": {\n    "dev": "tsup --watch",\n    "test": "vitest run"\n  }\n}`;
    const doc = makeDocument(text, '/virtual/package.json', 'json');
    // 光标在 scripts 内某脚本值里 → 最近括号是 scripts 的 {}，选中其内容
    const editor = editorWith(doc, caret(doc, text.indexOf('tsup --watch') + 2));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    assert.equal(
      doc.getText(editor.selections[0]),
      `\n    "dev": "tsup --watch",\n    "test": "vitest run"\n  `,
      '光标在对象值内时选中该对象块内容，而非外层根对象'
    );
  }
});

test('select-block: JSON 光标在对象键名上时选中该键名所在层级（外层对象）', () => {
  setConfig({});
  {
    const text = `{\n  "name": "zeta",\n  "scripts": {\n    "dev": "tsup --watch"\n  }\n}`;
    const doc = makeDocument(text, '/virtual/package.json', 'json');
    // 光标在 "scripts" 键名上 → 键名属于外层根对象，应选中根对象（scripts 所在层级），而非 scripts 值块
    const editor = editorWith(doc, caret(doc, text.indexOf('scripts')));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    assert.equal(
      doc.getText(editor.selections[0]),
      `\n  "name": "zeta",\n  "scripts": {\n    "dev": "tsup --watch"\n  }\n`,
      '光标在键名上时选中其所在层级（外层对象），而非内层值块'
    );
  }
});

test('select-block: JSON 光标在对象开括号前时选中该键名所在层级（外层对象）', () => {
  setConfig({});
  {
    const text = `{\n  "name": "zeta",\n  "scripts": {\n    "dev": "tsup --watch"\n  }\n}`;
    const doc = makeDocument(text, '/virtual/package.json', 'json');
    // 光标在 scripts 的冒号后（开括号前）→ 属外层根对象，应选中根对象
    const editor = editorWith(doc, caret(doc, text.indexOf('"scripts"') + '"scripts"'.length + 1));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    assert.equal(
      doc.getText(editor.selections[0]),
      `\n  "name": "zeta",\n  "scripts": {\n    "dev": "tsup --watch"\n  }\n`,
      '光标在开括号前时选中其所在层级（外层对象），而非内层值块'
    );
  }
});

test('select-block: JSON 光标在对象值内、右侧有另一对象时，不误命中右侧对象', () => {
  setConfig({});
  {
    // 模拟 fret-logic：scripts 之后紧跟 dependencies，光标在 scripts 值内
    const text = `{\n  "scripts": {\n    "dev": "vite",\n    "build": "vue-tsc && vite build"\n  },\n  "dependencies": {\n    "vue": "3.5.11",\n    "tone": "^15.1.22"\n  }\n}`;
    const doc = makeDocument(text, '/virtual/package.json', 'json');
    // 光标在 scripts 的 build 值内 → 应选中 scripts 块，而非跨过 scripts } 命中 dependencies
    const editor = editorWith(doc, caret(doc, text.indexOf('vue-tsc && vite build') + 2));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    const sel = doc.getText(editor.selections[0]);
    assert.ok(sel.includes('"dev"'), '应包含 scripts 内容');
    assert.ok(sel.includes('"build"'), '应包含 scripts 内容');
    assert.ok(!sel.includes('"dependencies"'), '不应误选右侧 dependencies 对象');
    assert.ok(!sel.includes('"vue"'), '不应包含 dependencies 内容');
  }
});

test('select-block: JSON 光标在根对象直接子属性的值内，选中根对象而非误命中右侧 scripts', () => {
  setConfig({});
  {
    // 模拟 fret-logic：private 之后隔 version/type 才到 scripts
    const text = `{\n  "private": true,\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite"\n  }\n}`;
    const doc = makeDocument(text, '/virtual/package.json', 'json');
    // 光标在 private 的 true 值内 → 应选中根对象内容（含 scripts），而非只命中 scripts 对象
    const editor = editorWith(doc, caret(doc, text.indexOf('true') + 2));
    selectBlock(editor);
    assert.equal(editor.selections.length, 1);
    // 光标在根对象直接子属性（private）的值内 → 选中的应是根对象完整内容（含 private/version/scripts），
    // 而非误命中右侧的 scripts 对象、只选中 scripts 内容。
    assert.equal(
      doc.getText(editor.selections[0]),
      `\n  "private": true,\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite"\n  }\n`,
      '光标在根对象子属性值内应选中根对象内容，而非误命中右侧 scripts 对象'
    );
  }
});
