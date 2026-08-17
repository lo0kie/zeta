import { basename, dirname, isFile } from '@/core/fs';
import { resolveAliasCandidates } from '@/core/path-alias';
import { TtlCache } from '@/core/ttl-cache';
import * as vscode from 'vscode';

const COLOR_VALUE_PATTERN = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/i;

function createColorSwatchUri(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="11" height="11"><rect width="12" height="12" rx="2" fill="${color}" stroke="#88888880" stroke-width="1.5"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export interface StyleSymbol {
  name: string;
  value: string;
  kind: 'variable' | 'mixin' | 'css-variable' | 'scss-variable' | 'scss-mixin';
  filePath: string;
  scope?: string;
  snippet?: string;
}

const STYLE_EXTENSIONS = ['less', 'css', 'scss', 'sass', 'stylus', 'postcss', 'vue'];
const STYLE_CACHE_TTL_MS = 10000;

const styleCache = new TtlCache<StyleSymbol[]>(STYLE_CACHE_TTL_MS);

const DOC_CACHE_TTL_MS = 10000;
const docParseCache = new TtlCache<{ version: number; importedUris?: vscode.Uri[]; symbols?: StyleSymbol[] }>(
  DOC_CACHE_TTL_MS
);

function getDocCacheKey(uri: vscode.Uri): string {
  return uri.toString();
}

export function clearStyleDocCache(uri: vscode.Uri): void {
  docParseCache.delete(getDocCacheKey(uri));
}

export function clearStyleFileCache(uri: vscode.Uri): void {
  const key = uri.toString();
  fileTextCache.delete(key);
  styleCache.delete(key);
  docParseCache.clear();
}

const CSS_LIKE_LANGS = new Set(['less', 'css', 'scss', 'sass', 'stylus', 'postcss']);

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

export async function readFileTextCached(uri: vscode.Uri): Promise<string> {
  const openDoc = vscode.workspace.textDocuments?.find(doc => doc.uri.toString() === uri.toString());
  if (openDoc) return openDoc.getText();

  const key = uri.toString();
  const cached = fileTextCache.get(key);
  if (cached !== undefined) return cached;

  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  fileTextCache.set(key, text);
  return text;
}

export async function resolveImportUri(documentUri: vscode.Uri, importPath: string): Promise<vscode.Uri | undefined> {
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

/** 扫描顶层（非字符串/非括号内）出现的第一个分隔符：优先逗号，其次分号；都没有时回落逗号 */
function findTopLevelSeparator(rawParams: string): string {
  let depth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString: string | null = null;

  for (let i = 0; i < rawParams.length; i++) {
    const char = rawParams[i];

    if (char === '"' || char === "'") {
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && rawParams[j] === '\\') {
        backslashCount++;
        j--;
      }
      if (backslashCount % 2 === 0) {
        if (!inString) inString = char;
        else if (inString === char) inString = null;
      }
    }

    if (!inString) {
      if (char === '(') depth++;
      else if (char === ')' && depth > 0) depth--;
      else if (char === '{') braceDepth++;
      else if (char === '}' && braceDepth > 0) braceDepth--;
      else if (char === '[') bracketDepth++;
      else if (char === ']' && bracketDepth > 0) bracketDepth--;
      else if (char === ',' && depth === 0 && braceDepth === 0 && bracketDepth === 0) return ',';
      else if (char === ';' && depth === 0 && braceDepth === 0 && bracketDepth === 0) return ';';
    }
  }
  return ',';
}

function splitTopLevelParams(rawParams: string): string[] {
  // 分隔符只看顶层出现：字符串/括号内的 ; 不参与判定（如 @a: "x;y", @b: 2 仍是逗号分隔）
  const separator = findTopLevelSeparator(rawParams);
  const parts: string[] = [];
  let depth = 0;
  let braceDepth = 0; // 新增
  let bracketDepth = 0; // 新增
  let inString: string | null = null;
  let current = '';

  for (let i = 0; i < rawParams.length; i++) {
    const char = rawParams[i];

    if (char === '"' || char === "'") {
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && rawParams[j] === '\\') {
        backslashCount++;
        j--;
      }
      const isEscaped = backslashCount % 2 !== 0;

      if (!isEscaped) {
        if (!inString) inString = char;
        else if (inString === char) inString = null;
      }
    }

    if (!inString) {
      if (char === '(') depth++;
      else if (char === ')' && depth > 0) depth--;
      else if (char === '{')
        braceDepth++; // 新增
      else if (char === '}' && braceDepth > 0)
        braceDepth--; // 新增
      else if (char === '[')
        bracketDepth++; // 新增
      else if (char === ']' && bracketDepth > 0) bracketDepth--; // 新增
    }

    if (char === separator && depth === 0 && braceDepth === 0 && bracketDepth === 0 && !inString) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export function stripCommentsSafe(content: string): string {
  // 把 [^\\] 替换成了 [^\\\r\n] 并且结束条件增加了 \r?\n
  return content.replace(/(['"`])(?:\\.|[^\\\r\n])*?(?:\1|\r?\n|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/.*/g, (match, quote) =>
    quote ? match : ''
  );
}

function parseNestedCssVariables(cleanContent: string, filePath: string): StyleSymbol[] {
  const symbols: StyleSymbol[] = [];
  let i = 0;
  const scopeStack: string[] = [];
  let currentSelector = '';
  let inString: string | null = null;

  while (i < cleanContent.length) {
    const char = cleanContent[i];

    if (inString) {
      if (char === '\\') i++;
      else if (char === inString) inString = null;
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = char;
      i++;
      continue;
    }

    if (char === '{') {
      const selector = currentSelector.trim().replace(/\s+/g, ' ');
      if (selector) {
        const parentScope = scopeStack[scopeStack.length - 1];
        let fullScope = selector;
        if (parentScope) {
          fullScope = selector.includes('&') ? selector.replace(/&/g, parentScope) : `${parentScope} ${selector}`;
        }
        scopeStack.push(fullScope);
      } else {
        scopeStack.push(scopeStack[scopeStack.length - 1] || '');
      }
      currentSelector = '';
      i++;
      continue;
    }

    if (char === '}') {
      if (scopeStack.length > 0) scopeStack.pop();
      currentSelector = '';
      i++;
      continue;
    }

    if (char === ';') {
      currentSelector = '';
      i++;
      continue;
    }

    // O(1) 试探：遇到 -- 才开始扫描变量
    if (char === '-' && cleanContent[i + 1] === '-') {
      let j = i + 2;
      while (j < cleanContent.length && /[a-zA-Z0-9_-]/.test(cleanContent[j])) j++;
      const varName = cleanContent.slice(i, j);

      while (j < cleanContent.length && /\s/.test(cleanContent[j])) j++;
      if (cleanContent[j] === ':') {
        j++;
        const valStart = j;
        let valString: string | null = null;
        // 安全扫描变量值直到遇到 ; 或 }，保护内部的字符串
        while (j < cleanContent.length) {
          const vc = cleanContent[j];
          if (valString) {
            if (vc === '\\') j++;
            else if (vc === valString) valString = null;
          } else {
            if (vc === '"' || vc === "'") valString = vc;
            else if (vc === ';' || vc === '}') break;
          }
          j++;
        }
        const value = cleanContent.slice(valStart, j).trim();
        if (value) {
          symbols.push({
            name: varName,
            value,
            kind: 'css-variable',
            filePath,
            scope: scopeStack[scopeStack.length - 1] || undefined,
          });
        }
        i = j;
        if (cleanContent[i] === ';') i++;
        currentSelector = '';
        continue;
      }
    }

    currentSelector += char;
    i++;
  }

  return symbols;
}

function parseStyleContent(content: string, filePath: string, lang?: string): StyleSymbol[] {
  const symbols: StyleSymbol[] = [];
  const cleanContent = stripCommentsSafe(content);

  const isLess = lang ? lang === 'less' : filePath.endsWith('.less') || filePath.endsWith('.vue');
  const isScss = lang ? lang === 'scss' || lang === 'sass' : filePath.endsWith('.scss') || filePath.endsWith('.sass');

  if (isLess) {
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

    const mixinRegex = /\.([a-zA-Z0-9_-]+)\s*\(([\s\S]*?)\)\s*\{/g;
    while ((match = mixinRegex.exec(cleanContent)) !== null) {
      const name = `.${match[1]}`;
      const rawParams = match[2]?.trim() ?? '';
      const paramsList = splitTopLevelParams(rawParams)
        .map((p, idx) => `\${${idx + 1}:${p.trim()}}`)
        .join(', ');
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

    const scssMixinRegex = /@mixin\s+([a-zA-Z0-9_-]+)\s*(?:\(([\s\S]*?)\))?\s*\{/g;
    while ((match = scssMixinRegex.exec(cleanContent)) !== null) {
      const name = `@${match[1]}`;
      const rawParams = match[2]?.trim() ?? '';
      const paramsList = splitTopLevelParams(rawParams)
        .map((p, idx) => `\${${idx + 1}:${p.trim()}}`)
        .join(', ');
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

  symbols.push(...parseNestedCssVariables(cleanContent, filePath));

  return symbols;
}

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
      } catch {}
    }
  }

  const importRegex = /@(?:import|use|forward)\s+(?:\([^)]*\)\s+)?(?:url\()?['"]([^'"]+)['"]\)?/g;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= 3) continue;

    const cleanContent = stripCommentsSafe(current.content);
    importRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(cleanContent)) !== null) {
      const targetUri = await resolveImportUri(current.uri, match[1]);
      if (!targetUri) continue;

      const uriStr = targetUri.toString();
      if (visited.has(uriStr)) continue;
      visited.add(uriStr);
      resultUris.push(targetUri);

      try {
        queue.push({ uri: targetUri, content: await readFileTextCached(targetUri), depth: current.depth + 1 });
      } catch {}
    }
  }

  const prev = docParseCache.get(key);
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
  const visited = new Set<string>();

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
      const text = await readFileTextCached(uri);
      const parsed = parseStyleContent(text, uri.fsPath);
      styleCache.set(uriStr, parsed);
      allSymbols.push(...parsed);
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

      const hasColor = symbols.some(s => COLOR_VALUE_PATTERN.test(s.value));
      const itemKind = isMixin
        ? vscode.CompletionItemKind.Function
        : hasColor
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
      item.detail = name;

      const doc = new vscode.MarkdownString();
      doc.supportHtml = true;
      doc.isTrusted = true;

      const lines = symbols.map(s => {
        const scope = s.scope ? `\`[${s.scope}]\` ` : '';
        const colorMatch = !isMixin ? s.value.match(COLOR_VALUE_PATTERN) : null;
        const valuePart = colorMatch ? `![](${createColorSwatchUri(colorMatch[0])}) \`${s.value}\`` : `\`${s.value}\``;
        return `${scope}${valuePart}`;
      });

      doc.appendMarkdown(lines.join('  \n'));
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
  const selectors = STYLE_EXTENSIONS.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerCompletionItemProvider(selectors, provider, '@', '.', '$', '-');
}
