/**
 * 样式补全核心：Less/SCSS/CSS 变量与 Mixin 符号表、选择器补全、@import/@use/@forward 递归展开（防循环）、文档级与文件级缓存。
 */
import { Configuration } from '@/core/configuration';
import { basename, dirname, isFile } from '@/core/fs';
import { resolveAliasCandidates } from '@/core/path-alias';
import { getCachedProbe, probeKey, setCachedProbe } from '@/core/probe-cache';
import { TtlCache } from '@/core/ttl-cache';
import { isPureColor } from '@/utils/color';
import * as vscode from 'vscode';
import { STYLE_COMPLETION_LANGS, STYLE_LANGUAGES } from './style-languages';
import { appendStyleMixinDoc, appendStyleVariableDoc } from './style-markdown';
import type { ParsedSymbol } from './style-parser';
import { clearParsedFile, getParsedFile, parseStyleFile, stripCommentsSafe } from './style-parser';

// re-export：stripCommentsSafe 原定义于此模块，保持对外导入路径兼容（测试/其他模块）
export { stripCommentsSafe };

export interface StyleSymbol {
  name: string;
  value: string;
  kind: 'variable' | 'mixin' | 'css-variable' | 'scss-variable' | 'scss-mixin';
  filePath: string;
  scope?: string;
  snippet?: string;
}

const DOC_CACHE_TTL_MS = 10000;
const docParseCache = new TtlCache<{
  version: number;
  importSignature?: string;
  importedUris?: vscode.Uri[];
  symbols?: ParsedSymbol[];
}>(DOC_CACHE_TTL_MS);

function getDocCacheKey(uri: vscode.Uri): string {
  return uri.toString();
}

/**
 * 被导入文件 uri → 依赖它的文档 uri 集合；保存被导入文件时据此精准失效导入方缓存。
 * 规模上限：长期会话中「大量文档同时打开 + 共享样式」时，条目会随打开文档数线性增长。
 * 超限时降级为整体清空——只影响失效的精确度（退化为全量重算），不影响正确性。
 */
const importersOf = new Map<string, Set<string>>();
const IMPORTERS_MAX_ENTRIES = 5000;

function recordImporter(importedKey: string, importerKey: string): void {
  if (importersOf.size >= IMPORTERS_MAX_ENTRIES) {
    // 达到容量上限：整体降级清空，避免无限累积；下次导入展开会重新构建。
    importersOf.clear();
  }
  let importers = importersOf.get(importedKey);
  if (!importers) {
    importers = new Set();
    importersOf.set(importedKey, importers);
  }
  importers.add(importerKey);
}

export function clearStyleDocCache(uri: vscode.Uri): void {
  const key = getDocCacheKey(uri);
  docParseCache.delete(key);
  styleBlocksCache.delete(uri.toString());
  // 文档关闭：从反向索引移除它作为导入方的记录，避免长期累积
  for (const [imported, importers] of importersOf) {
    if (importers.has(key)) {
      importers.delete(key);
      if (importers.size === 0) importersOf.delete(imported);
    }
  }
}

export function clearStyleFileCache(uri: vscode.Uri): void {
  const key = uri.toString();
  fileTextCache.delete(key);
  clearParsedFile(uri);
  styleBlocksCache.delete(key);

  // 精准失效：清掉直接或间接依赖本文件（导入链）的全部文档解析缓存，
  // 替代 docParseCache.clear()——大项目打开很多样式文件时避免每次保存全量重算。
  // 传递依赖也要清：B 导入 A、C 导入 B 时，C 的缓存里已合入 A 的符号。
  const affected = new Set<string>([key]);
  const queue = [key];
  while (queue.length > 0) {
    const current = queue.shift()!;
    docParseCache.delete(current);
    for (const importer of importersOf.get(current) ?? []) {
      if (!affected.has(importer)) {
        affected.add(importer);
        queue.push(importer);
      }
    }
  }
  // 受影响文档的「被导入」记录一并移除，索引不会残留失效条目
  for (const k of affected) importersOf.delete(k);
}

const CSS_LIKE_LANGS = new Set<string>(STYLE_LANGUAGES);

const AT_RULE_KEYWORDS = new Set([
  'media',
  'keyframes',
  'import',
  'use',
  'forward',
  'include',
  'mixin',
  'function',
  'if',
  'else',
  'each',
  'for',
  'while',
  'return',
  'extend',
  'charset',
  'font-face',
  'supports',
  'layer',
  'container',
  'property',
  'page',
  'namespace',
  'document',
  'viewport',
  'counter-style',
  'scope',
  'starting-style',
]);

