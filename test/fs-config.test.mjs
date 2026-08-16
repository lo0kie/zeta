// core/fs（parseUriList / findRootUri / basename）+ core/configuration 类型回落
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loadModule, makeWorkspace, setConfig, cleanup, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { Uri } = require(shimPath);

const { parseUriList, findRootUri, basename } = await loadModule(`
  export { parseUriList, findRootUri, basename } from './src/core/fs';
  export { Configuration } from './src/core/configuration';
`);

const { Configuration } = await loadModule(`export { Configuration } from './src/core/configuration';`);

test('parseUriList：盘符 / POSIX / UNC / 原生路径 / 注释与空行 / 非 file 协议丢弃', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const paths = s => parseUriList(s).map(u => u.fsPath);
    assert.deepEqual(paths('file:///C:/Users/My%20Folder'), ['C:/Users/My Folder']);
    assert.deepEqual(paths('file:///Users/foo'), ['/Users/foo']);
    assert.deepEqual(paths('file://server/share/dir'), ['//server/share/dir']);
    assert.deepEqual(paths('C:\\native\\path'), ['C:\\native\\path']);
    assert.deepEqual(paths('/native/path'), ['/native/path']);
    assert.deepEqual(paths('file:///a\n# comment\n\nfile:///b'), ['/a', '/b']);
    assert.deepEqual(paths('https://example.com/x\nfile:///c'), ['/c']);
    assert.deepEqual(paths('file:///a%zz'), [], '非法百分号编码丢弃');
    assert.deepEqual(paths(''), []);
  } finally {
    cleanup(ws);
  }
});

test('findRootUri：无 package.json 停在工作区根、不越界探测', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const deep = join(ws, 'no-pkg', 'a', 'b');
    mkdirSync(deep, { recursive: true });
    const root = await findRootUri(Uri.file(join(deep, 'file.ts')));
    assert.equal(root.fsPath.replace(/[\\/]+$/, ''), ws, '回落工作区根');

    // 子目录有 package.json → 返回其所在目录
    const proj = join(ws, 'proj');
    mkdirSync(join(proj, 'src'), { recursive: true });
    writeFileSync(join(proj, 'package.json'), '{}');
    const root2 = await findRootUri(Uri.file(join(proj, 'src', 'file.ts')));
    assert.equal(root2.fsPath.replace(/[\\/]+$/, ''), proj);
  } finally {
    cleanup(ws);
  }
});

test('basename / dirname', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    assert.equal(basename(Uri.file(join(ws, 'a', 'b.ts'))), 'b.ts');
    assert.equal(basename(Uri.file(join(ws, 'dir'))), 'dir');
  } finally {
    cleanup(ws);
  }
});

test('Configuration 类型回落：脏配置不流入业务', () => {
  const ws = makeWorkspace();
  try {
    setConfig({ 'zeta.list.folders': 'not-an-array', 'zeta.string.tag': 42, 'zeta.case.custom': 'bad' });
    assert.deepEqual(Configuration.FOLDERS, [], '数组键收到非数组回落默认');
    assert.equal(Configuration.TAG, 'div', '字符串键收到数字回落默认');
    assert.deepEqual(Configuration.CASE_CUSTOM, {}, '对象键收到字符串回落默认');
    assert.equal(Configuration.TERMINAL, true, 'boolean 默认');
  } finally {
    cleanup(ws);
  }
});
