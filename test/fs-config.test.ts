import { Configuration } from '@/core/configuration';
import { basename, findRootUri, isSameUri, parseUriList, resolveUriArgument } from '@/core/fs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { Uri } from 'vscode';
import { cleanup, makeWorkspace, setConfig } from './helpers';
// core/fs（parseUriList / findRootUri / basename）+ core/configuration 类型回落

test('parseUriList：盘符 / POSIX / UNC / 原生路径 / 注释与空行 / 非 file 协议丢弃', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const paths = (s: string) => parseUriList(s).map(u => u.fsPath);
    assert.deepEqual(paths('file:///C:/Users/My%20Folder'), ['C:/Users/My Folder']);
    assert.deepEqual(paths('file:///Users/foo'), ['/Users/foo']);
    assert.deepEqual(paths('file://server/share/dir'), ['//server/share/dir']);
    assert.deepEqual(paths('C:\\native\\path'), ['C:\\native\\path']);
    assert.deepEqual(paths('/native/path'), ['/native/path']);
    assert.deepEqual(paths('file:///a\n# comment\n\nfile:///b'), ['/a', '/b']);
    assert.deepEqual(paths('https://example.com/x\nfile:///c'), ['/c']);
    // 非法百分号编码：解码失败降级为原字符串路径
    assert.deepEqual(paths('file:///a%zz'), ['/a%zz']);
    assert.deepEqual(paths(''), []);
    // 纯注释输入不产生路径
    assert.deepEqual(paths('# only comment'), []);
    // 原生路径：反斜杠归一化到 path（fsPath 保持原始）
    const native = parseUriList('C:\\a.txt');
    assert.equal(native[0].path, 'C:/a.txt');
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
    assert.ok(root, '应回落到工作区根');
    assert.equal(root.fsPath.replace(/[\\/]+$/, ''), ws, '回落工作区根');

    // 子目录有 package.json → 返回其所在目录
    const proj = join(ws, 'proj');
    mkdirSync(join(proj, 'src'), { recursive: true });
    writeFileSync(join(proj, 'package.json'), '{}');
    const root2 = await findRootUri(Uri.file(join(proj, 'src', 'file.ts')));
    assert.ok(root2, '应找到含 package.json 的目录');
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
    // 边界：尾斜杠取上一非空段；根目录无段
    assert.equal(basename(Uri.file('/a/b/')), 'b');
    assert.equal(basename(Uri.file('/')), '');
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

test('isSameUri：Windows 大小写不敏感，其余平台精确', () => {
  const a = Uri.file('/workspace/proj/src');
  assert.equal(isSameUri(a, a), true);
  assert.equal(isSameUri(a, undefined), false);
  assert.equal(isSameUri(undefined, a), false);
  assert.equal(isSameUri(a, Uri.file('/workspace/proj/dist')), false);

  const winA = Uri.file('C:/Workspace/Proj');
  const winB = Uri.file('c:/workspace/proj');
  // 断言行为与平台一致：Windows 上忽略大小写，POSIX 上区分
  assert.equal(isSameUri(winA, winB), process.platform === 'win32', 'Windows 大小写不敏感，其余平台精确比较');

  // 双 undefined 与不同路径
  assert.equal(isSameUri(undefined, undefined), false);
  assert.equal(isSameUri(a, Uri.file('/workspace/proj/src')), true);
  assert.equal(isSameUri(a, Uri.file('/workspace/proj/other')), false);
});

test('resolveUriArgument: 归一化为 Uri 的各种形态', () => {
  const uri = Uri.file('/x/y');
  assert.equal(resolveUriArgument(uri), uri);
  assert.equal(resolveUriArgument({ resourceUri: uri }), uri);
  assert.equal(resolveUriArgument({ uri }), uri);
  assert.equal(typeof resolveUriArgument(undefined), 'undefined');
  assert.equal(typeof resolveUriArgument({ foo: 1 }), 'undefined');
  assert.equal(typeof resolveUriArgument({ resourceUri: { notUri: 1 } }), 'undefined');
});
