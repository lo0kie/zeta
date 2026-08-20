import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  minify: true,
  external: ['vscode'],
  // culori / jsonc-parser 必须打进 bundle：vsce package --no-dependencies 不打 node_modules，
  // 若留作 external 运行时 require() 会失败，导致扩展激活崩溃、相关命令全部不可用。
  noExternal: ['culori', 'jsonc-parser'],
});
