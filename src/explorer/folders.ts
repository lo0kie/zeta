import { Configuration } from '@/core/configuration';
import { resolveConfiguredFolderUri } from '@/core/fs';
import * as vscode from 'vscode';

/** 把目录去重后追加进 zeta.list.folders；写入后配置事件会自动刷新视图 */
export async function appendConfiguredFolders(uris: vscode.Uri[]): Promise<void> {
  if (uris.length === 0) return;

  const existing = Configuration.FOLDERS;
  const known = new Set(existing.map(folder => resolveConfiguredFolderUri(folder).toString()));
  const additions = uris.filter(uri => !known.has(uri.toString())).map(uri => uri.fsPath);

  if (additions.length === 0) return;
  await Configuration.set('folders', [...existing, ...additions]);
}

/** 从 zeta.list.folders 中移除解析结果与指定 uri 相同的目录 */
export async function removeConfiguredFolder(uri: vscode.Uri): Promise<void> {
  const existing = Configuration.FOLDERS;
  const remaining = existing.filter(folder => resolveConfiguredFolderUri(folder).toString() !== uri.toString());

  if (remaining.length === existing.length) return;
  await Configuration.set('folders', remaining);
}