const FILE_TEXT_CACHE_TTL_MS = 10000;
const fileTextCache = new TtlCache<string>(FILE_TEXT_CACHE_TTL_MS);

// 打开文档的 uri → TextDocument 索引：替代每次读文件时对 vscode.workspace.textDocuments 的
// 线性扫描（O(打开文档数)）。由 index.ts 在 onDidOpenTextDocument / onDidCloseTextDocument 维护；
// 未索引时回退到 textDocuments.find（防御插件间状态差异/测试环境）。
const openDocMap = new Map<string, vscode.TextDocument>();

export function trackOpenDocument(doc: vscode.TextDocument): void {
  openDocMap.set(doc.uri.toString(), doc);
}

export function untrackOpenDocument(uri: vscode.Uri): void {
  openDocMap.delete(uri.toString());
}

export async function readFileTextCached(uri: vscode.Uri): Promise<string> {
  const key = uri.toString();
  const openDoc = openDocMap.get(key) ?? vscode.workspace.textDocuments?.find(doc => doc.uri.toString() === key);
  if (openDoc) return openDoc.getText();

  const cached = fileTextCache.get(key);
  if (cached !== undefined) return cached;

  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  fileTextCache.set(key, text);
  return text;
}

export async function resolveImportUri(documentUri: vscode.Uri, importPath: string): Promise<vscode.Uri | undefined> {
  const cacheKey = probeKey(documentUri, importPath);
  const cached = getCachedProbe(cacheKey);
  if (cached) return cached.length > 0 ? cached[0] : undefined;

  const result = await resolveImportUriUncached(documentUri, importPath);
  setCachedProbe(cacheKey, result ? [result] : []);
  return result;
}

/** resolveImportUri 的裸实现（不查缓存，调用方负责缓存写入） */
async function resolveImportUriUncached(documentUri: vscode.Uri, importPath: string): Promise<vscode.Uri | undefined> {
  const candidates: vscode.Uri[] = [];

  if (importPath.startsWith('.')) {
    candidates.push(vscode.Uri.joinPath(dirname(documentUri), importPath));
  } else if (importPath.startsWith('/') || importPath.startsWith('~/')) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    if (!workspaceFolder) return undefined;
    candidates.push(vscode.Uri.joinPath(workspaceFolder.uri, importPath.replace(/^[~/]+/, '')));
  } else if (importPath.startsWith('@')) {
    const aliasCandidates = await resolveAliasCandidates(documentUri, importPath, importPath);
    if (aliasCandidates) candidates.push(...aliasCandidates);
    if (importPath.startsWith('@/')) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
      if (workspaceFolder) candidates.push(vscode.Uri.joinPath(workspaceFolder.uri, 'src', importPath.slice(2)));
    }
  } else if (!importPath.includes(':')) {
    candidates.push(vscode.Uri.joinPath(dirname(documentUri), importPath));
  }

  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;

    const base = basename(candidate);
    const extUris = [
      ...['.less', '.css', '.scss', '.sass', '.styl', '.stylus', '.pcss', '.postcss'].map(ext =>
        vscode.Uri.joinPath(dirname(candidate), base + ext)
      ),
      ...[
        'index.less',
        'index.css',
        'index.scss',
        'index.sass',
        '_index.scss',
        '_index.sass',
        'index.styl',
        'index.stylus',
        'index.pcss',
        'index.postcss',
      ].map(indexFile => vscode.Uri.joinPath(candidate, indexFile)),
      ...['.scss', '.sass'].map(ext => vscode.Uri.joinPath(dirname(candidate), `_${base}${ext}`)),
    ];
    const results = await Promise.all(extUris.map(async uri => ({ uri, exists: await isFile(uri) })));
    const matched = results.find(r => r.exists)?.uri;
    if (matched) return matched;
  }
  return undefined;
}

// getStyleBlocks 会重复全文正则扫描，同一版本只解析一次。非 vue 文件直接整文件返回，无此成本。
// 用 TtlCache（10s，与 docParseCache 一致）承载：长期会话打开大量 vue 文档时自动按 TTL/容量收敛，
// 避免普通 Map 随打开文档数无限累积（旧实现无容量上限）。
const styleBlocksCache = new TtlCache<{
  version: number;
  blocks: { content: string; start: number; end: number; lang: string }[];
}>(DOC_CACHE_TTL_MS);

