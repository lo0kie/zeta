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

// 目录列表短缓存：补全每次击键都会触发 readDirectory + 排序 + 截断，
// 同一目录 2s 内缓存「排序+截断后」的结果，避免每次敲键对大目录重复 sort/slice
const DIR_LIST_CACHE_TTL_MS = 2000;
const dirListCache = new TtlCache<[string, vscode.FileType][]>(DIR_LIST_CACHE_TTL_MS);

// 单次补全候选项上限：极端大目录（构建产物/资源包数千文件）下截断，避免 LSP 通信与下拉渲染开销
const MAX_COMPLETION_ENTRIES = 200;

async function readDirectoryCached(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
  const key = uri.toString();
  const cached = dirListCache.get(key);
  if (cached) return cached;

  const entries = await vscode.workspace.fs.readDirectory(uri);
  // 目录优先排序后再截断：readDirectory 的顺序取决于文件系统遍历，
  // 不排序的话大目录里排在后部的子目录会被截断掉，用户无法进入下一级
  const sorted = [...entries].sort(
    (a, b) => (b[1] === vscode.FileType.Directory ? 1 : 0) - (a[1] === vscode.FileType.Directory ? 1 : 0)
  );
  // 极端大目录下截断候选，避免补全面板渲染与 LSP 通信开销
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

    const match = textBeforeCursor.match(
      /(?:['"`]|(?:\b(?:from|import|require)\s+)|url\(|\b(?:src|href)=['"]?)([^'"`()]+)$/
    );
    if (!match) return undefined;

    const rawPath = match[1];

    // 只有单个 . / .. / @（未键入斜杠）时放弃补全：此时替换范围会覆盖前缀本身，
    // 选中条目会把 './foo' 误写成裸说明符 'foo'、或把别名前缀 '@' 整个替换掉
    if (rawPath === '.' || rawPath === '..' || rawPath === '@') return undefined;

    // 只替换光标前的最后一段路径（最后一个 / 之后），
    // 避免 JS/TS 之外的语言按整段 word 替换导致路径重复（如 url(./img/lo → ./img/loimg/logo.png）
    const lastSlashIndex = rawPath.lastIndexOf('/');
    const replaceStart = position.translate(0, -(rawPath.length - lastSlashIndex - 1));
    const replaceRange = new vscode.Range(replaceStart, position);

    const targetDir = await this.resolveTargetDir(document, rawPath);
    if (!targetDir) return undefined;

    try {
      // 返回的已是「目录优先排序 + 截断」后的结果（readDirectoryCached 内完成并缓存）
      const safeEntries = await readDirectoryCached(targetDir);
      const items: vscode.CompletionItem[] = [];

      // 当前文件自身不出现在同级目录的补全候选中
      const browsingOwnDir = targetDir.toString() === dirname(document.uri).toString();
      const selfName = basename(document.uri);

      for (const [name, fileType] of safeEntries) {
        if (name.startsWith('.')) continue;
        if (browsingOwnDir && name === selfName) continue;

        const isDir = fileType === vscode.FileType.Directory;
        const item = new vscode.CompletionItem(
          name,
          isDir ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File
        );

        item.sortText = isDir ? `0_${name}` : `1_${name}`;
        item.range = replaceRange;
        // 目录带尾斜杠，选中后继续输入下一段能保持链式补全
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
      // 路径别名：多候选 target 并行探测存在性，取第一个存在的目录（顺序语义保持）；
      // 未命中时回落 <workspaceRoot>/src 约定
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
      const subPath = searchDir.replace(/^[~/]+/, '');
      return subPath ? vscode.Uri.joinPath(workspaceFolder.uri, subPath) : workspaceFolder.uri;
    }

    if (rawPath.startsWith('.')) {
      const currentDir = dirname(document.uri);
      // 无斜杠时（如 '..'）直接用 rawPath 本身，Uri.joinPath 会解析 '..' 回到父目录
      const relDir = searchDir || rawPath;
      return vscode.Uri.joinPath(currentDir, relDir);
    }

    return undefined;
  }
}

export function registerPathCompletion(): vscode.Disposable {
  const provider = new PathCompletionProvider();
  const selectors = PATH_EXTENSIONS.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerCompletionItemProvider(selectors, provider, ...TRIGGER_CHARS);
}
