import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// Vitest 测试配置：
// - alias 'vscode' → test/vscode-shim.cjs（src 与测试共用同一 shim 实例，instanceof 生效）
// - alias '@' → src（与项目 tsconfig paths 一致）
// - isolate: true：每个测试文件独立模块注册表（等价旧 node:test 每文件独立进程），
//   模块级缓存（TtlCache 等）不跨文件共享
// - environment: node：纯逻辑测试，无需 DOM
// - pool: 'forks' + maxWorkers: 8：8 个 fork 进程并行执行。
//   Vitest 4 已重写 pool 架构（移除旧 tinypool），解决了此前 Windows 下「测试跑完进程不退出」的挂起；
//   32 核实测：maxWorkers=8 连跑 3 次稳定（全量 259/259，25.6s → 9.1s）；
//   maxWorkers=16 时 performance.test.ts 基准受 CPU 竞争影响（findDefinitionRanges 31ms > 20ms 阈值），故取 8。
//   保持 isolate:true 让各文件模块注册表隔离（避免模块级缓存跨文件泄漏）。
// - 使用 .mts 扩展名：项目 package.json 无 "type":"module"，.ts 配置会被当 CJS 加载触发
//   `configLoader:'native'` 告警；.mts 明确为 ESM，规避该告警。
export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./test/vscode-shim.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    isolate: true,
    pool: 'forks',
    maxWorkers: 8,
    include: ['test/**/*.test.ts'],
    // 性能基准（performance.test.ts）默认不参与日常全量：挂钟断言在 CI/共享 runner 上有抖动风险，
    // 需要验证性能时单独运行 `pnpm test:perf`（见 vitest.perf.config.mts）
    exclude: [...configDefaults.exclude, '**/performance.test.ts'],
    testTimeout: 15000,
    // 每个测试后自动还原 vi.spyOn 打桩，避免跨测试污染（替代测试里手动 `vscode.X = origX` 还原样板）
    restoreMocks: true,
  },
});
