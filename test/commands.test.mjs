// 命令层：tags-wrap / unwrap-tags / wrap-with / cycle-case / cycle-quotes / run-script
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadModule, makeWorkspace, setConfig, cleanup, makeDocument, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const vscode = require(shimPath);
const { Selection, Position, Uri } = vscode;

const { tagsWrap, unwrapTags, wrapWithConsole, wrapWithTryCatch, wrapWithIf, cycleCase, cycleQuotes, runScript } =
  await loadModule(`
    export { default as tagsWrap } from './src/commands/tags-wrap';
    export { default as unwrapTags } from './src/commands/unwrap-tags';
    export { wrapWithConsole, wrapWithTryCatch, wrapWithIf } from './src/commands/wrap-with';
    export { default as cycleCase } from './src/commands/cycle-case';
    export { default as cycleQuotes } from './src/commands/cycle-quotes';
    export { default as runScript } from './src/commands/run-script';
  `);

function editorWith(doc, selection, options = { insertSpaces: true, tabSize: 2 }) {
  return {
    document: doc,
    selections: [selection],
    options,
    revealRange: async () => {},
  };
}

function lastApply() {
  return globalThis.__lastApply ?? [];
}

test('tags-wrap 空行插入：单 op 原子 + 双标签名选区', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div' });
  try {
    const doc = makeDocument('', join(ws, 't.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 0)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1, '单次原子插入');
    assert.equal(ops[0].text, '<div></div>');
    const [open, close] = editor.selections;
    assert.equal(ops[0].text.slice(open.start.character, open.end.character), 'div');
    assert.equal(ops[0].text.slice(close.start.character, close.end.character), 'div', '闭标签名选区不吞 /');
    assert.equal(close.end.character, 10, '闭标签锚点 4+2L');
  } finally {
    cleanup(ws);
  }
});

test('tags-wrap 非空行行尾：整行下沉包裹', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div' });
  try {
    const doc = makeDocument('  hello', join(ws, 't2.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 7), new Position(0, 7)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 2);
    assert.equal(ops[0].text, '  <div>\n  ');
    assert.equal(ops[1].text, '\n  </div>');
  } finally {
    cleanup(ws);
  }
});

test('tags-wrap 单行选区：左右包裹', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'span' });
  try {
    const doc = makeDocument('hi', join(ws, 't3.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 2)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 2);
    assert.deepEqual(ops.map(o => o.text), ['<span>', '</span>']);
    const [open] = editor.selections;
    assert.equal(open.end.character - open.start.character, 4, '开标签名 span 选中');
  } finally {
    cleanup(ws);
  }
});

test('tags-wrap 多行选区：包裹 + 中间行缩进 + 双标签名选区', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.string.tag': 'div' });
  try {
    const doc = makeDocument('a\nb\nc', join(ws, 't4.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(2, 1)));
    globalThis.__lastApply = null;
    await tagsWrap(editor);
    const ops = lastApply();
    assert.equal(ops.length, 4, '首插 + 尾插 + 中间 2 行缩进');
    assert.equal(ops[0].text, '<div>\n  ');
    assert.equal(ops[1].text, '\n</div>');
    const [open, close] = editor.selections;
    assert.equal(open.end.character - open.start.character, 3, '开标签名 div');
    assert.equal(close.end.character - close.start.character, 3, '闭标签名 div');
  } finally {
    cleanup(ws);
  }
});

test('unwrap-tags 空标签多行：range 相邻不重叠', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('<div>\n</div>', join(ws, 'u.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 1), new Position(0, 1)));
    globalThis.__lastApply = null;
    await unwrapTags(editor);
    const ops = lastApply();
    assert.equal(ops.length, 2);
    const [r1, r2] = ops.map(o => o.range);
    assert.deepEqual([r1.start.line, r1.start.character, r1.end.line, r1.end.character], [0, 0, 1, 0]);
    assert.deepEqual([r2.start.line, r2.start.character, r2.end.line, r2.end.character], [1, 0, 1, 6]);
    assert.ok(r1.end.line === r2.start.line && r1.end.character === r2.start.character, '相邻不重叠');
  } finally {
    cleanup(ws);
  }
});

test('unwrap-tags 单行标签：移除开闭标签', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('<span>text</span>', join(ws, 'u2.html'), 'html');
    const editor = editorWith(doc, new Selection(new Position(0, 3), new Position(0, 3)));
    globalThis.__lastApply = null;
    await unwrapTags(editor);
    const ops = lastApply();
    assert.equal(ops.length, 2);
    const texts = ops.map(o => doc.getText(o.range));
    assert.deepEqual(texts, ['</span>', '<span>']);
  } finally {
    cleanup(ws);
  }
});

