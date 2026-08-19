// 文件级样式索引测试：类/ID 定义位置提取、规则块惰性缓存、失效
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { cleanup, makeUri, makeWorkspace, setConfig } from './helpers';
// 全部必须同 bundle：getFileIndex 依赖 style-completion 的 fileTextCache（readFileTextCached），
// clearStyleFileCache 要能清到同一实例的缓存（esbuild bundle 间模块状态互不相通）。
// 真实失效路径（onDidSaveTextDocument）同时清 fileTextCache 与 index，测试同步模拟。
import { clearStyleFileCache } from '@/providers/style-completion';
import { clearStyleIndex, extractSelectorDefs, getFileIndex, getSelectorRuleBlocks } from '@/providers/style-index';
import { parseStyleFile } from '@/providers/style-parser';

test('extractSelectorDefs：类/ID/伪类/多选择器/嵌套都提取，at-rule 与字符串内不提取', () => {
  const content = `
@import "other.less";
.plain { color: red; }
.hovered:hover { color: blue; }
.a, .b { color: green; }
#main { width: 100px; }
.parent {
  .child { color: black; }
}
.badge { content: ".not-a-def"; }
@media (max-width: 768px) {
  .responsive { color: gray; }
}
`;
  const defs = extractSelectorDefs(content);

  const names = Array.from(defs.keys());
  for (const name of ['.plain', '.hovered', '.a', '.b', '#main', '.parent', '.child', '.responsive']) {
    assert.ok(names.includes(name), `应提取 ${name}`);
  }
  assert.ok(!names.includes('.not-a-def'), '字符串内的 .not-a-def 不应被提取');
  // 同文件同名多定义：.a 应只有一条（.a, .b 选择器段内出现一次）
  assert.equal(defs.get('.a')!.length, 1);
  // offset 指向定义名起点
  const plainOffset = content.indexOf('.plain');
  assert.equal(defs.get('.plain')![0].offset, plainOffset, 'offset 应指向 .plain 起点');
});

test('extractSelectorDefs：同名定义多处保留（供 F12 多结果切换）', () => {
  const content = '.card { a: 1; }\n.theme .card { b: 2; }\n';
  const defs = extractSelectorDefs(content);
  assert.equal(defs.get('.card')!.length, 2, '两处 .card 定义都应保留');
});

test('getFileIndex：同一文件重复获取命中缓存（同实例、不重复读盘解析）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const file = join(ws, 'a.less');
    writeFileSync(file, '.x { color: red; }\n');
    const uri = makeUri(file);
    const first = await getFileIndex(uri);
    const second = await getFileIndex(uri);
    assert.strictEqual(first, second, '缓存命中应返回同一实例');
    assert.ok(first.selectorDefs.has('.x'), '应解析出 .x 定义');
  } finally {
    cleanup(ws);
  }
});

test('getSelectorRuleBlocks：规则块提取 + 惰性缓存命中', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const file = join(ws, 'b.less');
    writeFileSync(file, '.btn {\n  color: red;\n  &:hover {\n    color: blue;\n  }\n}\n');
    const uri = makeUri(file);

    const blocks = await getSelectorRuleBlocks(uri, '.btn');
    assert.equal(blocks.length, 1);
    assert.ok(blocks[0].includes('.btn {'), '规则块应含选择器头');
    assert.ok(blocks[0].includes('color: red'), '规则块应含规则体');

    // 惰性缓存：第二次取同一 selector 返回缓存（同一数组引用）
    const cached = await getSelectorRuleBlocks(uri, '.btn');
    assert.strictEqual(cached, blocks, '重复获取应命中惰性缓存');

    // 未定义的选择器返回空
    assert.deepEqual(await getSelectorRuleBlocks(uri, '.nope'), []);
  } finally {
    cleanup(ws);
  }
});

test('clearStyleIndex：失效后重新读盘解析（文件内容变化可见）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const file = join(ws, 'c.less');
    writeFileSync(file, '.old { color: red; }\n');
    const uri = makeUri(file);

    const first = await getFileIndex(uri);
    assert.ok(first.selectorDefs.has('.old'));

    // 模拟保存（onDidSaveTextDocument 的真实失效路径）：fileTextCache 与索引都清
    writeFileSync(file, '.new { color: blue; }\n');
    clearStyleFileCache(uri);
    clearStyleIndex(uri);
    const second = await getFileIndex(uri);
    assert.ok(second.selectorDefs.has('.new'), '失效后应解析出新定义');
    assert.ok(!second.selectorDefs.has('.old'), '失效后不应再有旧定义');
  } finally {
    cleanup(ws);
  }
});

