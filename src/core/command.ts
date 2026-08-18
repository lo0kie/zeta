/**
 * 命令注册中心：统一包装所有命令，异常捕获并提示用户。
 */
import * as vscode from 'vscode';

type CommandHandler = (...args: any[]) => unknown;
type TextEditorCommandHandler = (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => unknown;

/** 把任意异常归一成可展示的字符串（Error 取 message，其余用 String() 兜底） */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 命令注册中心：所有命令统一在这里包装，
 * 业务代码抛出的任何异常都会被捕获并反馈给用户，不再产生未处理的 Promise 拒绝。
 */
export function registerCommand(command: string, handler: CommandHandler): vscode.Disposable {
  return vscode.commands.registerCommand(command, async (...args: any[]) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error(`[zeta] 命令 ${command} 执行失败:`, error);
      vscode.window.showErrorMessage(`zeta: ${command} 执行失败 - ${toMessage(error)}`);
    }
  });
}

/** 与 registerCommand 同构的文本编辑器命令包装：异常同样统一捕获并提示用户 */
export function registerTextEditorCommand(command: string, handler: TextEditorCommandHandler): vscode.Disposable {
  return vscode.commands.registerTextEditorCommand(command, async (textEditor, edit, ...args: any[]) => {
    try {
      await handler(textEditor, edit, ...args);
    } catch (error) {
      console.error(`[zeta] 命令 ${command} 执行失败:`, error);
      vscode.window.showErrorMessage(`zeta: ${command} 执行失败 - ${toMessage(error)}`);
    }
  });
}
