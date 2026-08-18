import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, loadModule, makeDocument, makeWorkspace, setConfig } from './helpers.mjs';

const { PathDefinitionProvider } = await loadModule(`
  export { PathDefinitionProvider } from './src/providers/path-definition';
`);

const provider = new PathDefinitionProvider();

function firstFsPath(loc) {
  if (!loc) return undefined;
  const target = Array.isArray(loc) ? loc[0] : loc;
  return target?.uri?.fsPath ?? target?.targetUri?.fsPath;
}

// 返回所有命中的文件 fsPath（单结果也归一为数组）；兼容 Location(.uri) 与 LocationLink(.targetUri)
function allFsPaths(loc) {
  if (!loc) return [];
  const arr = Array.isArray(loc) ? loc : [loc];
  return arr.map(l => (l.uri ?? l.targetUri).fsPath);
}

// shim 的 Uri.file 在拼接 index 路径（fsPath + '/index.ts'）时保留 /，真实 vscode 会归一为 \；
// 仅对目录 index 回退用例做分隔符归一化比较。
const normSep = p => (p ? p.replace(/\\/g, '/') : p);

// ─────────────────────────────────────────────────────────────
// 路径解析分支
// ─────────────────────────────────────────────────────────────

test('相对路径 ./foo 跳转到 foo.ts（精确匹配 + 扩展名回退）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'foo.ts'), 'export const foo = 1;');
    const doc = makeDocument(`import foo from './foo';\nconsole.log(foo);`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 18 });
    assert.equal(firstFsPath(loc), join(ws, 'foo.ts'));
  } finally {
    cleanup(ws);
  }
});

test('父级相对路径 ../foo 跳转到上级目录文件', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    // 把当前文件放在子目录，使 ../foo 仍落在工作区内
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'foo.ts'), 'export const foo = 1;');
    const doc = makeDocument(`import foo from '../foo';\n`, join(ws, 'src', 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 19 });
    assert.equal(firstFsPath(loc), join(ws, 'foo.ts'));
  } finally {
    cleanup(ws);
  }
});

test('省略 ./ 前缀的相对子路径 src/utils/foo 仍可跳转', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'utils'), { recursive: true });
    writeFileSync(join(ws, 'src', 'utils', 'foo.ts'), 'export const foo = 1;');
    const doc = makeDocument(`import foo from 'src/utils/foo';\n`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 25 });
    assert.equal(firstFsPath(loc), join(ws, 'src', 'utils', 'foo.ts'));
  } finally {
    cleanup(ws);
  }
});

test('@/ 别名经 tsconfig paths 跳转到 src/components/Button.tsx', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'components'), { recursive: true });
    writeFileSync(join(ws, 'src', 'components', 'Button.tsx'), 'export const Button = () => null;');
    writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));
    const doc = makeDocument(`import Button from '@/components/Button';\n`, join(ws, 'src', 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 30 });
    assert.equal(firstFsPath(loc), join(ws, 'src', 'components', 'Button.tsx'));
  } finally {
    cleanup(ws);
  }
});

test('@/foo 在 src 内、无 tsconfig 时仍按 src 回退跳转', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    // 不写 tsconfig：别名解析返回空，应命中「@/ + 工作区 src」兜底分支
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src', 'foo.ts'), 'export const foo = 1;');
    const doc = makeDocument(`import foo from '@/foo';\n`, join(ws, 'src', 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 19 });
    assert.equal(firstFsPath(loc), join(ws, 'src', 'foo.ts'));
  } finally {
    cleanup(ws);
  }
});

test('@/ 别名下的 .vue 组件：显式带扩展名与省略扩展名都能跳转到 .vue 文件', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'components'), { recursive: true });
    writeFileSync(join(ws, 'src', 'components', 'BaseSegmentedControl.vue'), '<template></template>');
    writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));

    // 1) 显式带 .vue 扩展名
    const line1 = `import X from '@/components/BaseSegmentedControl.vue';\n`;
    const doc1 = makeDocument(line1, join(ws, 'src', 'main.ts'), 'typescript');
    const loc1 = await provider.provideDefinition(doc1, { line: 0, character: line1.indexOf('BaseSegmentedControl') + 5 });
    assert.ok(Array.isArray(loc1) || loc1, '显式扩展名应返回结果');
    assert.ok(
      allFsPaths(loc1).map(normSep).includes(normSep(join(ws, 'src', 'components', 'BaseSegmentedControl.vue'))),
      '显式 .vue 应命中组件文件'
    );

    // 2) 省略扩展名，仍应探测到 .vue
    const line2 = `import X from '@/components/BaseSegmentedControl';\n`;
    const doc2 = makeDocument(line2, join(ws, 'src', 'main.ts'), 'typescript');
    const loc2 = await provider.provideDefinition(doc2, { line: 0, character: line2.indexOf('BaseSegmentedControl') + 5 });
    assert.ok(
      allFsPaths(loc2).map(normSep).includes(normSep(join(ws, 'src', 'components', 'BaseSegmentedControl.vue'))),
      '省略扩展名也应命中 .vue 组件'
    );
  } finally {
    cleanup(ws);
  }
});

