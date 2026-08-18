import { extractImportString, resolveImportFileTargets } from '@/providers/path-definition';
import * as vscode from 'vscode';

/** 悬浮链接/诊断按钮共用：直接打开解析出的目标文件 */
export async function openResolvedImport(uriString: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(uriString));
}

/**
 * 诊断命令：解析光标处导入并展示结果，用于排查「为什么跳不过去」。
 * 显示解析出的候选/命中文件；无命中时提示可能的原因；命中时提供「打开」按钮。
 */
export async function debugResolveImport(textEditor: vscode.TextEditor): Promise<void> {
  const document = textEditor.document;
  const position = textEditor.selection.active;
  const lineText = document.lineAt(position.line).text;
  const found = extractImportString(position.line, lineText, position.character);

  if (!found) {
    vscode.window.showInformationMessage('zeta: 光标处未找到字符串字面量（导入路径）');
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const targets = await resolveImportFileTargets(document, found.rawPath);

  const header = `光标路径: ${found.rawPath} | 工作区: ${workspaceFolder?.uri.fsPath ?? '无'}`;
  if (targets.length === 0) {
    vscode.window.showInformationMessage(`${header} | 未解析到任何真实文件（检查 tsconfig paths 的 @/* 与文件是否在 src/ 下）`);
    return;
  }
  const list = targets.map(t => `  ${t.fsPath}`).join('\n');
  const pick = await vscode.window.showInformationMessage(
    `${header} | 解析到 ${targets.length} 个:\n${list}`,
    { modal: true },
    '打开第一个'
  );
  if (pick === '打开第一个') await openResolvedImport(targets[0].toString());
}
