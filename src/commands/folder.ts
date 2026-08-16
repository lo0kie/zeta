import { isDirectory, isFile, resolveUriArgument } from '@/core/fs';
import * as vscode from 'vscode';

export async function openFolder(arg: unknown, newWindow: boolean): Promise<void> {
  const uri = resolveUriArgument(arg);
  if (await isDirectory(uri)) {
    // 等待内置命令完成，失败时能被命令注册中心的错误包装捕获并提示
    await vscode.commands.executeCommand('vscode.openFolder', uri, newWindow);
  }
}

export async function openInDefaultBrowser(arg?: unknown): Promise<void> {
  // 无菜单上下文时（命令面板/编辑器标题栏兜底）回落到当前活动编辑器
  const uri = resolveUriArgument(arg) ?? vscode.window.activeTextEditor?.document.uri;
  if (uri && (await isFile(uri))) {
    vscode.env.openExternal(uri);
  }
}

export async function addToWorkspace(arg?: unknown): Promise<void> {
  const candidates = (Array.isArray(arg) ? arg : [arg]).map(resolveUriArgument);
  const known = new Set((vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.toString()));

  // 并发探测；已在工作区中的目录不重复添加，合法目录合并为一次 updateWorkspaceFolders 调用
  const additions = (
    await Promise.all(
      candidates.map(async candidate => {
        if (!candidate || known.has(candidate.toString())) return undefined;
        return (await isDirectory(candidate)) ? { uri: candidate } : undefined;
      })
    )
  ).filter((addition): addition is { uri: vscode.Uri } => !!addition);

  if (additions.length === 0) return;
  vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, ...additions);
}