test('~/ 路径跳转到工作区根目录下的文件', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'root-file.ts'), 'export const Y = 1;');
    const doc = makeDocument(`import Y from '~/root-file';\n`, join(ws, 'src', 'deep', 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 18 });
    assert.equal(firstFsPath(loc), join(ws, 'root-file.ts'));
  } finally {
    cleanup(ws);
  }
});

test('绝对工作区路径 /src/components 跳转到目录的 index 文件', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'components'), { recursive: true });
    writeFileSync(join(ws, 'src', 'components', 'index.ts'), 'export const C = 1;');
    const doc = makeDocument(`import C from '/src/components';\n`, join(ws, 'src', 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 24 });
    assert.equal(normSep(firstFsPath(loc)), normSep(join(ws, 'src', 'components', 'index.ts')));
  } finally {
    cleanup(ws);
  }
});

test('裸模块说明符 react 不跳转到同名本地文件（修复 false positive）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    // 本地恰好存在同名文件，旧实现会错误跳转过去
    writeFileSync(join(ws, 'react.ts'), 'export const react = 1;');
    const doc = makeDocument(`import react from 'react';\n`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 18 });
    assert.equal(loc, undefined);
  } finally {
    cleanup(ws);
  }
});

// ─────────────────────────────────────────────────────────────
// 守卫：非路径位置
// ─────────────────────────────────────────────────────────────

test('非导入位置的普通字符串不触发跳转', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument(`const msg = "hello world";\n`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 15 });
    assert.equal(loc, undefined);
  } finally {
    cleanup(ws);
  }
});

test('光标落在字符串之外（如 import 关键字上）不触发跳转', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    // 光标在 import 关键字上，不在 './foo' 字符串区间内，应当短路返回
    writeFileSync(join(ws, 'foo.ts'), 'export const foo = 1;');
    const doc = makeDocument(`import foo from './foo';\n`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 3 });
    assert.equal(loc, undefined);
  } finally {
    cleanup(ws);
  }
});

// ─────────────────────────────────────────────────────────────
// 扩展名探测 / 目录 index 回退
// ─────────────────────────────────────────────────────────────

test('已知扩展名仍回退到同基名其他扩展名（.tsx 导入 -> .ts 文件，NodeNext 风格）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'foo.ts'), 'export const foo = 1;');
    const doc = makeDocument(`import foo from './foo.tsx';\n`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 18 });
    assert.equal(firstFsPath(loc), join(ws, 'foo.ts'));
  } finally {
    cleanup(ws);
  }
});

test('含点的文件名 my.component 不被误拆（my.component.ts 可被找到）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'my.component.ts'), 'export const c = 1;');
    const doc = makeDocument(`import c from './my.component';\n`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 20 });
    assert.equal(firstFsPath(loc), join(ws, 'my.component.ts'));
  } finally {
    cleanup(ws);
  }
});

test('精确扩展名优先：./foo.js 与 ./foo.ts 同时存在时跳转到 .js', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'foo.js'), 'export const a = 1;');
    writeFileSync(join(ws, 'foo.ts'), 'export const b = 1;');
    const doc = makeDocument(`import a from './foo.js';\n`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 18 });
    assert.equal(firstFsPath(loc), join(ws, 'foo.js'));
  } finally {
    cleanup(ws);
  }
});

test('无扩展名且多候选并存时按候选顺序命中首个（.ts 优先于 .vue）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'foo.ts'), 'export const a = 1;');
    writeFileSync(join(ws, 'foo.vue'), 'export const b = 1;');
    const doc = makeDocument(`import foo from './foo';\n`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 18 });
    assert.equal(firstFsPath(loc), join(ws, 'foo.ts'));
  } finally {
    cleanup(ws);
  }
});

