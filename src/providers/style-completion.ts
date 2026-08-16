import { basename, dirname, isFile } from '@/core/fs';
import { resolveAliasCandidates } from '@/core/path-alias';
import { TtlCache } from '@/core/ttl-cache';
import * as vscode from 'vscode';

interface StyleSymbol {
  name: string;
  value: string;
  kind: 'variable' | 'mixin' | 'css-variable' | 'scss-variable' | 'scss-mixin';
  filePath: string;
  snippet?: string;
}

const STYLE_EXTENSIONS = ['less', 'css', 'scss', 'sass', 'vue'];
const STYLE_CACHE_TTL_MS = 10000;

const styleCache = new TtlCache<StyleSymbol[]>(STYLE_CACHE_TTL_MS);

// 文档级解析缓存：按 document.version 失效。同一版本内补全/悬浮/颜色的多次触发
// 只做一次「@import 扫描 + 当前文档符号解析」，导入文件的符号仍走各自的 TTL 缓存。
const DOC_CACHE_TTL_MS = 10000;
const docParseCache = new TtlCache<{ version: number; importedUris?: vscode.Uri[]; symbols?: StyleSymbol[] }>(
  DOC_CACHE_TTL_MS
);

function getDocCacheKey(uri: vscode.Uri): string {
  return uri.toString();
}

/** 文档关闭时释放文档级解析缓存 */
export function clearStyleDocCache(uri: vscode.Uri): void {
  docParseCache.delete(getDocCacheKey(uri));
}

/**
 * 导入文件保存后释放其原文与符号缓存。
 * docParseCache 的 key 是「引用方文档」（main.vue 等），不是被保存的文件自身——
 * 只删自身 key 不会命中任何条目，且引用方 version 未变时 collectImportedSymbols
 * 会提前命中旧 symbols 返回。因此这里全量清空文档级缓存（10s 短缓存，
 * 下次访问自然重建），让所有引用该文件的文档在下一次补全/悬浮时重新收集。
 */
export function clearStyleFileCache(uri: vscode.Uri): void {
  const key = uri.toString();
  fileTextCache.delete(key);
  styleCache.delete(key);
  docParseCache.clear();
}

// 在这些语言的（style）内容中启用补全；css-variable 对所有预处理语言有效，
// Less 变量与 mixin 只在 less 内容里提供
const CSS_LIKE_LANGS = new Set(['less', 'css', 'scss', 'sass', 'stylus', 'postcss']);

// 导入文件原文缓存：递归收集、符号解析与 hover 选择器扫描共用，同一文件 10s 内不重读
const FILE_TEXT_CACHE_TTL_MS = 10000;
const fileTextCache = new TtlCache<string>(FILE_TEXT_CACHE_TTL_MS);

export async function readFileTextCached(uri: vscode.Uri): Promise<string> {
  const key = uri.toString();
  const cached = fileTextCache.get(key);
  if (cached !== undefined) return cached;

  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  fileTextCache.set(key, text);
  return text;
}

/**
 * 解析样式导入路径为真实文件 uri。按候选顺序（相对/根绝对/别名多 target）
 * 依次探测存在性，最后按 .less/.css/.scss 依次补齐扩展名。
 */
export async function resolveImportUri(documentUri: vscode.Uri, importPath: string): Promise<vscode.Uri | undefined> {
  const candidates: vscode.Uri[] = [];

  if (importPath.startsWith('.')) {
    candidates.push(vscode.Uri.joinPath(dirname(documentUri), importPath));
  } else if (importPath.startsWith('/') || importPath.startsWith('~/')) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    if (!workspaceFolder) return undefined;
    candidates.push(vscode.Uri.joinPath(workspaceFolder.uri, importPath.replace(/^[~/]+/, '')));
  } else if (importPath.startsWith('@')) {
    // 别名导入：完整导入路径作为子路径来源（保留文件名），多候选 target 依次探测；
    // 未命中别名时回落 <workspaceRoot>/src 约定
    const aliasCandidates = await resolveAliasCandidates(documentUri, importPath, importPath);
    if (aliasCandidates) candidates.push(...aliasCandidates);
    if (importPath.startsWith('@/')) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
      if (workspaceFolder) candidates.push(vscode.Uri.joinPath(workspaceFolder.uri, 'src', importPath.slice(2)));
    }
  }

  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;

    // 扩展名探测并行化：同前缀文件（theme.less/css/scss）与目录索引（theme/index.less 等）
    // 一次并发检查，避免逐条串行轮询；顺序即优先级（前缀优先于索引）。
    // 额外探测 SCSS partial 约定（_theme.scss）：@use "./theme" 解析到 _theme.scss
    const base = basename(candidate);
    const extUris = [
      ...['.less', '.css', '.scss', '.sass'].map(ext => vscode.Uri.joinPath(dirname(candidate), base + ext)),
      ...['index.less', 'index.css', 'index.scss', 'index.sass'].map(indexFile => vscode.Uri.joinPath(candidate, indexFile)),
      ...['.scss', '.sass'].map(ext => vscode.Uri.joinPath(dirname(candidate), `_${base}${ext}`)),
    ];
    const results = await Promise.all(extUris.map(async uri => ({ uri, exists: await isFile(uri) })));
    const matched = results.find(r => r.exists)?.uri;
    if (matched) return matched;
  }
  return undefined;
}

