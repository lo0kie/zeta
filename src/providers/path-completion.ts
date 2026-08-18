import { Configuration } from '@/core/configuration';
import { basename, dirname, statSafe } from '@/core/fs';
import { resolveAliasCandidates } from '@/core/path-alias';
import { TtlCache } from '@/core/ttl-cache';
import * as vscode from 'vscode';

// 参与路径补全的语言
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

// 触发字符：斜杠/点（继续补全）+ 引号/@（新起补全）
const TRIGGER_CHARS = ['/', '.', "'", '"', '`', '@'];

// 目录列表 2s 缓存（目录内容在输入过程中基本不变，避免每次击键读盘）
const DIR_LIST_CACHE_TTL_MS = 2000;
const dirListCache = new TtlCache<[string, vscode.FileType][]>(DIR_LIST_CACHE_TTL_MS);

/** 读目录并缓存**完整**排序列表（隐藏文件按配置过滤）：不再截断，由调用方按输入前缀内存过滤 + 单次返回上限 */
async function readDirectoryCached(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
  const key = uri.toString();
  const cached = dirListCache.get(key);
  if (cached) return cached;

  const showHidden = Configuration.PATH_SHOW_HIDDEN;
  const entries = await vscode.workspace.fs.readDirectory(uri);
  const visibleEntries = entries.filter(([name]) => showHidden || !name.startsWith('.'));
  const sorted = [...visibleEntries].sort(
    (a, b) => (b[1] === vscode.FileType.Directory ? 1 : 0) - (a[1] === vscode.FileType.Directory ? 1 : 0)
  );
  dirListCache.set(key, sorted);
  return sorted;
}

/** 文件/目录路径补全：import/require/src=/href=/url(...) 等场景 */
export class PathCompletionProvider implements vscode.CompletionItemProvider {
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionList | undefined> {
    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.slice(0, position.character);

    const match = textBeforeCursor.match(
      /(?:['"`]|(?:\b(?:from|import|require)\s+)|url\(|\b(?:src|href)=['"]?)([^'"`()]*)$/
    );
    if (!match) return undefined;

    const rawPath = match[1];

    // 单独输入 ./ .. @ 时不补全（避免覆盖前缀自身）
    if (rawPath === '.' || rawPath === '..' || rawPath === '@') return undefined;

    // 前缀过滤：只看「最后一个 / 之后」的输入片段，大小写不敏感
    const lastSlashIndex = rawPath.lastIndexOf('/');
    const searchPrefix = lastSlashIndex !== -1 ? rawPath.slice(lastSlashIndex + 1).toLowerCase() : rawPath.toLowerCase();
    const replaceStart = position.translate(0, -(rawPath.length - lastSlashIndex - 1));
    const replaceRange = new vscode.Range(replaceStart, position);

    const targetDir = await this.resolveTargetDir(document, rawPath);
    if (!targetDir) return undefined;

    try {
      const safeEntries = await readDirectoryCached(targetDir);
      const maxEntries = Configuration.PATH_MAX_ENTRIES;
      const items: vscode.CompletionItem[] = [];

      const browsingOwnDir = targetDir.toString() === dirname(document.uri).toString();
      const selfName = basename(document.uri);

      let matchedCount = 0;
      for (const [name, fileType] of safeEntries) {
        if (browsingOwnDir && name === selfName) continue;
        // 内存级前缀过滤：大目录里只保留可能匹配的项，避免丢失排在 200 之后的候选
        if (searchPrefix && !name.toLowerCase().startsWith(searchPrefix)) continue;

        matchedCount++;
        // 单次返回上限：超出部分不渲染，用 isIncomplete 告知 VS Code 继续按需加载
        if (items.length >= maxEntries) continue;

        const isDir = fileType === vscode.FileType.Directory;
        const item = new vscode.CompletionItem(
          name,
          isDir ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File
        );

        item.sortText = isDir ? `0_${name}` : `1_${name}`;
        item.range = replaceRange;
        item.insertText = isDir ? `${name}/` : name;

        // 选中目录后继续触发补全，形成逐级浏览
        if (isDir) {
          item.command = {
            command: 'editor.action.triggerSuggest',
            title: '',
          };
        }

        items.push(item);
      }

      return new vscode.CompletionList(items, matchedCount > items.length);
    } catch {
      return undefined;
    }
  }

  /** 按路径规则确定要浏览的目录：别名 / 绝对 / ~ / 相对 / 省略 ./ 的子路径 */
  private async resolveTargetDir(document: vscode.TextDocument, rawPath: string): Promise<vscode.Uri | undefined> {
    const lastSlashIndex = rawPath.lastIndexOf('/');
    const searchDir = lastSlashIndex !== -1 ? rawPath.slice(0, lastSlashIndex) : '';

    // @ 别名：tsconfig paths 多候选按「存在且为目录」回退；无别名配置时走 src 兜底
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

    // 绝对 / 与 ~/：浏览「最后一个 / 之前」的目录，无子路径时回到工作区根
    if (rawPath.startsWith('/') || rawPath.startsWith('~/')) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) return undefined;
      // 浏览「最后一个 / 之前」的目录：replaceRange 只覆盖最后一段，
      // 因此 /src（无尾斜杠）补全根目录下的 src，/src/comp 补全 src 目录内以 comp 开头的条目
      const cleanPath = searchDir.replace(/^[~/]+/, '');
      return cleanPath ? vscode.Uri.joinPath(workspaceFolder.uri, cleanPath) : workspaceFolder.uri;
    }

    // 相对路径：基于当前文件目录
    if (rawPath.startsWith('.')) {
      const currentDir = dirname(document.uri);
      const relDir = searchDir || rawPath;
      return vscode.Uri.joinPath(currentDir, relDir);
    }

    // 省略 ./ 的相对子路径（src/utils/foo）：有目录前缀才补全，裸包名不触发
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
