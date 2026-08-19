import * as vscode from 'vscode';

/**
 * 上下文键：单光标跨行选区时置 true，用于命令面板/快捷键禁用三个 case 命令。
 * 只有当「恰好一个选区」且该选区非空且跨行（start 与 end 不在同一行）时才禁用；
 * 多光标时命令仍可用，但行为层会跳过跨行的选区。
 */
export const CASE_DISABLED_CONTEXT = 'zeta.caseDisabled';

/**
 * 计算 case 命令是否应被禁用（纯函数，便于测试）。
 * - 恰好一个选区 + 非空 + 跨行 → true（命令面板/快捷键禁用）
 * - 其余情况（多选区、空光标、单行选区、无编辑器）→ false
 */
export function shouldDisableCaseCommands(selections: readonly vscode.Selection[] | undefined): boolean {
  if (!selections || selections.length !== 1) return false;
  const sel = selections[0];
  return !sel.isEmpty && sel.start.line !== sel.end.line;
}

/**
 * 注册选区上下文监听：编辑器选区/激活编辑器变化时，动态写入 zeta.caseDisabled。
 * 注册时立即计算一次初始状态，保证扩展激活后第一条命令面板输入就能看到正确禁用。
 */
export function registerSelectionContext(): vscode.Disposable {
  const update = (): void => {
    const editor = vscode.window.activeTextEditor;
    const disabled = shouldDisableCaseCommands(editor?.selections);
    void vscode.commands.executeCommand('setContext', CASE_DISABLED_CONTEXT, disabled);
  };

  update();
  // 手动组合订阅，避免依赖 vscode.Disposable.from（shim 不实现该 API）
  const selectionSub = vscode.window.onDidChangeTextEditorSelection(update);
  const activeEditorSub = vscode.window.onDidChangeActiveTextEditor(update);
  return { dispose: () => void (selectionSub.dispose(), activeEditorSub.dispose()) };
}