/**
 * 按顶层分隔符切分参数列表：嵌套括号（rgba(...)、darken(...)）与引号字符串
 * （.btn(@label: "hello, world")、.list(@sep: ",")）内的分隔符不算。
 * Less 规范：参数含列表或多参数时推荐用分号 ; 分隔（.box(@w: 1px; @c: #000)），
 * 存在分号时优先按分号切分，否则按逗号。
 */
function splitTopLevelParams(rawParams: string): string[] {
  const separator = rawParams.includes(';') ? ';' : ',';
  const parts: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let current = '';

  for (let i = 0; i < rawParams.length; i++) {
    const char = rawParams[i];
    const prev = rawParams[i - 1];

    if ((char === '"' || char === "'") && prev !== '\\') {
      if (!inString) inString = char;
      else if (inString === char) inString = null;
    }

    if (!inString) {
      if (char === '(') depth++;
      else if (char === ')' && depth > 0) depth--;
    }

    if (char === separator && depth === 0 && !inString) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * 安全剥离样式注释：先匹配引号字面量（保留），再删块注释与单行注释。
 * 避免把 URL（url('//font.com')、'https://...'）里的 // 当单行注释抹除，导致分号丢失、变量遗漏。
 * hover 的选择器扫描也复用此函数，避免注释内的选择器被伪匹配。
 */
export function stripCommentsSafe(content: string): string {
  return content.replace(/(['"`])(?:\\.|[^\\])*?\1|\/\*[\s\S]*?\*\/|\/\/.*/g, (match, quote) =>
    quote ? match : ''
  );
}

function parseStyleContent(content: string, filePath: string, lang?: string): StyleSymbol[] {
  const symbols: StyleSymbol[] = [];
  const cleanContent = stripCommentsSafe(content);

  // 块自身 lang 优先（vue 的 <style lang="scss"> 不再误当 less）；否则按扩展名推断
  const isLess = lang ? lang === 'less' : filePath.endsWith('.less') || filePath.endsWith('.vue');
  const isScss = lang ? lang === 'scss' || lang === 'sass' : filePath.endsWith('.scss') || filePath.endsWith('.sass');

  if (isLess) {
    // Less 变量: @primary-color: #1890ff;
    const lessVarRegex = /@([a-zA-Z0-9_-]+)\s*:\s*([^;{}]+);/g;
    let match: RegExpExecArray | null;
    while ((match = lessVarRegex.exec(cleanContent)) !== null) {
      symbols.push({
        name: `@${match[1]}`,
        value: match[2].trim(),
        kind: 'variable',
        filePath,
      });
    }

    // Less Mixin：只识别带参数列表的 .name(...) { 定义，
    // 普通类选择器（.name {）不算 mixin，避免把样式类误报成可调用结构。
    // 参数用非贪婪跨行匹配：默认值含嵌套括号（rgba(...)、darken(...)）或多行参数时
    // 不会被第一个内层 ) 截断，直到遇见真正的闭合 ) 后跟 { 才停止。
    const mixinRegex = /\.([a-zA-Z0-9_-]+)\s*\(([\s\S]*?)\)\s*\{/g;
    while ((match = mixinRegex.exec(cleanContent)) !== null) {
      const name = `.${match[1]}`;
      const rawParams = match[2]?.trim() ?? '';
      // 按顶层逗号切分，嵌套括号（rgba(0,0,0,0.5) 等）内的逗号不拆散
      const paramsList = splitTopLevelParams(rawParams)
        .map((p, idx) => `\${${idx + 1}:${p.trim()}}`)
        .join(', ');
      // replaceRange 覆盖用户输入的含点号前缀（.bord），snippet 必须保留点号，
      // 否则插入结果变成无点号的函数调用（bordered(...)）而非 Less mixin 调用（.bordered(...)）
      const snippet = rawParams ? `${name}(${paramsList});` : `${name}();`;
      symbols.push({
        name,
        value: `${name}(${rawParams})`,
        kind: 'mixin',
        filePath,
        snippet,
      });
    }
  }

  if (isScss) {
    // SCSS 变量: $primary-color: #1890ff;
    const scssVarRegex = /\$([a-zA-Z0-9_-]+)\s*:\s*([^;{}]+);/g;
    let match: RegExpExecArray | null;
    while ((match = scssVarRegex.exec(cleanContent)) !== null) {
      symbols.push({
        name: `$${match[1]}`,
        value: match[2].trim(),
        kind: 'scss-variable',
        filePath,
      });
    }

    // SCSS Mixin: @mixin name($a, $b) { ... }（参数可省略、可跨行、含嵌套括号默认值）
    const scssMixinRegex = /@mixin\s+([a-zA-Z0-9_-]+)\s*(?:\(([\s\S]*?)\))?\s*\{/g;
    while ((match = scssMixinRegex.exec(cleanContent)) !== null) {
      const name = `@${match[1]}`;
      const rawParams = match[2]?.trim() ?? '';
      const paramsList = splitTopLevelParams(rawParams)
        .map((p, idx) => `\${${idx + 1}:${p.trim()}}`)
        .join(', ');
      // 插入为 @include name(...);（replaceRange 覆盖用户输入的 @name 前缀，必须保留 @）
      const snippet = rawParams ? `@include ${match[1]}(${paramsList});` : `@include ${match[1]}();`;
      symbols.push({
        name,
        value: `@mixin ${match[1]}(${rawParams})`,
        kind: 'scss-mixin',
        filePath,
        snippet,
      });
    }
  }

  // CSS 原生变量: --main-bg: #fff;
  const cssVarRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;{}]+);/g;
  let match: RegExpExecArray | null;
  while ((match = cssVarRegex.exec(cleanContent)) !== null) {
    symbols.push({
      name: `--${match[1]}`,
      value: match[2].trim(),
      kind: 'css-variable',
      filePath,
    });
  }

  return symbols;
}

/** 提取 vue SFC 中的 <style> 块（含 lang 与偏移）；非 vue 文档整体视为一个块 */
export function getStyleBlocks(
  document: vscode.TextDocument
): { content: string; start: number; end: number; lang: string }[] {
  const text = document.getText();
  if (document.languageId !== 'vue') {
    return [{ content: text, start: 0, end: text.length, lang: document.languageId }];
  }

  const blocks: { content: string; start: number; end: number; lang: string }[] = [];
  const styleRegex = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;

  while ((match = styleRegex.exec(text)) !== null) {
    const attrs = match[1];
    const content = match[2];
    const langMatch = attrs.match(/lang=['"]([^'"]+)['"]/i);
    const lang = langMatch ? langMatch[1].toLowerCase() : 'css';
    const start = match.index + (match[0].length - content.length - '</style>'.length);
    blocks.push({ content, start, end: start + content.length, lang });
  }

  return blocks;
}

/**
 * 收集文档（含 vue 的 <style src>）通过 @import 引用的样式文件，递归展开：
 * 聚合文件（index.less @import 多个子文件）的二级变量/Mixin 也能被找到。
 * 最多递归 3 层，visited 防循环引用；相对/别名路径相对各文件自身目录解析。
 * 结果按 document.version 缓存。
 */
export async function collectImportedFiles(document: vscode.TextDocument): Promise<vscode.Uri[]> {
  const key = getDocCacheKey(document.uri);
  const cached = docParseCache.get(key);
  if (cached && cached.version === document.version && cached.importedUris) return cached.importedUris;

  const resultUris: vscode.Uri[] = [];
  const visited = new Set<string>([document.uri.toString()]);
  const queue: { uri: vscode.Uri; content: string; depth: number }[] = [];

  const currentTexts =
    document.languageId === 'vue' ? getStyleBlocks(document).map(b => b.content) : [document.getText()];
  for (const text of currentTexts) {
    queue.push({ uri: document.uri, content: text, depth: 0 });
  }

  // vue 的 <style src="..."> 引用：作为文档直接依赖，同样参与后续递归
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
      try {
        queue.push({ uri: targetUri, content: await readFileTextCached(targetUri), depth: 0 });
      } catch {
        // 忽略不可读文件
      }
    }
  }

  // 覆盖 Less/CSS 的 @import 与 SCSS/Sass 的 @use/@forward（含 (reference) 选项与 url(...)）
  const importRegex = /@(?:import|use|forward)\s+(?:\([^)]*\)\s+)?(?:url\()?['"]([^'"]+)['"]\)?/g;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= 3) continue;

    // 每次针对新内容重置 lastIndex，避免跨文本残留导致 vue 多 style 块漏扫
    importRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(current.content)) !== null) {
      const targetUri = await resolveImportUri(current.uri, match[1]);
      if (!targetUri) continue;

      const uriStr = targetUri.toString();
      if (visited.has(uriStr)) continue;
      visited.add(uriStr);
      resultUris.push(targetUri);

      try {
        queue.push({ uri: targetUri, content: await readFileTextCached(targetUri), depth: current.depth + 1 });
      } catch {
        // 忽略不可读文件
      }
    }
  }

  const prev = docParseCache.get(key);
  // 只在本版本内继承另一字段的缓存；版本已变时对应字段置空，
  // 避免把旧版本的 symbols 写进新版本条目造成跨版本污染
  const isSameVersion = prev?.version !== undefined && prev.version === document.version;
  docParseCache.set(key, {
    version: document.version,
    importedUris: resultUris,
    symbols: isSameVersion ? prev.symbols : undefined,
  });
  return resultUris;
}