test('目录导入回退到 index 文件，且 index 候选按扩展名顺序命中首个（index.ts 优先于 index.js）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'lib'), { recursive: true });
    writeFileSync(join(ws, 'lib', 'index.ts'), 'export const A = 1;');
    writeFileSync(join(ws, 'lib', 'index.js'), 'export const B = 1;');
    const doc = makeDocument(`import X from './lib';\n`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 18 });
    assert.equal(normSep(firstFsPath(loc)), normSep(join(ws, 'lib', 'index.ts')));
  } finally {
    cleanup(ws);
  }
});

// ─────────────────────────────────────────────────────────────
// 同名不同后缀：全部命中，由 VS Code 的 F12 在多个结果间切换
// ─────────────────────────────────────────────────────────────

test('同名不同后缀的多个文件全部返回（import ./foo 命中 foo.ts / foo.js / foo.vue）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'foo.ts'), 'export const a = 1;');
    writeFileSync(join(ws, 'foo.js'), 'export const b = 1;');
    writeFileSync(join(ws, 'foo.vue'), 'export const c = 1;');
    const doc = makeDocument(`import foo from './foo';\n`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 18 });
    assert.ok(Array.isArray(loc), '应返回 Location 数组');
    const paths = allFsPaths(loc).map(normSep);
    assert.ok(paths.includes(normSep(join(ws, 'foo.ts'))), '应包含 foo.ts');
    assert.ok(paths.includes(normSep(join(ws, 'foo.js'))), '应包含 foo.js');
    assert.ok(paths.includes(normSep(join(ws, 'foo.vue'))), '应包含 foo.vue');
  } finally {
    cleanup(ws);
  }
});

test('同名不同后缀全部返回（含代码型与样式型）：./foo 同时有 foo.ts 与 foo.css，两者都由我们提供', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'foo.ts'), 'export const a = 1;');
    writeFileSync(join(ws, 'foo.css'), '.foo { color: red; }');
    const doc = makeDocument(`import foo from './foo';\n`, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 18 });
    assert.ok(Array.isArray(loc), '应返回 Location 数组');
    const paths = allFsPaths(loc).map(normSep);
    assert.ok(paths.includes(normSep(join(ws, 'foo.ts'))), '应包含代码型 foo.ts');
    assert.ok(paths.includes(normSep(join(ws, 'foo.css'))), '应包含样式型 foo.css');
  } finally {
    cleanup(ws);
  }
});

test('CSS Modules：@/assets/tokens.module 同时有 .ts 与 .less，两者都返回（不依赖内置 TS 服务）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'assets'), { recursive: true });
    writeFileSync(join(ws, 'src', 'assets', 'tokens.module.ts'), 'export const a = 1;');
    writeFileSync(join(ws, 'src', 'assets', 'tokens.module.less'), ':export { a: 1 }');
    writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));
    const line = `import x from '@/assets/tokens.module';\n`;
    const doc = makeDocument(line, join(ws, 'src', 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: line.indexOf('tokens.module') + 5 });
    assert.ok(Array.isArray(loc), '应返回 Location 数组');
    const paths = allFsPaths(loc).map(normSep);
    assert.ok(paths.includes(normSep(join(ws, 'src', 'assets', 'tokens.module.ts'))), '应包含 .ts');
    assert.ok(paths.includes(normSep(join(ws, 'src', 'assets', 'tokens.module.less'))), '应包含 .less');
  } finally {
    cleanup(ws);
  }
});

test('CSS Modules：相对路径 ./tokens.module 同时有 .ts 与 .less，两者都返回', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'tokens.module.ts'), 'export const a = 1;');
    writeFileSync(join(ws, 'tokens.module.less'), ':export { a: 1 }');
    const line = `import x from './tokens.module';\n`;
    const doc = makeDocument(line, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: line.indexOf('tokens.module') + 5 });
    assert.ok(Array.isArray(loc), '应返回 Location 数组');
    const paths = allFsPaths(loc).map(normSep);
    assert.ok(paths.includes(normSep(join(ws, 'tokens.module.ts'))), '应包含 .ts');
    assert.ok(paths.includes(normSep(join(ws, 'tokens.module.less'))), '应包含 .less');
  } finally {
    cleanup(ws);
  }
});

