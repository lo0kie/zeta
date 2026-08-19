import { defineConfig } from 'vitest/config';
import vitestConfig from './vitest.config.mts';

// 性能基准专用配置：仅运行 performance.test.ts（日常全量已排除它），
// 由 `pnpm test:perf` 调用（`vitest run -c vitest.perf.config.mts`）。
// 继承主配置的 alias / pool / maxWorkers / restoreMocks 等，仅覆盖 include/exclude。
export default defineConfig({
  ...vitestConfig,
  test: {
    ...vitestConfig.test,
    include: ['test/performance.test.ts'],
    exclude: [],
  },
});
