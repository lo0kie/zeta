import { isDirectory, isFile, resolveUriArgument } from '@/core/fs';
import * as vscode from 'vscode';

/** 用 VS Code 打开目录；newWindow 为 true 时在新窗口打开，非目录直接忽略 */
export async function openFolder(arg: unknown, newWindow: boolean): Promise<void> {
  const uri = resolveUriArgument(arg);
  if (await isDirectory(uri)) {
    // 等待内置命令完成，失败时能被命令注册中心的错误包装捕获并提示
    await vscode.commands.executeCommand('vscode.openFolder', uri, newWindow);
  }
}

/** 用系统默认浏览器打开文件；无显式参数时回落到当前活动编辑器，仅对存在的文件生效 */
export async function openInDefaultBrowser(arg?: unknown): Promise<void> {
  // 无菜单上下文时（命令面板/编辑器标题栏兜底）回落到当前活动编辑器
  const uri = resolveUriArgument(arg) ?? vscode.window.activeTextEditor?.document.uri;
  if (uri && (await isFile(uri))) {
    vscode.env.openExternal(uri);
  }
}
