import { basename, dirname, statSafe } from '@/core/fs';
import { resolveAliasCandidates } from '@/core/path-alias';
import { TtlCache } from '@/core/ttl-cache';
import * as vscode from 'vscode';

const PATH_EXTENSIONS = [
  'javascript',
  'typescript',
  'javascriptreact',
  'typescriptreact',
  'vue',
  'html',
  'css',
  'less',
  'scss',
  'json',
];

const TRIGGER_CHARS = ['/', '.', "'", '"', '`', '@'];

const DIR_LIST_CACHE_TTL_MS = 2000;
const dirListCache = new TtlCache<[string, vscode.FileType][]>(DIR_LIST_CACHE_TTL_MS);

const MAX_COMPLETION_ENTRIES = 200;

async function readDirectoryCached(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
  const key = uri.toString();
  const cached = dirListCache.get(key);
  if (cached) return cached;

  const entries = await vscode.workspace.fs.readDirectory(uri);
  const visibleEntries = entries.filter(([name]) => !name.startsWith('.'));
  const sorted = [...visibleEntries].sort(
    (a, b) => (b[1] === vscode.FileType.Directory ? 1 : 0) - (a[1] === vscode.FileType.Directory ? 1 : 0)
  );
  const result = sorted.length > MAX_COMPLETION_ENTRIES ? sorted.slice(0, MAX_COMPLETION_ENTRIES) : sorted;
  dirListCache.set(key, result);
  return result;
}

export class PathCompletionProvider implements vscode.CompletionItemProvider {
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | undefined> {
    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.slice(0, position.character);

    // 修改 provideCompletionItems 中的 match 正则
    const match = textBeforeCursor.match(
      // 注意末尾的 [^'"`()]*$ 替换了原来的 +$
      /(?:['"`]|(?:\b(?:from|import|require)\s+)|url\(|\b(?:src|href)=['"]?)([^'"`()]*)$/
    );
    if (!match) return undefined;

    const rawPath = match[1];

    if (rawPath === '.' || rawPath === '..' || rawPath === '@') return undefined;

    const lastSlashIndex = rawPath.lastIndexOf('/');
    const replaceStart = position.translate(0, -(rawPath.length - lastSlashIndex - 1));
    const replaceRange = new vscode.Range(replaceStart, position);

    const targetDir = await this.resolveTargetDir(document, rawPath);
    if (!targetDir) return undefined;

    try {
      const safeEntries = await readDirectoryCached(targetDir);
      const items: vscode.CompletionItem[] = [];

      const browsingOwnDir = targetDir.toString() === dirname(document.uri).toString();
      const selfName = basename(document.uri);

      for (const [name, fileType] of safeEntries) {
        if (browsingOwnDir && name === selfName) continue;

        const isDir = fileType === vscode.FileType.Directory;
        const item = new vscode.CompletionItem(
          name,
          isDir ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File
        );

        item.sortText = isDir ? `0_${name}` : `1_${name}`;
        item.range = replaceRange;
        item.insertText = isDir ? `${name}/` : name;

        if (isDir) {
          item.command = {
            command: 'editor.action.triggerSuggest',
            title: '',
          };
        }

        items.push(item);
      }

      return items;
    } catch {
      return undefined;
    }
  }

  private async resolveTargetDir(document: vscode.TextDocument, rawPath: string): Promise<vscode.Uri | undefined> {
    const lastSlashIndex = rawPath.lastIndexOf('/');
    const searchDir = lastSlashIndex !== -1 ? rawPath.slice(0, lastSlashIndex) : '';

    if (rawPath.startsWith('@')) {
      const candidates = await resolveAliasCandidates(document.uri, rawPath, searchDir);
      if (candidates) {
        const results = await Promise.all(
          candidates.map(async uri => ({ uri, isDir: (await statSafe(uri))?.type === vscode.FileType.Directory }))
        );
        const hit = results.find(r => r.isDir)?.uri;
        if (hit) return hit;
      }
      if (!rawPath.startsWith('@/')) return undefined;

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) return undefined;
      const subPath = searchDir.replace(/^@\/?/, '');
      return vscode.Uri.joinPath(workspaceFolder.uri, 'src', subPath);
    }

    if (rawPath.startsWith('/') || rawPath.startsWith('~/')) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) return undefined;
      // 浏览「最后一个 / 之前」的目录：replaceRange 只覆盖最后一段，
      // 因此 /src（无尾斜杠）补全根目录下的 src，/src/comp 补全 src 目录内以 comp 开头的条目
      const cleanPath = searchDir.replace(/^[~/]+/, '');
      return cleanPath ? vscode.Uri.joinPath(workspaceFolder.uri, cleanPath) : workspaceFolder.uri;
    }

    if (rawPath.startsWith('.')) {
      const currentDir = dirname(document.uri);
      const relDir = searchDir || rawPath;
      return vscode.Uri.joinPath(currentDir, relDir);
    }

    if (searchDir && !rawPath.startsWith('@')) {
      const currentDir = dirname(document.uri);
      return vscode.Uri.joinPath(currentDir, searchDir);
    }

    return undefined;
  }
}

export function registerPathCompletion(): vscode.Disposable {
  const provider = new PathCompletionProvider();
  const selectors = PATH_EXTENSIONS.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerCompletionItemProvider(selectors, provider, ...TRIGGER_CHARS);
}