export function getStyleBlocks(
  document: vscode.TextDocument
): { content: string; start: number; end: number; lang: string }[] {
  const text = document.getText();
  if (document.languageId !== 'vue') {
    return [{ content: text, start: 0, end: text.length, lang: document.languageId }];
  }

  const key = document.uri.toString();
  const cached = styleBlocksCache.get(key);
  if (cached && cached.version === document.version) return cached.blocks;

  const blocks: { content: string; start: number; end: number; lang: string }[] = [];
  const styleRegex = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;

  while ((match = styleRegex.exec(text)) !== null) {
    // 跳过被 HTML 注释包裹的 <style>（<!-- <style>...</style> --> 临时禁用场景），
    // 注释内残缺标签不应被当成真实样式块；判定方式与 tag.ts 的 <!-- --> 跳过同思路
    const commentStart = text.lastIndexOf('<!--', match.index);
    if (commentStart !== -1 && commentStart > text.lastIndexOf('-->', match.index)) continue;

    const attrs = match[1];
    const content = match[2];
    const langMatch = attrs.match(/lang=['"]([^'"]+)['"]/i);
    const lang = langMatch ? langMatch[1].toLowerCase() : 'css';
    const start = match.index + (match[0].length - content.length - '</style>'.length);
    blocks.push({ content, start, end: start + content.length, lang });
  }

  styleBlocksCache.set(key, { version: document.version, blocks });
  return blocks;
}

/**
 * 提取文档的「导入签名」：所有 @import/@use/@forward 路径 + vue <style src> 路径的有序串联。
 * 导入集合只依赖这些语句；文档内容（变量值/规则体）编辑不影响签名——
 * collectImportedFiles 据此在「import 语句没变」时复用导入链缓存，避免编辑期间每次击键重展开。
 * 签名只是缓存复用判据（误判最多导致重算，不会出错），模板字符串里恰好出现 @import 可接受。
 */
function extractImportSignature(text: string): string {
  const parts: string[] = [];
  const importRe = /@(?:import|use|forward)\s+(?:\([^)]*\)\s+)?(?:url\()?['"]([^'"]+)['"]\)?/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(text)) !== null) parts.push(m[1]);
  const srcRe = /<style\b[^>]*\bsrc=['"]([^'"]+)['"]/gi;
  while ((m = srcRe.exec(text)) !== null) parts.push(`src:${m[1]}`);
  return parts.join('\u0001');
}

export async function collectImportedFiles(document: vscode.TextDocument): Promise<vscode.Uri[]> {
  const key = getDocCacheKey(document.uri);
  const signature = extractImportSignature(document.getText());
  const cached = docParseCache.get(key);
  // 命中条件：import 语句签名相同（编辑变量值/规则体不影响导入集合，无需重展开）
  if (cached && cached.importSignature === signature && cached.importedUris) return cached.importedUris;

  const resultUris: vscode.Uri[] = [];
  const visited = new Set<string>([document.uri.toString()]);
  const queue: { uri: vscode.Uri; content: string; depth: number }[] = [];

  const currentTexts =
    document.languageId === 'vue' ? getStyleBlocks(document).map(b => b.content) : [document.getText()];
  for (const text of currentTexts) {
    queue.push({ uri: document.uri, content: text, depth: 0 });
  }

  if (document.languageId === 'vue') {
    const srcRegex = /<style\b[^>]*\bsrc=['"]([^'"]+)['"]/gi;
    let match: RegExpExecArray | null;
    while ((match = srcRegex.exec(document.getText())) !== null) {
      const targetUri = await resolveImportUri(document.uri, match[1]);
      if (!targetUri) continue;
      const uriStr = targetUri.toString();
      if (visited.has(uriStr)) continue;
      visited.add(uriStr);
      resultUris.push(targetUri);
      recordImporter(uriStr, key);
      try {
        queue.push({ uri: targetUri, content: await readFileTextCached(targetUri), depth: 0 });
      } catch {}
    }
  }

  const importRegex = /@(?:import|use|forward)\s+(?:\([^)]*\)\s+)?(?:url\()?['"]([^'"]+)['"]\)?/g;

  // 分层 BFS + 同层并行：先用索引指针出队（替代 shift()，避免 O(k²)），
  // 每层先同步扫描全部节点的 import 语句，再对该层的 resolveImportUri 探测并行化（深链冷启动不串行放大）。
  // 命中去重在「全部 resolve 完成后」统一串行判定，保证发现顺序确定、不重复入队。
  let head = 0;
  while (head < queue.length) {
    const layerEnd = queue.length;

    // 1. 同步收集本层每个节点（深度未超限）的全部 import 路径
    const pending: { nodeUri: vscode.Uri; importPath: string; depth: number }[] = [];
    for (let i = head; i < layerEnd; i++) {
      const current = queue[i];
      // 导入递归展开深度上限（zeta.style.maxImportDepth），防止过度膨胀与循环
      if (current.depth >= Configuration.STYLE_MAX_IMPORT_DEPTH) continue;

      const cleanContent = stripCommentsSafe(current.content);
      importRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(cleanContent)) !== null) {
        pending.push({ nodeUri: current.uri, importPath: match[1], depth: current.depth });
      }
    }

    // 2. 本层全部目标路径并行探测
    const resolved = await Promise.all(pending.map(p => resolveImportUri(p.nodeUri, p.importPath)));

    // 3. 串行去重入队（结果顺序确定），并并行读下一层文件内容
    const nextLayer: Promise<{ uri: vscode.Uri; content: string; depth: number }>[] = [];
    for (let i = 0; i < resolved.length; i++) {
      const targetUri = resolved[i];
      if (!targetUri) continue;
      const uriStr = targetUri.toString();
      if (visited.has(uriStr)) continue;
      visited.add(uriStr);
      resultUris.push(targetUri);
      recordImporter(uriStr, key);
      nextLayer.push(
        readFileTextCached(targetUri).then(
          content => ({ uri: targetUri, content, depth: pending[i].depth + 1 }),
          () => ({ uri: targetUri, content: '', depth: pending[i].depth + 1 })
        )
      );
    }
    const loaded = await Promise.all(nextLayer);
    for (const { uri, content, depth } of loaded) {
      if (content) queue.push({ uri, content, depth });
    }

    head = layerEnd;
  }

  const prev = docParseCache.get(key);
  const isSameVersion = prev?.version !== undefined && prev.version === document.version;
  docParseCache.set(key, {
    version: document.version,
    importSignature: signature,
    importedUris: resultUris,
    symbols: isSameVersion ? prev.symbols : undefined,
  });
  return resultUris;
}

