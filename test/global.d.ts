/**
 * 测试侧全局钩子声明。
 * - `__lastApply` 由 vscode-shim.cjs 的 applyEdit mock 写入，测试读取它验证编辑器编辑行为。
 * - `__zetaWsRoot` / `__zetaCfg` 由 helpers 注入，被 src 运行时（经 shim）读取。
 */
export {};

import * as vscode from 'vscode';

declare global {
  // eslint-disable-next-line no-var
  var __lastApply: Array<{ range: vscode.Range; text: string }> | null | undefined;
  // eslint-disable-next-line no-var
  var __zetaWsRoot: string | undefined;
  // eslint-disable-next-line no-var
  var __zetaCfg: Record<string, unknown> | undefined;
}
