import { exist, findRootUri, toNormalizePath } from '@/utils';
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';
import scriptRunner from './script-runner';

export default async function packageScript(uri?: vscode.Uri) {
  const { workspaceFolders, fs } = vscode.workspace;
  let targetUri = uri;

  if (!targetUri) {
    const folder = workspaceFolders?.length === 1 ? workspaceFolders[0] : await vscode.window.showWorkspaceFolderPick();
    targetUri = folder?.uri;
  }

  if (!targetUri) return;

  const stat = await fs.stat(targetUri);

  if (stat.type === vscode.FileType.Directory) {
    targetUri = vscode.Uri.joinPath(targetUri, 'package.json');
  } else if (Utils.basename(targetUri) !== 'package.json') {
    const rootUri = findRootUri(targetUri);
    if (!rootUri) return;
    targetUri = vscode.Uri.joinPath(rootUri, 'package.json');
  }

  if (!exist(targetUri)) {
    return vscode.window.showWarningMessage('未能在当前上下文中找到 package.json 文件');
  }

  try {
    const rawContent = await fs.readFile(targetUri);
    const { scripts } = JSON.parse(new TextDecoder().decode(rawContent)) || {};

    if (!scripts || Object.keys(scripts).length === 0) {
      return vscode.window.showWarningMessage('package.json 中未配置任何 scripts 脚本');
    }

    const items: vscode.QuickPickItem[] = Object.keys(scripts).map(key => ({
      label: key,
      detail: scripts[key],
    }));

    const picked = await vscode.window.showQuickPick(items, { placeHolder: toNormalizePath(targetUri) });
    if (!picked) return;

    const workingDir = Utils.dirname(targetUri);
    const runCmd = `npm run ${picked.label}`;

    await scriptRunner(workingDir, [runCmd], `${Utils.basename(workingDir)} - ${runCmd}`, true, false, true);
  } catch {
    vscode.window.showErrorMessage('无法正确解析该 package.json 文件');
  }
}