export async function collectImportedSymbols(document: vscode.TextDocument): Promise<StyleSymbol[]> {
  const key = getDocCacheKey(document.uri);
  const cached = docParseCache.get(key);
  if (cached && cached.version === document.version && cached.symbols) return cached.symbols;

  const importedUris = await collectImportedFiles(document);

  const allSymbols: StyleSymbol[] = [];
  const now = Date.now();
  const visited = new Set<string>();

  // 当前文档自身（含 vue 的 style 块）直接解析：正在编辑，不走缓存。
  // 传入块自身的 lang，避免 <style lang="scss"> 等块被误当 less 解析
  for (const block of getStyleBlocks(document)) {
    allSymbols.push(...parseStyleContent(block.content, document.uri.fsPath, block.lang));
  }

  for (const uri of importedUris) {
    const uriStr = uri.toString();
    if (visited.has(uriStr)) continue;
    visited.add(uriStr);

    const cachedSymbols = styleCache.get(uriStr);
    if (cachedSymbols) {
      allSymbols.push(...cachedSymbols);
      continue;
    }

    try {
      // 递归收集时已通过 readFileTextCached 加载过原文，这里直接命中缓存避免重复读盘
      const text = await readFileTextCached(uri);
      const parsed = parseStyleContent(text, uri.fsPath);
      styleCache.set(uriStr, parsed);
      allSymbols.push(...parsed);
    } catch {
      continue;
    }
  }

  const prev = docParseCache.get(key);
  // 与 collectImportedFiles 对称：版本已变时不继承旧 importedUris，避免导入列表跨版本污染
  const isSameVersion = prev?.version !== undefined && prev.version === document.version;
  docParseCache.set(key, {
    version: document.version,
    importedUris: isSameVersion ? prev.importedUris : undefined,
    symbols: allSymbols,
  });

  return allSymbols;
}

