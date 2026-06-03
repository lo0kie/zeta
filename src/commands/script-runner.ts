import { exist } from '@/utils';
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';

export default async function scriptRunner(
  cwd?: vscode.Uri,
  parameters: string[] = [],
  name?: string,
  needToShow = true,
  disposeAfterRun = false,
  disposeSame = false
) {
  let targetCwd = cwd;

  if (targetCwd && exist(targetCwd)) {
    const stat = await vscode.workspace.fs.stat(targetCwd);
    if (stat.type === vscode.FileType.File) {
      targetCwd = Utils.dirname(targetCwd);
    }
  }

  if (disposeSame && name) {
    const existingTerminal = vscode.window.terminals.find(t => t.name === name);
    existingTerminal?.dispose();
  }

  const terminal = vscode.window.createTerminal({ cwd: targetCwd, name });

  if (needToShow) {
    terminal.show();
  }

  for (const parameter of parameters) {
    terminal.sendText(parameter);
  }

  if (disposeAfterRun) {
    setTimeout(() => terminal.dispose(), 3000);
  }
}
