// 路径别名与路径补全：JSONC/baseUrl/多target/最长key/负缓存、截断/@守卫/readDir缓存/自身过滤
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, countFs, loadModule, makeDocument, makeWorkspace, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { Uri } = require(shimPath);

// provideCompletionItems 现在返回 CompletionList，统一解包成 items 数组
const unwrapItems = result => (result ? (Array.isArray(result) ? result : result.items) : []);

const { resolveAliasCandidates, getAliasContext, PathCompletionProvider } = await loadModule(`
  export { resolveAliasCandidates, getAliasContext } from './src/core/path-alias';
  export { PathCompletionProvider } from './src/providers/path-completion';
`);

const norm = p => p.replace(/[\\/]+$/, '');

test('path-alias：JSONC 注释 + baseUrl + 多 target + 最长 key', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const proj = join(ws, 'pkg');
    mkdirSync(join(proj, 'src'), { recursive: true });
    mkdirSync(join(proj, 'types'), { recursive: true });
    // JSONC：注释 + 尾随逗号 + baseUrl '.' + 多 target + 具体 key
    writeFileSync(
      join(proj, 'tsconfig.json'),
      `{
  // 注释
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*", "./types/*"],
      "@components/*": ["./components/*"],   // 尾随逗号
    },
  },
}
`
    );
    const docUri = Uri.file(join(proj, 'src', 'main.ts'));

    const cands = await resolveAliasCandidates(docUri, '@/comp', '@');
    assert.equal(cands.length, 2, '多 target 全部返回');
    assert.equal(norm(cands[0].fsPath), norm(join(proj, 'src')), '第一个 target 相对 baseUrl');
    assert.equal(norm(cands[1].fsPath), norm(join(proj, 'types')));

    const comp = await resolveAliasCandidates(docUri, '@components/ui', '@components');
    assert.equal(norm(comp[0].fsPath), norm(join(proj, 'components')), '最长 key 优先');
  } finally {
    cleanup(ws);
  }
});

test('path-alias：无配置时负缓存（不重复找 config）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const dir = join(ws, 'nested', 'deep');
    mkdirSync(dir, { recursive: true });
    const uri = Uri.file(join(dir, 'x.ts'));

    const ctx1 = await getAliasContext(uri);
    assert.equal(ctx1, undefined, '未找到配置');
    const ctx2 = await getAliasContext(uri);
    assert.equal(ctx2, undefined, '负缓存命中（不重找）');
  } finally {
    cleanup(ws);
  }
});

test('path-completion：readDirectory 缓存 + 目录优先截断', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const big = join(ws, 'big');
    mkdirSync(big, { recursive: true });
    for (let i = 0; i < 240; i++) writeFileSync(join(big, `f${String(i).padStart(3, '0')}.ts`), '');
    for (let i = 0; i < 10; i++) mkdirSync(join(big, `zdir${i}`));

    const text = `import x from './big/`;
    const provider = new PathCompletionProvider();
    const doc = makeDocument(text, join(ws, 'main.ts'), 'typescript');
    const position = {
      line: 0,
      character: text.length,
      translate: (dl, dc) => ({ line: 0, character: text.length + dc }),
    };

    const counter = countFs('readDirectory');
    try {
      const result1 = await provider.provideCompletionItems(doc, position);
      const items1 = unwrapItems(result1);
      assert.equal(counter.count(), 1, '首次读盘');
      assert.equal(items1.length, 200, '单次返回上限 200');
      assert.equal(result1.isIncomplete, true, '全量 250 超过上限，标记未加载完');
      assert.ok(
        items1.slice(0, 10).every(i => i.insertText.endsWith('/')),
        '目录优先且保留'
      );

      const result2 = await provider.provideCompletionItems(doc, position);
      const items2 = unwrapItems(result2);
      assert.equal(counter.count(), 1, '缓存命中不重读盘');
      assert.equal(items2.length, 200, '缓存全量列表后仍按上限渲染');
      assert.ok(
        items2.slice(0, 10).every(i => i.insertText.endsWith('/')),
        '缓存结果仍目录优先'
      );
    } finally {
      counter.restore();
    }
  } finally {
    cleanup(ws);
  }
});