export async function collectImportedSymbols(document: vscode.TextDocument): Promise<ParsedSymbol[]> {
  const key = getDocCacheKey(document.uri);
  const cached = docParseCache.get(key);
  if (cached && cached.version === document.version && cached.symbols) return cached.symbols;

  const importedUris = await collectImportedFiles(document);

  const allSymbols: ParsedSymbol[] = [];
  const visited = new Set<string>();

  for (const block of getStyleBlocks(document)) {
    allSymbols.push(...parseStyleFile(block.content, document.uri.fsPath, block.lang).symbols);
  }

  for (const uri of importedUris) {
    const uriStr = uri.toString();
    if (visited.has(uriStr)) continue;
    visited.add(uriStr);

    try {
      // 统一文件解析缓存（符号 + 选择器定义 + 规则块一份对象），避免与 style-index 各扫一遍
      const parsed = await getParsedFile(uri, readFileTextCached);
      allSymbols.push(...parsed.symbols);
    } catch {
      continue;
    }
  }

  const prev = docParseCache.get(key);
  const isSameVersion = prev?.version !== undefined && prev.version === document.version;
  docParseCache.set(key, {
    version: document.version,
    importedUris: isSameVersion ? prev.importedUris : undefined,
    symbols: allSymbols,
  });

  return allSymbols;
}

// 导入链「空闲预热」：样式/vue 文档打开后，在空闲期（setImmediate）后台展开一次导入链并
// 填充 docParseCache，避免用户第一次输入补全/悬浮时才冷启动（读全部导入文件 + 解析）。
// 单飞（同一时刻最多一个预热任务）+ 失败静默：预热只是加速，不阻塞、不报错。
let preheatActive = false;

export function schedulePreheat(document: vscode.TextDocument): void {
  if (preheatActive) return;
  if (!CSS_LIKE_LANGS.has(document.languageId) && document.languageId !== 'vue') return;

  preheatActive = true;
  setImmediate(async () => {
    try {
      await collectImportedSymbols(document);
    } catch {
      // 预热失败静默：文档可能是临时/损坏状态，冷启动时再试
    } finally {
      preheatActive = false;
    }
  });
}