// ─────────────────────────────────────────────────────────────
// 下划线范围：LocationLink.originSelectionRange 覆盖整个字符串
// （修复 VS Code 默认 wordPattern 把 / @ . 当分隔符、下划线只盖一个单词的问题）
// ─────────────────────────────────────────────────────────────

test('返回 LocationLink，originSelectionRange 覆盖整个导入字符串（含引号）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    mkdirSync(join(ws, 'src', 'components'), { recursive: true });
    writeFileSync(join(ws, 'src', 'components', 'BaseSegmentedControl.vue'), '<template></template>');
    writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));

    const line = `import X from '@/components/BaseSegmentedControl.vue';\n`;
    const doc = makeDocument(line, join(ws, 'src', 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: line.indexOf('BaseSegmentedControl') + 5 });

    assert.ok(Array.isArray(loc) && loc.length > 0, '应返回结果数组');
    const link = loc[0];
    assert.ok(link.targetUri, '应为 LocationLink（带 targetUri）');

    const startChar = line.indexOf("'");
    const endChar = line.lastIndexOf("'") + 1;
    assert.equal(link.originSelectionRange.start.line, 0);
    assert.equal(link.originSelectionRange.start.character, startChar, '起点应在字符串开头引号处');
    assert.equal(link.originSelectionRange.end.character, endChar, '终点应在字符串结尾引号后');
    assert.equal(
      line.slice(link.originSelectionRange.start.character, link.originSelectionRange.end.character),
      "'@/components/BaseSegmentedControl.vue'",
      'originSelectionRange 应恰好覆盖整个字符串字面量'
    );
  } finally {
    cleanup(ws);
  }
});

test('originSelectionRange 对相对路径字符串同样覆盖整个字符串', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'foo.ts'), 'export const foo = 1;');
    const line = `import foo from './foo';\n`;
    const doc = makeDocument(line, join(ws, 'main.ts'), 'typescript');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 18 });
    assert.ok(Array.isArray(loc) && loc.length > 0, '应返回结果数组');
    const link = loc[0];
    assert.equal(
      line.slice(link.originSelectionRange.start.character, link.originSelectionRange.end.character),
      "'./foo'",
      '相对路径也应整串下划线'
    );
  } finally {
    cleanup(ws);
  }
});

test('无工作区（单文件打开）+ 仅 package.json：@/ 别名仍按项目根 src 兜底解析', async () => {
  const ws = makeWorkspace(); // 工作区根，与下面的「外部项目」无关
  setConfig({});
  let proj;
  try {
    // 在临时目录建一个「项目」，但 makeDocument 的文件不在工作区内 → getWorkspaceFolder 返回 undefined
    proj = mkdtempSync(join(tmpdir(), 'zeta-nows-'));
    mkdirSync(join(proj, 'src', 'assets'), { recursive: true });
    writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'no-workspace-proj' }));
    writeFileSync(join(proj, 'src', 'assets', 'tokens.module.less'), ':export { a: 1 }');

    const line = `@import '@/assets/tokens.module';\n`;
    const doc = makeDocument(line, join(proj, 'src', 'styles', 'main.less'), 'less');
    const loc = await provider.provideDefinition(doc, { line: 0, character: line.indexOf('tokens.module') + 5 });
    assert.ok(loc, '应返回结果');
    const paths = allFsPaths(loc).map(normSep);
    assert.ok(paths.includes(normSep(join(proj, 'src', 'assets', 'tokens.module.less'))), '应兜底命中 src/assets/tokens.module.less');
  } finally {
    cleanup(ws);
    if (proj) cleanup(proj);
  }
});

test('自定义 zeta.path.extensions：只探测配置的后缀', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.path.extensions': ['.less'] });
  try {
    writeFileSync(join(ws, 'foo.ts'), 'export const a = 1;');
    writeFileSync(join(ws, 'foo.less'), '@c: red;');
    const doc = makeDocument(`@import './foo';\n`, join(ws, 'main.less'), 'less');
    const loc = await provider.provideDefinition(doc, { line: 0, character: 12 });
    assert.ok(loc, '应返回结果');
    const paths = allFsPaths(loc).map(normSep);
    assert.ok(paths.includes(normSep(join(ws, 'foo.less'))), '应命中配置中的 .less');
    assert.ok(!paths.includes(normSep(join(ws, 'foo.ts'))), '不应命中未配置的 .ts');
  } finally {
    cleanup(ws);
  }
});
