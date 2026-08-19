// 性能基准断言：对纯函数做大输入时间上限断言，防止优化回归。
// 阈值取宽松上限（CI 抖动安全），主要价值是捕捉复杂度退化（如 O(n²) 回潮）。
// 默认全量测试排除本文件（vitest.config.mts 的 exclude），需要验证性能时单独运行
// `pnpm test:perf`（vitest.perf.config.mts），避免挂钟断言拖慢日常测试。
import { buildLineStarts, findDefinitionRanges, lineOf } from '@/providers/style-definition';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { cleanup, makeDocument, makeWorkspace, setConfig } from './helpers';
// resolveImportFileTargets 与 clearProbeCache 必须同 bundle：loadModule 每次打包独立，
// 模块级缓存是 bundle 内部状态，跨 bundle 的 clear 无效（针对测试验证失效路径）
import { clearProbeCache } from '@/core/probe-cache';
import { resolveImportFileTargets } from '@/providers/path-definition';

function makeBigText(lines: number, lineText: string): string {
  return Array.from({ length: lines }, () => lineText).join('\n');
}

test('buildLineStarts + lineOf：1MB 文本 100 次查询 < 5ms', () => {
  const lines = 22000; // 每行 ~46 字符 ≈ 1MB
  const lineText = '.a { color: red; padding: 4px; margin: 8px; }';
  const text = makeBigText(lines, lineText);
  assert.ok(text.length > 900_000, `文本应接近 1MB，实际 ${text.length}`);
  const starts = buildLineStarts(text);

  // 100 次二分查询
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) {
    lineOf(starts, (i * 9973) % text.length);
  }
  const dt = performance.now() - t0;
  assert.ok(dt < 20, `lineOf 100 次查询应 < 20ms，实际 ${dt.toFixed(2)}ms`);

  // 正确性抽查：末尾偏移应落在最后一行，行首偏移落在第 0 行
  assert.equal(lineOf(starts, text.length - 1), lines - 1);
  assert.equal(lineOf(starts, 0), 0);
});

test('findDefinitionRanges：1MB 文本 100 处定义 < 80ms（复杂度不再 O(n·m)）', () => {
  // 100 处 .target 定义散落在 ~2.2 万行里（每 220 行一处）
  const other = '.other { color: var(--text-body); background: var(--bg-panel); }';
  const chunk = `${other}\n`.repeat(219) + '.target { color: red; }\n';
  const text = chunk.repeat(100).slice(0, -1);
  assert.ok(text.length > 900_000, `文本应接近 1MB，实际 ${text.length}`);

  const t0 = performance.now();
  const ranges = findDefinitionRanges(text, '.target');
  const dt = performance.now() - t0;
  assert.equal(ranges.length, 100, '应找到全部 100 处定义');
  // 并发下线性实现实测 20~44ms，阈值留 2 倍余量防 flaky；O(n·m) 退化会到数百 ms 仍可捕获
  assert.ok(dt < 80, `findDefinitionRanges 应 < 80ms，实际 ${dt.toFixed(2)}ms`);
});

test('resolveImportFileTargets：TTL 缓存命中后不再重复 stat（第二次显著快于首次）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    writeFileSync(join(ws, 'foo.ts'), 'export const foo = 1;');
    const doc = makeDocument(`import foo from './foo';\n`, join(ws, 'main.ts'), 'typescript');

    // 首次：冷启动 stat 探测（记录耗时，用于相对比较）
    const t0 = performance.now();
    const first = await resolveImportFileTargets(doc, './foo');
    const firstTime = performance.now() - t0;
    assert.equal(first.length, 1);
    assert.equal(first[0].fsPath, join(ws, 'foo.ts'));

    // 第二次：命中 TTL 缓存（2s 内），应远快于首次——用「相对倍数」避免慢机/高载下的绝对阈值抖动
    const t1 = performance.now();
    const second = await resolveImportFileTargets(doc, './foo');
    const dt = performance.now() - t1;
    assert.deepEqual(second, first, '缓存结果应与首次一致');
    // 相对倍数 + 绝对保底：基准机器极快（firstTime < 5ms）时避免浮点微秒抖动
    assert.ok(
      dt < Math.max(firstTime * 0.3, 1.5),
      `缓存命中应显著快于首次（${dt.toFixed(2)}ms vs 首次 ${firstTime.toFixed(2)}ms）`
    );
    // 绝对兜底：即便首次也极快，缓存命中仍不应超过宽松上限
    assert.ok(dt < 20, `缓存命中绝对耗时兜底 < 20ms，实际 ${dt.toFixed(2)}ms`);
  } finally {
    cleanup(ws);
  }
});

test('clearProbeCache：删除文件并清缓存后，重新解析不再命中旧结果', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const file = join(ws, 'foo.ts');
    writeFileSync(file, 'export const foo = 1;');
    const doc = makeDocument(`import foo from './foo';\n`, join(ws, 'main.ts'), 'typescript');

    // 命中缓存（正缓存 + 负缓存）
    assert.equal((await resolveImportFileTargets(doc, './foo')).length, 1);
    assert.equal((await resolveImportFileTargets(doc, './missing')).length, 0);

    // 模拟 onDidDeleteFiles：清缓存后删除文件，重新解析应反映新状态
    clearProbeCache();
    rmSync(file, { force: true });
    assert.equal((await resolveImportFileTargets(doc, './foo')).length, 0, '删除后不再返回已删文件');
  } finally {
    cleanup(ws);
  }
});
