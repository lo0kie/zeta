import { Configuration } from '@/core/configuration';
import * as vscode from 'vscode';

/**
 * 调起系统目录选择器，把选中的目录去重合并进 zeta.list.folders；
 * 写入配置后会触发 onDidChangeConfiguration，资源导航自动刷新。
 */
export default async function addFolder(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: true,
    title: '选择要加入资源导航的目录',
    openLabel: '添加检索目录',
  });
  if (!picked || picked.length === 0) return;

  const existing = Configuration.FOLDERS;
  const additions = picked.map(uri => uri.fsPath).filter(fsPath => !existing.includes(fsPath));
  if (additions.length === 0) return;

  await Configuration.set('folders', [...existing, ...additions]);
}
