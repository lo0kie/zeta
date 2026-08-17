import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, countFs, loadModule, makeWorkspace, norm, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { Uri } = require(shimPath);

const { ExplorerTreeViewProvider, appendConfiguredFolders, removeConfiguredFolder, Configuration } = await loadModule(`
  export { ExplorerTreeViewProvider } from './src/explorer/provider';
  export { appendConfiguredFolders, removeConfiguredFolder } from './src/explorer/folders';
  export { default as addFolder } from './src/commands/add-folder';
  export { default as removeFolder } from './src/commands/remove-folder';
  export { Configuration } from './src/core/configuration';
`);

test('未配置目录时 getChildren 返回占位节点且不可展开', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.list.folders': [] });
  try {
    const provider = new ExplorerTreeViewProvider();
    const roots = await provider.getChildren();
    assert.equal(roots.length, 1);
    assert.equal(roots[0].isPlaceholder, true);

    const item = provider.getTreeItem(roots[0]);
    assert.equal(item.label, '未配置检索目录，点击添加');
    assert.equal(item.contextValue, 'placeholder-hint');

    const placeholderChildren = await provider.getChildren(roots[0]);
    assert.deepEqual(placeholderChildren, []);
  } finally {
    cleanup(ws);
  }
});

test('已配置目录并行校验存在性、子节点目录优先排序与 filterFolders 过滤', async () => {
  const ws = makeWorkspace();
  const dirA = join(ws, 'dirA');
  const dirB = join(ws, 'dirB');
  const notExistDir = join(ws, 'not-exist');
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  mkdirSync(join(dirA, 'node_modules'), { recursive: true });
  mkdirSync(join(dirA, 'subDir'), { recursive: true });
  writeFileSync(join(dirA, 'file1.ts'), '');
  writeFileSync(join(dirA, 'file2.ts'), '');

  setConfig({
    'zeta.list.folders': [dirA, notExistDir, dirB],
    'zeta.list.filterFolders': ['node_modules'],
  });

  try {
    const provider = new ExplorerTreeViewProvider();
    const roots = await provider.getChildren();
    assert.equal(roots.length, 2);
    assert.equal(norm(roots[0].uri.fsPath), norm(dirA));
    assert.equal(norm(roots[1].uri.fsPath), norm(dirB));

    const rootItem = provider.getTreeItem(roots[0]);
    assert.ok(rootItem.contextValue.startsWith('directory-root-'));

    const children = await provider.getChildren(roots[0]);
    assert.equal(children.length, 3);
    assert.equal(norm(children[0].uri.fsPath), norm(join(dirA, 'subDir')));
    assert.equal(norm(children[1].uri.fsPath), norm(join(dirA, 'file1.ts')));
    assert.equal(norm(children[2].uri.fsPath), norm(join(dirA, 'file2.ts')));
  } finally {
    cleanup(ws);
  }
});

test('filterFolders: 包含空字符串或纯空白时不会过滤全部目录', async () => {
  const ws = makeWorkspace();
  const dirA = join(ws, 'validDir');
  mkdirSync(dirA, { recursive: true });
  writeFileSync(join(dirA, 'file.ts'), '');

  setConfig({
    'zeta.list.folders': [dirA],
    'zeta.list.filterFolders': ['', '  ', 'node_modules'],
  });

  try {
    const provider = new ExplorerTreeViewProvider();
    const roots = await provider.getChildren();
    const children = await provider.getChildren(roots[0]);
    assert.equal(children.length, 1);
    assert.equal(norm(children[0].uri.fsPath), norm(join(dirA, 'file.ts')));
  } finally {
    cleanup(ws);
  }
});

test('子节点缓存与 refresh / invalidateCaches 失效机制', async () => {
  const ws = makeWorkspace();
  const dirA = join(ws, 'cachedDir');
  mkdirSync(dirA, { recursive: true });
  writeFileSync(join(dirA, 'a.ts'), '');

  setConfig({ 'zeta.list.folders': [dirA] });
  try {
    const provider = new ExplorerTreeViewProvider();
    const roots = await provider.getChildren();
    const counter = countFs('readDirectory');

    try {
      await provider.getChildren(roots[0]);
      assert.equal(counter.count(), 1);

      await provider.getChildren(roots[0]);
      assert.equal(counter.count(), 1);

      provider.refresh();
      await provider.getChildren(roots[0]);
      assert.equal(counter.count(), 2);
    } finally {
      counter.restore();
    }
  } finally {
    cleanup(ws);
  }
});

test('folders 配置追加、去重与移除', async () => {
  const ws = makeWorkspace();
  const dirA = join(ws, 'a');
  const dirB = join(ws, 'b');
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });

  setConfig({ 'zeta.list.folders': [dirA] });
  try {
    await appendConfiguredFolders([Uri.file(dirA), Uri.file(dirB)]);
    assert.deepEqual(Configuration.FOLDERS.map(norm), [dirA, dirB].map(norm));

    await removeConfiguredFolder(Uri.file(dirA));
    assert.deepEqual(Configuration.FOLDERS.map(norm), [dirB].map(norm));
  } finally {
    cleanup(ws);
  }
});

test('appendConfiguredFolders: 单次追加包含重复项时自动去重', async () => {
  const ws = makeWorkspace();
  const dirA = join(ws, 'dupDir');
  mkdirSync(dirA, { recursive: true });

  setConfig({ 'zeta.list.folders': [] });
  try {
    await appendConfiguredFolders([Uri.file(dirA), Uri.file(dirA)]);
    assert.equal(Configuration.FOLDERS.length, 1);
    assert.equal(norm(Configuration.FOLDERS[0]), norm(dirA));
  } finally {
    cleanup(ws);
  }
});

test('handleDrop 接收拖拽 uri-list 并过滤非目录', async () => {
  const ws = makeWorkspace();
  const dir = join(ws, 'droppedDir');
  const file = join(ws, 'file.txt');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, 'test');

  setConfig({ 'zeta.list.folders': [] });
  try {
    const provider = new ExplorerTreeViewProvider();
    const dataTransfer = {
      get: () => ({
        asString: async () => `file:///${dir.replace(/\\/g, '/')}\nfile:///${file.replace(/\\/g, '/')}`,
      }),
    };

    await provider.handleDrop(undefined, dataTransfer);
    assert.deepEqual(Configuration.FOLDERS.map(norm), [dir].map(norm));
  } finally {
    cleanup(ws);
  }
});