test('path-completion：裸 @ 不触发（避免吃掉别名前缀）；@/ 正常', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const src = join(ws, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }));

    const provider = new PathCompletionProvider();
    const bare = `import x from '@`;
    const docBare = makeDocument(bare, join(src, 'main.ts'), 'typescript');
    const itemsBare = await provider.provideCompletionItems(docBare, {
      line: 0,
      character: bare.length,
      translate: (dl, dc) => ({ line: 0, character: bare.length + dc }),
    });
    assert.equal(itemsBare, undefined, '裸 @ 不触发补全');

    const slash = `import x from '@/`;
    const docSlash = makeDocument(slash, join(src, 'main.ts'), 'typescript');
    const itemsSlash = await provider.provideCompletionItems(docSlash, {
      line: 0,
      character: slash.length,
      translate: (dl, dc) => ({ line: 0, character: slash.length + dc }),
    });
    assert.ok(itemsSlash && Array.isArray(itemsSlash.items), '@/ 正常触发补全（空目录返回空 CompletionList）');
  } finally {
    cleanup(ws);
  }
});

test('path-completion：同级补全排除当前文件自身', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const dir = join(ws, 'd');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'b.ts'), '');
    const text = `import x from './`;
    const doc = makeDocument(text, join(dir, 'b.ts'), 'typescript');
    const provider = new PathCompletionProvider();
    const items = unwrapItems(
      await provider.provideCompletionItems(doc, {
        line: 0,
        character: text.length,
        translate: (dl, dc) => ({ line: 0, character: text.length + dc }),
      })
    );
    const labels = items.map(i => i.label).sort();
    assert.deepEqual(labels, ['a.ts'], 'b.ts 自身不在候选中');
  } finally {
    cleanup(ws);
  }
});

test('path-completion：裸模块名不误触发补全', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const doc = makeDocument("import lodash from 'lodash", join(ws, 'a.ts'), 'typescript');
    const provider = new PathCompletionProvider();
    const items = await provider.provideCompletionItems(doc, {
      line: 0,
      character: 26,
      translate: (l, c) => ({ line: 0, character: 26 + c }),
    });
    assert.equal(items, undefined);
  } finally {
    cleanup(ws);
  }
});

test('path-completion：/src 绝对路径无尾斜杠时补全根目录', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const srcDir = join(ws, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'app.ts'), '');

    const doc = makeDocument("import x from '/src", join(ws, 'main.ts'), 'typescript');
    const provider = new PathCompletionProvider();
    const items = await provider.provideCompletionItems(doc, {
      line: 0,
      character: 19,
      translate: (l, c) => ({ line: 0, character: 19 + c }),
    });
    assert.ok(unwrapItems(items).some(i => i.label === 'src'), '根目录下 src 在列');
    assert.ok(!unwrapItems(items).some(i => i.label === 'app.ts'), 'src 目录内容不应出现在根目录补全');
  } finally {
    cleanup(ws);
  }
});

test('path-completion：/src/ 带尾斜杠时补全 src 目录内容', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const srcDir = join(ws, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'app.ts'), '');

    const doc = makeDocument("import x from '/src/", join(ws, 'main.ts'), 'typescript');
    const provider = new PathCompletionProvider();
    const items = await provider.provideCompletionItems(doc, {
      line: 0,
      character: 20,
      translate: (l, c) => ({ line: 0, character: 20 + c }),
    });
    assert.ok(unwrapItems(items).some(i => i.label === 'app.ts'), 'src 目录内容在列');
  } finally {
    cleanup(ws);
  }
});

test('path-completion：/src/ap 中间态补全 src 目录（非 src/ap）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const srcDir = join(ws, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'app.ts'), '');

    const doc = makeDocument("import x from '/src/ap", join(ws, 'main.ts'), 'typescript');
    const provider = new PathCompletionProvider();
    const items = await provider.provideCompletionItems(doc, {
      line: 0,
      character: 21,
      translate: (l, c) => ({ line: 0, character: 21 + c }),
    });
    assert.ok(unwrapItems(items).some(i => i.label === 'app.ts'), '浏览的是 src 目录，ap 前缀可命中 app.ts');
  } finally {
    cleanup(ws);
  }
});
