import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  minify: true,
  external: ['vscode'],
  // culori 必须打进 bundle：vsce package --no-dependencies 不打 node_modules，
  // 若留作 external 运行时 require('culori') 会失败，导致扩展激活崩溃、命令全部不可用。
  noExternal: ['culori'],
});
