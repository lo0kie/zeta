/**
 * 统一样式文件解析器：一个文件「一次单遍扫描」产出全部结构化结果，
 * 供补全/悬浮/跳转/hover 共享，消除 parseStyleContent（变量/mixin 正则多遍）
 * 与 extractSelectorDefs（选择器段扫描）各自独立扫描同一文本的重复。
 *
 * 输出：
 * - symbols：变量/mixin 符号，**带 offset/line/lineEndOffset**（定义跳转可直接定位，
 *   不再需要 findDefinitionRanges 全文正则）；
 * - selectorDefs：类/ID 选择器定义位置（hover 与 F12 共用）；
 * - ruleBlocks：选择器规则块（惰性填充，首次 hover 某 selector 才计算）。
 *
 * 本模块零业务依赖（纯文本处理），被 style-completion 与 style-index 引用，无循环依赖。
 */
import { escapeRegExp } from '@/core/strings';
import { TtlCache } from '@/core/ttl-cache';
import { buildLineStarts, lineOf, maskComments } from '@/utils/text';
import * as vscode from 'vscode';

// ─────────────────────────────────────────────────────────────
// 文本工具（自 style-completion 迁移，保持行为不变）
// ─────────────────────────────────────────────────────────────

/** 去掉注释（保留字符串字面量）：`// ...`、`/* ... *​/` 删除，字符串原样保留 */
export function stripCommentsSafe(content: string): string {
  // 把 [^\\] 替换成了 [^\\\r\n] 并且结束条件增加了 \r?\n
  return content.replace(/(['"`])(?:\\.|[^\\\r\n])*?(?:\1|\r?\n|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/.*/g, (match, quote) =>
    quote ? match : ''
  );
}

/** 判断 text[index] 是否被反斜杠转义（与 utils/quote.ts 的 scanStringTokens 语义一致） */
function isEscapedAt(text: string, index: number): boolean {
  let backslashCount = 0;
  let j = index - 1;
  while (j >= 0 && text[j] === '\\') {
    backslashCount++;
    j--;
  }
  return backslashCount % 2 !== 0;
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
      if (!isEscapedAt(rawParams, i)) {
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

/** 按顶层分隔符拆分参数（字符串/括号内的分隔符不参与拆分） */
export function splitTopLevelParams(rawParams: string): string[] {
  const separator = findTopLevelSeparator(rawParams);
  const parts: string[] = [];
  let depth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString: string | null = null;
  let current = '';

  for (let i = 0; i < rawParams.length; i++) {
    const char = rawParams[i];

    if (char === '"' || char === "'") {
      if (!isEscapedAt(rawParams, i)) {
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

// ─────────────────────────────────────────────────────────────
// 解析结果类型
// ─────────────────────────────────────────────────────────────

export type ParsedSymbolKind = 'variable' | 'mixin' | 'css-variable' | 'scss-variable' | 'scss-mixin';

/** 符号：兼容原有 StyleSymbol 字段，额外带位置信息（offset/line/lineEndOffset）供跳转直接定位 */
export interface ParsedSymbol {
  name: string;
  value: string;
  kind: ParsedSymbolKind;
  filePath: string;
  scope?: string;
  snippet?: string;
  /** 定义名起点（文件内绝对偏移） */
  offset: number;
  /** 定义行 */
  line: number;
  /** 定义行行尾偏移（跳转光标落点，语义与 findDefinitionRanges 一致） */
  lineEndOffset: number;
  /** 定义行行尾的「行内字符位置」= lineEndOffset - lineStarts[line]，跳转零换算 */
  lineEndCharacter: number;
}

export interface ParsedStyleFile {
  /** 文件全文（规则块提取需要原文） */
  text: string;
  /** 行偏移索引（definition 跳转定位直接用，免重建） */
  lineStarts: number[];
  symbols: ParsedSymbol[];
  /** 类/ID 选择器名 → 定义位置 */
  selectorDefs: Map<string, { offset: number; length: number }[]>;
  /** 选择器名 → 规则块文本（惰性填充） */
  ruleBlocks: Map<string, string[]>;
}

// ─────────────────────────────────────────────────────────────
// 单遍扫描解析
// ─────────────────────────────────────────────────────────────

/** 从选择器文本中提取 [.#]name（逐行跳过行首 @ 的 at-rule 行），写入 defs */
function collectNamesFromSelector(
  selectorText: string,
  baseOffset: number,
  defs: Map<string, { offset: number; length: number }[]>
): void {
  let lineStartInText = 0;
  for (const line of selectorText.split('\n')) {
    if (!/^\s*@/.test(line)) {
      // 类/ID 词形：[.#] 后允许 \w（字母数字下划线）、连字符与反斜杠转义——
      // 覆盖 Tailwind 负值（.-mt-2）、BEM 修饰符（._hidden）、arbitrary value 转义（.w-\[10px\]）
      for (const mm of line.matchAll(/([.#][\w-\\]+)/g)) {
        const name = mm[1];
        const offset = baseOffset + lineStartInText + mm.index;
        let list = defs.get(name);
        if (!list) {
          list = [];
          defs.set(name, list);
        }
        list.push({ offset, length: name.length });
      }
    }
    lineStartInText += line.length + 1; // +1 是换行符
  }
}

/** 扫描标识符（[a-zA-Z0-9_-]），返回结束下标（不含） */
function scanIdent(text: string, start: number): number {
  let j = start;
  while (j < text.length && /[a-zA-Z0-9_-]/.test(text[j])) j++;
  return j;
}

/** 扫描变量值直到 ; 或 }（保护字符串），返回结束下标（指向终止符） */
function scanValueEnd(text: string, start: number): number {
  let j = start;
  let inString: string | null = null;
  while (j < text.length) {
    const c = text[j];
    if (inString) {
      if (c === '\\') j++;
      else if (c === inString) inString = null;
    } else {
      if (c === '"' || c === "'") inString = c;
      else if (c === ';' || c === '}') break;
    }
    j++;
  }
  return j;
}

/**
 * 单遍解析样式内容：变量定义（less @ / scss $ / css --）+ 类/ID 选择器定义位置
 * 一次遍历完成（字符串/注释跳过 + 作用域栈 + 选择器段累积），mixin 定义低频用独立正则。
 */
export function parseStyleFile(content: string, filePath: string, lang?: string): ParsedStyleFile {
  const symbols: ParsedSymbol[] = [];
  const selectorDefs = new Map<string, { offset: number; length: number }[]>();
  const ruleBlocks = new Map<string, string[]>();
  const lineStarts = buildLineStarts(content);
  const lineEndOf = (offset: number): number => {
    const line = lineOf(lineStarts, offset);
    let end = lineStarts[line + 1] !== undefined ? lineStarts[line + 1] - 1 : content.length;
    if (content[end - 1] === '\r') end--;
    return end;
  };
  const pushSymbol = (
    name: string,
    value: string,
    kind: ParsedSymbolKind,
    offset: number,
    extra: Partial<ParsedSymbol>
  ) => {
    const line = lineOf(lineStarts, offset);
    const lineEndOffset = lineEndOf(offset);
    symbols.push({
      name,
      value,
      kind,
      filePath,
      offset,
      line,
      lineEndOffset,
      lineEndCharacter: lineEndOffset - lineStarts[line],
      ...extra,
    });
  };

  const isLess = lang ? lang === 'less' : filePath.endsWith('.less') || filePath.endsWith('.vue');
  const isScss = lang ? lang === 'scss' || lang === 'sass' : filePath.endsWith('.scss') || filePath.endsWith('.sass');

  const n = content.length;
  const scopeStack: string[] = [];
  let currentSelector = '';
  let selectorStart = 0;
  let inString: string | null = null;
  let i = 0;

  while (i < n) {
    const c = content[i];

    if (inString) {
      if (c === '\\') i++;
      else if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      i++;
      continue;
    }
    // 注释：内容不累积进选择器段
    if (c === '/' && content[i + 1] === '/') {
      while (i < n && content[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && content[i + 1] === '*') {
      i += 2;
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    if (c === '{') {
      const selector = currentSelector.trim().replace(/\s+/g, ' ');
      if (selector) {
        const parentScope = scopeStack[scopeStack.length - 1];
        const fullScope = selector.includes('&')
          ? selector.replace(/&/g, parentScope ?? '')
          : parentScope
            ? `${parentScope} ${selector}`
            : selector;
        scopeStack.push(fullScope);
        collectNamesFromSelector(currentSelector, selectorStart, selectorDefs);
      } else {
        scopeStack.push(scopeStack[scopeStack.length - 1] ?? '');
      }
      currentSelector = '';
      selectorStart = i + 1;
      i++;
      continue;
    }

    if (c === '}') {
      if (scopeStack.length > 0) scopeStack.pop();
      currentSelector = '';
      selectorStart = i + 1;
      i++;
      continue;
    }

    if (c === ';') {
      currentSelector = '';
      selectorStart = i + 1;
      i++;
      continue;
    }

    // less 变量 @name:
    if (isLess && c === '@' && !(content[i + 1] === '@' || content[i + 1] === '{' || content[i + 1] === '}')) {
      const nameEnd = scanIdent(content, i + 1);
      if (nameEnd > i + 1) {
        let j = nameEnd;
        while (j < n && /\s/.test(content[j])) j++;
        if (content[j] === ':') {
          const valueEnd = scanValueEnd(content, j + 1);
          const value = content.slice(j + 1, valueEnd).trim();
          if (value) pushSymbol(content.slice(i, nameEnd), value, 'variable', i, {});
          i = valueEnd;
          if (content[i] === ';') i++;
          currentSelector = '';
          selectorStart = i + 1;
          continue;
        }
      }
    }

    // scss 变量 $name:
    if (isScss && c === '$') {
      const nameEnd = scanIdent(content, i + 1);
      if (nameEnd > i + 1) {
        let j = nameEnd;
        while (j < n && /\s/.test(content[j])) j++;
        if (content[j] === ':') {
          const valueEnd = scanValueEnd(content, j + 1);
          const value = content.slice(j + 1, valueEnd).trim();
          if (value) pushSymbol(content.slice(i, nameEnd), value, 'scss-variable', i, {});
          i = valueEnd;
          if (content[i] === ';') i++;
          currentSelector = '';
          selectorStart = i + 1;
          continue;
        }
      }
    }

    // css 变量 --name:（scope 取当前选择器链）
    if (c === '-' && content[i + 1] === '-') {
      const nameEnd = scanIdent(content, i + 2);
      if (nameEnd > i + 2) {
        let j = nameEnd;
        while (j < n && /\s/.test(content[j])) j++;
        if (content[j] === ':') {
          const valueEnd = scanValueEnd(content, j + 1);
          const value = content.slice(j + 1, valueEnd).trim();
          if (value) {
            pushSymbol(content.slice(i, nameEnd), value, 'css-variable', i, {
              scope: scopeStack[scopeStack.length - 1] || undefined,
            });
          }
          i = valueEnd;
          if (content[i] === ';') i++;
          currentSelector = '';
          selectorStart = i + 1;
          continue;
        }
      }
    }

    currentSelector += c;
    i++;
  }

  // mixin 定义（低频，独立正则；对「注释掩码为等长空白」的文本跑，避免字符串/注释干扰，
  // 同时保证 m.index 与原文偏移一致——不能像 stripCommentsSafe 那样删注释，否则 offset 会错位）
  if (isLess) {
    const mixinRegex = /\.([a-zA-Z0-9_-]+)\s*\(([\s\S]*?)\)\s*\{/g;
    const maskedContent = maskComments(content);
    let m: RegExpExecArray | null;
    while ((m = mixinRegex.exec(maskedContent)) !== null) {
      const name = `.${m[1]}`;
      const rawParams = m[2]?.trim() ?? '';
      const paramsList = splitTopLevelParams(rawParams)
        .map((p, idx) => `\${${idx + 1}:${p.trim()}}`)
        .join(', ');
      const snippet = rawParams ? `${name}(${paramsList});` : `${name}();`;
      pushSymbol(name, `${name}(${rawParams})`, 'mixin', m.index, { snippet });
    }
  }

  if (isScss) {
    const scssMixinRegex = /@mixin\s+([a-zA-Z0-9_-]+)\s*(?:\(([\s\S]*?)\))?\s*\{/g;
    const maskedContent = maskComments(content);
    let m: RegExpExecArray | null;
    while ((m = scssMixinRegex.exec(maskedContent)) !== null) {
      const name = `@${m[1]}`;
      const rawParams = m[2]?.trim() ?? '';
      const paramsList = splitTopLevelParams(rawParams)
        .map((p, idx) => `\${${idx + 1}:${p.trim()}}`)
        .join(', ');
      const snippet = rawParams ? `@include ${m[1]}(${paramsList});` : `@include ${m[1]}();`;
      pushSymbol(name, `@mixin ${m[1]}(${rawParams})`, 'scss-mixin', m.index, { snippet });
    }
  }

  return { text: content, lineStarts, symbols, selectorDefs, ruleBlocks };
}

/**
 * 提取样式内容里的类/ID 选择器定义位置（与 parseStyleFile 的选择器提取共用同一逻辑）。
 * 独立入口保留给测试与需要轻量提取的场景。
 */
export function extractSelectorDefs(content: string): Map<string, { offset: number; length: number }[]> {
  // 注释掩码为等长空白（而非删除）：保证 m.index 与原文偏移一致，
  // 下游用它做跳转定位（getFileIndex.selectorDefs → definition）时不会因文本变短而错行。
  const masked = maskComments(content);
  const defs = new Map<string, { offset: number; length: number }[]>();
  const blockRe = /([^{}]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(masked)) !== null) {
    collectNamesFromSelector(m[1], m.index, defs);
  }
  return defs;
}

// ─────────────────────────────────────────────────────────────
// 文件级缓存（统一：符号 + 选择器定义 + 规则块一份对象）
// ─────────────────────────────────────────────────────────────

const FILE_CACHE_TTL_MS = 10000;
const fileParseCache = new TtlCache<ParsedStyleFile>(FILE_CACHE_TTL_MS);

/** 取文件的统一解析结果（读文件 + 解析 + 缓存；文件内容变化时由调用方 clearStyleIndex 失效） */
export async function getParsedFile(
  uri: vscode.Uri,
  readText: (uri: vscode.Uri) => Promise<string>
): Promise<ParsedStyleFile> {
  const key = uri.toString();
  const cached = fileParseCache.get(key);
  if (cached) return cached;

  const text = await readText(uri);
  const parsed = parseStyleFile(text, uri.fsPath);
  parsed.text = text;
  fileParseCache.set(key, parsed);
  return parsed;
}

/** 清空文件解析缓存（保存/关闭文档时调用） */
export function clearParsedFile(uri: vscode.Uri): void {
  fileParseCache.delete(uri.toString());
}

/** 清空全部解析缓存（测试用） */
export function clearAllParsedFiles(): void {
  fileParseCache.clear();
}

/** 在样式文本中提取选择器的完整规则块（含嵌套花括号、跨行）。 */
export function findSelectorBlocks(text: string, selector: string): string[] {
  const cleanText = stripCommentsSafe(text);
  if (!cleanText.includes(selector)) return [];

  // 生成影子副本：将所有字符串内容替换为空格，避免大括号干扰
  const searchTarget = cleanText.replace(/(['"`])(?:\\.|[^\\\r\n])*?(?:\1|\r?\n|$)/g, match =>
    ' '.repeat(match.length)
  );

  const pattern = new RegExp(`${escapeRegExp(selector)}(?![\\w-])[^{}]*\\{`, 'g');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(searchTarget)) !== null) {
    let depth = 1;
    let i = pattern.lastIndex;

    while (i < searchTarget.length && depth > 0) {
      const char = searchTarget[i];
      if (char === '{') depth++;
      else if (char === '}') depth--;
      i++;
    }
    if (depth !== 0) continue;

    pattern.lastIndex = i;

    // 回退到规则起点（上一个 ; { } 之后）
    let ruleStart = match.index;
    while (ruleStart > 0 && !/[;{}]/.test(searchTarget[ruleStart - 1])) {
      ruleStart--;
    }

    const openBraceIndex = match.index + match[0].length - 1;

    const selectorHeader = cleanText.slice(ruleStart, openBraceIndex).trim();
    const rawBody = cleanText.slice(openBraceIndex + 1, i - 1);
    const bodyLines = rawBody.split('\n');
    while (bodyLines.length > 0 && !bodyLines[0].trim()) bodyLines.shift();
    while (bodyLines.length > 0 && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    if (bodyLines.length === 0) continue;

    const minIndent = bodyLines.reduce(
      (min, line) => (line.trim().length === 0 ? min : Math.min(min, line.match(/^[ \t]*/)?.[0].length ?? 0)),
      Infinity
    );
    const validMinIndent = minIndent === Infinity ? 0 : minIndent;
    const indented = bodyLines
      .map(line => (line.trim().length === 0 ? '' : `  ${line.slice(validMinIndent).trimEnd()}`))
      .join('\n');
    blocks.push(`${selectorHeader} {\n${indented}\n}`);
  }

  return blocks;
}