export class StyleCompletionProvider implements vscode.CompletionItemProvider {
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | undefined> {
    const offset = document.offsetAt(position);

    // vue：只有光标落在 <style> 块内才提供补全（template/script 里的 @、. 不触发）
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

    // @/ 开头的路径交给路径补全，样式补全让位
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
        if (isScssLang && sym.kind === 'scss-mixin') return true;
        return false;
      }
      if (isTriggerDot) return isLessLang && sym.kind === 'mixin';
      if (isTriggerDollar) return isScssLang && sym.kind === 'scss-variable';
      return false;
    });
    if (filteredSymbols.length === 0) return undefined;

    return filteredSymbols.map(sym => {
      const isMixin = sym.kind === 'mixin' || sym.kind === 'scss-mixin';
      const isLess = sym.kind === 'mixin' || sym.kind === 'variable';
      const lang = isLess ? 'less' : isScssLang ? 'scss' : 'css';
      const codePreview = isMixin ? `${sym.value} {\n  /* mixin */\n}` : `${sym.name}: ${sym.value};`;
      const item = new vscode.CompletionItem(
        sym.name,
        isMixin ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Variable
      );

      item.range = replaceRange;
      item.detail = basename(vscode.Uri.file(sym.filePath));
      item.documentation = new vscode.MarkdownString().appendCodeblock(codePreview, lang);

      if (isMixin && sym.snippet) {
        // 光标后已有分号（用户先输入 .btn; 再补全）时不重复追加
        const afterText = lineText.slice(position.character).trimStart();
        const snippetStr =
          afterText.startsWith(';') && sym.snippet.endsWith(';') ? sym.snippet.slice(0, -1) : sym.snippet;
        item.insertText = new vscode.SnippetString(snippetStr);
      } else {
        item.insertText = sym.name;
      }

      item.sortText = isMixin ? `0_${sym.name}` : `1_${sym.name}`;
      return item;
    });
  }
}

export function registerStyleCompletion(): vscode.Disposable {
  const provider = new StyleCompletionProvider();
  const selectors = STYLE_EXTENSIONS.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerCompletionItemProvider(selectors, provider, '@', '.', '$');
}
