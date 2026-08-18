import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { loadModule, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { Uri } = require(shimPath);

const { basename, isSameUri, resolveUriArgument, parseUriList } = await loadModule(
  `export { basename, isSameUri, resolveUriArgument, parseUriList } from './src/core/fs';`
);

test('basename: 末段提取（含尾斜杠与根）', () => {
  assert.equal(basename(Uri.file('/a/b/c.ts')), 'c.ts');
  assert.equal(basename(Uri.file('/a/b/')), 'b'); // 尾斜杠取上一非空段
  assert.equal(basename(Uri.file('/')), ''); // 根目录无段
  assert.equal(basename(Uri.file('C:/x/y.png')), 'y.png');
});

test('isSameUri: 未定义与不同路径', () => {
  const a = Uri.file('/a/b');
  assert.equal(isSameUri(undefined, a), false);
  assert.equal(isSameUri(a, undefined), false);
  assert.equal(isSameUri(undefined, undefined), false);
  assert.equal(isSameUri(a, Uri.file('/a/b')), true);
  assert.equal(isSameUri(a, Uri.file('/a/c')), false);
});

test('isSameUri: Windows 大小写不敏感（win32 下）', () => {
  // 当前测试运行于 win32，路径比较忽略大小写
  if (process.platform === 'win32') {
    assert.equal(isSameUri(Uri.file('C:/A'), Uri.file('c:/a')), true);
    assert.equal(isSameUri(Uri.file('C:/A'), Uri.file('C:/B')), false);
  } else {
    assert.equal(isSameUri(Uri.file('/A'), Uri.file('/a')), false);
  }
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

test('parseUriList: file://、注释、空行、编码、UNC、原生路径', () => {
  const list = 'file:///C:/a.txt\n# comment\n\nfile:///D:/b.txt';
  const uris = parseUriList(list);
  assert.equal(uris.length, 2);
  assert.equal(uris[0].fsPath, 'C:/a.txt');
  assert.equal(uris[1].fsPath, 'D:/b.txt');

  // 空格编码 %20 解码
  const decoded = parseUriList('file:///C:/a%20b.txt');
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].fsPath, 'C:/a b.txt');

  // 空串
  assert.deepEqual(parseUriList(''), []);
  assert.deepEqual(parseUriList('# only comment'), []);

  // UNC 路径
  const unc = parseUriList('file://host/share/x');
  assert.equal(unc.length, 1);
  assert.equal(unc[0].fsPath, '//host/share/x');

  // 原生路径
  const native = parseUriList('C:\\a.txt');
  assert.equal(native.length, 1);
  assert.equal(native[0].path, 'C:/a.txt'); // Uri.file 将反斜杠归一化到 path

  // 非法百分号编码：解码失败降级为原字符串路径（不再丢弃）
  const fallback = parseUriList('file:///C:/a%zz.txt');
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].fsPath, 'C:/a%zz.txt');
});