test('wrap-with console.log：光标落在左括号后', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('foo', join(ws, 'w.js'), 'javascript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 3)));
    globalThis.__lastApply = null;
    await wrapWithConsole(editor);
    assert.equal(lastApply()[0].text, 'console.log(foo)');
    assert.equal(editor.selections[0].active.character, 'console.log('.length);
  } finally {
    cleanup(ws);
  }
});

test('wrap-with try/catch：非整行选区扩展 + 缩进对齐 + 光标在 catch 占位行', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('  const a = 1;', join(ws, 'w2.js'), 'javascript');
    const editor = editorWith(doc, new Selection(new Position(0, 2), new Position(0, 14)));
    globalThis.__lastApply = null;
    await wrapWithTryCatch(editor);
    const ops = lastApply();
    assert.equal(ops[0].range.start.character, 0, '选区扩展为整行');
    const wrapped = ops[0].text;
    assert.equal(wrapped, '  try {\n    const a = 1;\n  } catch (error) {\n    \n  }');
    assert.deepEqual(
      [editor.selections[0].active.line, editor.selections[0].active.character],
      [3, 4],
      '光标在 catch 占位行'
    );
  } finally {
    cleanup(ws);
  }
});

test('wrap-with if：非整行选区 + condition 选区覆盖 true', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('  const a = 1;', join(ws, 'w3.js'), 'javascript');
    const editor = editorWith(doc, new Selection(new Position(0, 2), new Position(0, 14)));
    globalThis.__lastApply = null;
    await wrapWithIf(editor);
    const wrapped = lastApply()[0].text;
    assert.equal(wrapped, '  if (true) {\n    const a = 1;\n  }');
    const sel = editor.selections[0];
    assert.deepEqual([sel.start.character, sel.end.character], [6, 10]);
    assert.equal(wrapped.slice(6, 10), 'true');
  } finally {
    cleanup(ws);
  }
});

test('wrap-with 空行选区：放弃（无编辑）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('a\n\nb', join(ws, 'w4.js'), 'javascript');
    const editor = editorWith(doc, new Selection(new Position(1, 0), new Position(1, 0)));
    globalThis.__lastApply = null;
    await wrapWithIf(editor);
    assert.equal(lastApply().length, 0);
  } finally {
    cleanup(ws);
  }
});

test('cycle-case 默认顺序：snake → constant', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument('hello_world', join(ws, 'c.ts'), 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 11)), {});
    await cycleCase(editor);
    assert.equal(editor.selections[0].end.character, 'HELLO_WORLD'.length);
  } finally {
    cleanup(ws);
  }
});

test('cycle-case 自定义顺序含自定义格式', async () => {
  const ws = makeWorkspace();
  setConfig({
    'zeta.case.custom': { 'Vue Kebab': [{ pattern: '([a-z])([A-Z])', replacement: '$1-$2' }] },
    'zeta.case.cycleOrder': ['Camel Case', 'Vue Kebab'],
  });
  try {
    const doc = makeDocument('helloWorld', join(ws, 'c2.ts'), 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 0), new Position(0, 10)), {});
    await cycleCase(editor);
    const sel = editor.selections[0];
    assert.equal(sel.end.character - sel.start.character, 'hello-world'.length);
  } finally {
    cleanup(ws);
  }
});

test('cycle-quotes 拼接链合并为模板', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'const s = "a" + "b";';
    const doc = makeDocument(text, join(ws, 'q.ts'), 'typescript');
    const editor = editorWith(doc, new Selection(new Position(0, 13), new Position(0, 13)), {});
    await cycleQuotes(editor);
    const ops = lastApply();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].text, '`ab`');
  } finally {
    cleanup(ws);
  }
});

test('run-script askArguments=false：选中脚本直接运行（npm）', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.runScript.askArguments': false });
  try {
    const pkgPath = join(ws, 'package.json');
    writeFileSync(pkgPath, JSON.stringify({ scripts: { build: 'tsc' } }));
    const created = [];
    const origPick = vscode.window.showQuickPick;
    const origInput = vscode.window.showInputBox;
    const origTerminal = vscode.window.createTerminal;
    vscode.window.showQuickPick = async () => ({ label: 'build', detail: 'tsc' });
    vscode.window.showInputBox = async () => {
      throw new Error('askArguments=false 不应询问参数');
    };
    vscode.window.createTerminal = opts => {
      created.push(opts);
      return { show() {}, sendText(c) { created.push(c); }, dispose() {} };
    };
    try {
      await runScript(Uri.file(pkgPath));
      assert.equal(created.length, 2, 'createTerminal + sendText');
      assert.equal(created[1], 'npm run build', '默认 npm（无 lockfile）');
      assert.ok(created[0].name.includes('npm run build'));
    } finally {
      vscode.window.showQuickPick = origPick;
      vscode.window.showInputBox = origInput;
      vscode.window.createTerminal = origTerminal;
    }
  } finally {
    cleanup(ws);
  }
});
