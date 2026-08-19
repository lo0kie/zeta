// 路径别名与路径补全：JSONC/baseUrl/多target/最长key/负缓存、截断/@守卫/readDir缓存/自身过滤
import { getAliasContext, resolveAliasCandidates } from '@/core/path-alias';
import { PathCompletionProvider } from '@/providers/path-completion';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, vi } from 'vitest';
import { FileType, Position, Uri, workspace } from 'vscode';
import { cleanup, makeDocument, makeWorkspace, norm, setConfig, unwrapItems } from './helpers';

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

    const cands = (await resolveAliasCandidates(docUri, '@/comp', '@'))!;
    assert.equal(cands.length, 2, '多 target 全部返回');
    assert.equal(norm(cands[0].fsPath), norm(join(proj, 'src')), '第一个 target 相对 baseUrl');
    assert.equal(norm(cands[1].fsPath), norm(join(proj, 'types')));

    const comp = (await resolveAliasCandidates(docUri, '@components/ui', '@components'))!;
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
    const text = `import x from './big/`;
    const provider = new PathCompletionProvider();
    const doc = makeDocument(text, join(ws, 'main.ts'), 'typescript');
    const position = new Position(0, text.length);

    // 构造 10 个虚拟目录 + 240 个虚拟文件
    const mockEntries: [string, FileType][] = [
      ...Array.from({ length: 10 }, (_, i) => [`zdir${i}`, FileType.Directory] as [string, FileType]),
      ...Array.from(
        { length: 240 },
        (_, i) => [`f${String(i).padStart(3, '0')}.ts`, FileType.File] as [string, FileType]
      ),
    ];

    let readCount = 0;
    vi.spyOn(workspace.fs, 'readDirectory').mockImplementation(async () => {
      readCount++;
      return mockEntries;
    });

    // 首次请求：触发 readDirectory 并截断到 200 条
    const result1 = await provider.provideCompletionItems(doc, position);
    const items1 = unwrapItems(result1);
    assert.equal(readCount, 1, '首次读盘');
    assert.equal(items1.length, 200, '单次返回上限 200');
    assert.ok(result1, '返回 CompletionList');
    assert.equal(result1.isIncomplete, true, '全量 250 超过上限，标记未加载完');
    assert.ok(
      items1.slice(0, 10).every(i => (i.insertText as string).endsWith('/')),
      '目录优先且保留'
    );

    // 第二次请求：命中 TTL 缓存，不再调用 readDirectory
    const result2 = await provider.provideCompletionItems(doc, position);
    const items2 = unwrapItems(result2);
    assert.equal(readCount, 1, '缓存命中不重读盘');
    assert.equal(items2.length, 200, '缓存全量列表后仍按上限渲染');
    assert.ok(
      items2.slice(0, 10).every(i => (i.insertText as string).endsWith('/')),
      '缓存结果仍目录优先'
    );
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
    const itemsBare = await provider.provideCompletionItems(docBare, new Position(0, bare.length));
    assert.equal(itemsBare, undefined, '裸 @ 不触发补全');

    const slash = `import x from '@/`;
    const docSlash = makeDocument(slash, join(src, 'main.ts'), 'typescript');
    const itemsSlash = await provider.provideCompletionItems(docSlash, new Position(0, slash.length));
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
    const items = unwrapItems(await provider.provideCompletionItems(doc, new Position(0, text.length)));
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
    const items = await provider.provideCompletionItems(doc, new Position(0, 26));
    assert.equal(items, undefined);
  } finally {
    cleanup(ws);
  }
});

test('path-completion：连续输入的绝对路径不同阶段边界探测', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const srcDir = join(ws, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'app.ts'), '');

    const provider = new PathCompletionProvider();

    // 阶段 1：无尾斜杠 "/src" -> 补全根目录（src 目录内容不应上浮）
    const doc1 = makeDocument("import x from '/src", join(ws, 'main.ts'), 'typescript');
    const items1 = unwrapItems(await provider.provideCompletionItems(doc1, new Position(0, 19)));
    assert.ok(
      items1.some(i => i.label === 'src'),
      '根目录下 src 在列'
    );
    assert.ok(!items1.some(i => i.label === 'app.ts'), 'src 目录内容不应出现在根目录补全');

    // 阶段 2：带尾斜杠 "/src/" -> 补全 src 内部
    const doc2 = makeDocument("import x from '/src/", join(ws, 'main.ts'), 'typescript');
    const items2 = unwrapItems(await provider.provideCompletionItems(doc2, new Position(0, 20)));
    assert.ok(
      items2.some(i => i.label === 'app.ts'),
      'src 目录内容在列'
    );

    // 阶段 3：中间态 "/src/ap" -> 前缀过滤（浏览 src 目录而非 src/ap 子目录）
    const doc3 = makeDocument("import x from '/src/ap", join(ws, 'main.ts'), 'typescript');
    const items3 = unwrapItems(await provider.provideCompletionItems(doc3, new Position(0, 21)));
    assert.ok(
      items3.some(i => i.label === 'app.ts'),
      'ap 前缀可命中 app.ts'
    );
  } finally {
    cleanup(ws);
  }
});

test('path-completion：showHiddenFiles 切换后目录缓存不中毒（指纹纳入缓存键）', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.path.showHiddenFiles': false });
  try {
    mkdirSync(join(ws, 'dir'), { recursive: true });
    writeFileSync(join(ws, 'dir', '.env.ts'), '');
    writeFileSync(join(ws, 'dir', 'app.ts'), '');

    const doc = makeDocument("import x from './dir/", join(ws, 'main.ts'), 'typescript');
    const provider = new PathCompletionProvider();
    const pos = new Position(0, 21);

    const first = unwrapItems(await provider.provideCompletionItems(doc, pos));
    assert.ok(!first.some(i => i.label === '.env.ts'), '默认隐藏文件不出现');

    // TTL 窗口内切换配置：修复前缓存键只有 uri，会返回旧的过滤结果（缓存中毒）
    setConfig({ 'zeta.path.showHiddenFiles': true });
    const second = unwrapItems(await provider.provideCompletionItems(doc, pos));
    assert.ok(
      second.some(i => i.label === '.env.ts'),
      '开启显示隐藏后立即生效（缓存不中毒）'
    );
  } finally {
    cleanup(ws);
  }
});