export class StyleCompletionProvider implements vscode.CompletionItemProvider {
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | undefined> {
    const offset = document.offsetAt(position);

    let activeLang = document.languageId;
    if (document.languageId === 'vue') {
      const blocks = getStyleBlocks(document);
      const activeBlock = blocks.find(b => offset >= b.start && offset <= b.end);
      if (!activeBlock) return undefined;
      activeLang = activeBlock.lang;
    }
    if (!CSS_LIKE_LANGS.has(activeLang)) return undefined;

    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.slice(0, position.character);

    if (/(?:['"`]|from\s+|import\s+|url\(\s*)@\/[^\s'"`()]*$/.test(textBeforeCursor)) {
      return undefined;
    }

    const match = textBeforeCursor.match(/(@[a-zA-Z0-9_-]*|\.[a-zA-Z0-9_-]*|--[a-zA-Z0-9_-]*|\$[a-zA-Z0-9_-]*)$/);
    if (!match) return undefined;

    const matchedPrefix = match[1];
    const replaceRange = new vscode.Range(
      new vscode.Position(position.line, position.character - matchedPrefix.length),
      position
    );

    const symbols = await collectImportedSymbols(document);
    if (symbols.length === 0) return undefined;

    const isTriggerAt = matchedPrefix.startsWith('@');
    const isTriggerDot = matchedPrefix.startsWith('.');
    const isTriggerCssVar = matchedPrefix.startsWith('--');
    const isTriggerDollar = matchedPrefix.startsWith('$');
    const isLessLang = activeLang === 'less';
    const isScssLang = activeLang === 'scss' || activeLang === 'sass';

    const filteredSymbols = symbols.filter(sym => {
      if (isTriggerCssVar) return sym.kind === 'css-variable';
      if (isTriggerAt) {
        if (isLessLang && sym.kind === 'variable') return true;
        if (isScssLang && sym.kind === 'scss-mixin') {
          const word = matchedPrefix.slice(1).toLowerCase();
          return word.length > 0 && !AT_RULE_KEYWORDS.has(word);
        }
        return false;
      }
      if (isTriggerDot) return isLessLang && sym.kind === 'mixin';
      if (isTriggerDollar) return isScssLang && sym.kind === 'scss-variable';
      return false;
    });
    if (filteredSymbols.length === 0) return undefined;

    const grouped = new Map<string, StyleSymbol[]>();
    for (const sym of filteredSymbols) {
      const list = grouped.get(sym.name);
      if (list) list.push(sym);
      else grouped.set(sym.name, [sym]);
    }

    return Array.from(grouped.entries()).map(([name, symbols]) => {
      const first = symbols[0];
      const isMixin = first.kind === 'mixin' || first.kind === 'scss-mixin';

      // 纯色变量（值整体是色值）才标记为 Color；阴影/渐变等多段值含 rgba 片段但整体不是色，
      // 不能误判为颜色（如 --shadow-sm: 0 1px 3px rgba(...)）。
      const isColor = !isMixin && symbols.some(s => isPureColor(s.value));
      const itemKind = isMixin
        ? vscode.CompletionItemKind.Function
        : isColor
          ? vscode.CompletionItemKind.Color
          : vscode.CompletionItemKind.Variable;

      const fileNames = Array.from(new Set(symbols.map(s => basename(vscode.Uri.file(s.filePath)))));
      const item = new vscode.CompletionItem(
        {
          label: name,
          description: fileNames.join(', '),
        },
        itemKind
      );

      item.range = replaceRange;

      const doc = new vscode.MarkdownString();
      doc.supportHtml = true;
      doc.isTrusted = true;

      // 文档渲染与 hover 完全一致（共用 style-markdown）：
      // - mixin：代码块展示定义文本（scope value），语言 id 跟随来源文件
      // - 变量/CSS 变量：代码块展示定义的样子（scope name: value;）+ 纯色变量下方色块预览
      // 分组内同 name 符号同质（mixin 与变量按触发词/kind 分离），按 first.kind 精确分流。
      if (isMixin) appendStyleMixinDoc(doc, symbols);
      else appendStyleVariableDoc(doc, symbols);
      item.documentation = doc;

      if (isMixin && first.snippet) {
        const afterText = lineText.slice(position.character).trimStart();
        const snippetStr =
          afterText.startsWith(';') && first.snippet.endsWith(';') ? first.snippet.slice(0, -1) : first.snippet;
        item.insertText = new vscode.SnippetString(snippetStr);
      } else {
        item.insertText = name;
      }

      item.sortText = isMixin ? `\0_0_${name}` : `\0_1_${name}`;
      return item;
    });
  }
}

export function registerStyleCompletion(): vscode.Disposable {
  const provider = new StyleCompletionProvider();
  const selectors = STYLE_COMPLETION_LANGS.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerCompletionItemProvider(selectors, provider, '@', '.', '$', '-');
}