// H1 回归：mixin 符号的 offset/line 必须基于原文换算。
// 旧实现用 stripCommentsSafe 删注释后跑正则，m.index 相对「变短的文本」，
// 与原文 lineStarts 错位——mixin 前有注释时跳转落点错行。
test('parseStyleFile：less mixin 定义前有注释时，offset/line 与原文一致', () => {
  const content = `// 这是混入定义前的注释\n// 跨行注释也要处理\n.foo(@a: "x;y") {}\n`;
  const parsed = parseStyleFile(content, 'test.less');

  const mixin = parsed.symbols.find(s => s.kind === 'mixin');
  assert.ok(mixin, '应解析出 mixin 符号');

  const expectedOffset = content.indexOf('.foo');
  const expectedLine = 2; // 注释占 2 行，.foo 在第 3 行（0-based 为 2）
  assert.equal(mixin.offset, expectedOffset, 'offset 应指向 .foo 起点（与原文一致）');
  assert.equal(mixin.line, expectedLine, 'line 应基于原文行表换算（注释删除会让行号错位）');
  // snippet 保留参数里的字符串内容（掩码不能吞掉字符串）
  assert.ok(mixin.snippet!.includes('"x;y"'), 'snippet 应保留参数内的字符串字面量');
});

test('parseStyleFile：scss mixin 定义前有注释时，offset/line 与原文一致', () => {
  const content = `/* 块注释在 mixin 前 */\n@mixin big($size: 2em) {}\n`;
  const parsed = parseStyleFile(content, 'test.scss');

  const mixin = parsed.symbols.find(s => s.kind === 'scss-mixin');
  assert.ok(mixin, '应解析出 scss-mixin 符号');

  assert.equal(mixin.offset, content.indexOf('@mixin'), 'offset 应指向 @mixin 起点');
  assert.equal(mixin.line, 1, '块注释占 1 行，@mixin 在第 2 行（0-based 为 1）');
});

test('parseStyleFile：mixin 前无注释时偏移不受影响（对照组）', () => {
  const content = `.plain(@a: 1) {}\n`;
  const parsed = parseStyleFile(content, 'test.less');
  const mixin = parsed.symbols.find(s => s.kind === 'mixin');
  assert.ok(mixin);
  assert.equal(mixin.offset, 0);
  assert.equal(mixin.line, 0);
});

test('extractSelectorDefs：注释掩码为等长空白后 offset 仍指向原文', () => {
  const content = `/* 注释 */\n.card { a: 1; }\n`;
  const defs = extractSelectorDefs(content);
  const entry = defs.get('.card');
  assert.ok(entry, '应提取 .card');
  // offset 必须指向原文 .card 起点（旧 stripCommentsSafe 删注释后这里会偏移 8 个字符）
  assert.equal(entry![0].offset, content.indexOf('.card'), '注释前的 offset 应与原文一致');
  // 且注释里的内容不能被误当成定义
  const fake = `/* .card-in-comment { color: red; } */\n.real { a: 1; }\n`;
  const fakeDefs = extractSelectorDefs(fake);
  assert.ok(!fakeDefs.has('.card-in-comment'), '注释内的类名不应被提取');
});

test('extractSelectorDefs：Tailwind 负值 / BEM 下划线 / arbitrary value 转义类名', () => {
  const content = `.-mt-2 { margin-top: -0.5rem; }\n._hidden { display: none; }\n.w-\\[10px\\] { width: 10px; }\n`;
  const defs = extractSelectorDefs(content);
  const names = Array.from(defs.keys());
  assert.ok(names.includes('.-mt-2'), 'Tailwind 负值类名入索引');
  assert.ok(names.includes('._hidden'), 'BEM 下划线修饰符入索引');
  assert.ok(
    names.some(n => n.startsWith('.w-\\')),
    'arbitrary value 反斜杠转义部分入索引'
  );
});
