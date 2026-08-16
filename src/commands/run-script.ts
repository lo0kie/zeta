import { basename, dirname, findRootUri, isFile, resolveUriArgument } from '@/core/fs';
import { toNormalizePath } from '@/core/strings';
import * as vscode from 'vscode';
import { runInTerminal } from './terminal';

const MISSING_PACKAGE_JSON = '未能在当前上下文中找到 package.json 文件';

export default async function runScript(arg?: unknown): Promise<void> {
  let targetUri = resolveUriArgument(arg);

  if (!targetUri) {
    const folder =
      vscode.workspace.workspaceFolders?.length === 1
        ? vscode.workspace.workspaceFolders[0]
        : await vscode.window.showWorkspaceFolderPick();
    targetUri = folder?.uri;
  }
  if (!targetUri) return;

  if (await isFile(targetUri)) {
    // 上下文是文件：本身就是 package.json 则直接用，否则向上找最近的包根
    if (basename(targetUri) !== 'package.json') {
      const rootUri = await findRootUri(targetUri);
      if (!rootUri) {
        await vscode.window.showWarningMessage(MISSING_PACKAGE_JSON);
        return;
      }
      targetUri = vscode.Uri.joinPath(rootUri, 'package.json');
    }
  } else {
    // 上下文是目录：直接在该目录下找 package.json
    targetUri = vscode.Uri.joinPath(targetUri, 'package.json');
  }

  if (!(await isFile(targetUri))) {
    await vscode.window.showWarningMessage(MISSING_PACKAGE_JSON);
    return;
  }

  let scripts: Record<string, string> | undefined;
  try {
    const rawContent = await vscode.workspace.fs.readFile(targetUri);
    ({ scripts } = JSON.parse(new TextDecoder().decode(rawContent)) ?? {});
  } catch {
    await vscode.window.showErrorMessage('无法正确解析该 package.json 文件');
    return;
  }

  const scriptNames = Object.keys(scripts ?? {});
  if (scriptNames.length === 0) {
    await vscode.window.showWarningMessage('package.json 中未配置任何 scripts 脚本');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    scriptNames.map(label => ({ label, detail: scripts![label] })),
    { placeHolder: toNormalizePath(targetUri) }
  );
  if (!picked) return;

  const workingDir = dirname(targetUri);
  const runCmd = `npm run ${picked.label}`;

  await runInTerminal({
    cwd: workingDir,
    commands: [runCmd],
    name: `${basename(workingDir)} - ${runCmd}`,
    show: true,
    disposeSame: true,
  });
}
