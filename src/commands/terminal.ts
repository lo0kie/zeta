import { dirname, isFile } from '@/core/fs';
import * as vscode from 'vscode';

export interface RunInTerminalOptions {
  /** 终端的工作目录；若指向文件则自动取其所在目录 */
  cwd?: vscode.Uri;
  /** 依次发送并执行的命令 */
  commands?: string[];
  /** 终端名称 */
  name?: string;
  /** 创建后是否立即展示终端 */
  show?: boolean;
  /** 为 true 时先销毁同名终端再新建，保证“点一下重启”的直觉 */
  disposeSame?: boolean;
}

export async function runInTerminal({
  cwd,
  commands = [],
  name,
  show = true,
  disposeSame = false,
}: RunInTerminalOptions): Promise<vscode.Terminal> {
  let workingDir = cwd;
  if (cwd && (await isFile(cwd))) {
    workingDir = dirname(cwd);
  }

  if (disposeSame && name) {
    vscode.window.terminals.find(terminal => terminal.name === name)?.dispose();
  }

  const terminal = vscode.window.createTerminal({ cwd: workingDir, name });
  if (show) terminal.show();

  for (const command of commands) {
    terminal.sendText(command);
  }

  return terminal;
}
