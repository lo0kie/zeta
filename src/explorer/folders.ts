import { Configuration } from '@/core/configuration';
import { resolveConfiguredFolderUri } from '@/core/fs';
import * as vscode from 'vscode';

export async function appendConfiguredFolders(uris: vscode.Uri[]): Promise<void> {
  if (uris.length === 0) return;

  const existing = Configuration.FOLDERS;
  const known = new Set(existing.map(folder => resolveConfiguredFolderUri(folder)?.toString()));
  const additions = Array.from(new Set(uris.filter(uri => !known.has(uri.toString())).map(uri => uri.fsPath)));

  if (additions.length === 0) return;
  await Configuration.set('folders', [...existing, ...additions]);
}

export async function removeConfiguredFolder(uri: vscode.Uri): Promise<void> {
  const existing = Configuration.FOLDERS;
  const remaining = existing.filter(folder => resolveConfiguredFolderUri(folder)?.toString() !== uri.toString());

  if (remaining.length === existing.length) return;
  await Configuration.set('folders', remaining);
}
