import * as vscode from 'vscode';

export interface MatchedTagPair {
  openTagRange: vscode.Range;
  closeTagRange: vscode.Range;
  isMultiLine: boolean;
}

/** HTML 无闭合标签白名单：不会压入配对栈，避免其后所有标签配对错位 */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

interface TagInfo {
  name: string;
  selfClosing: boolean;
  closing: boolean;
  start: number;
  end: number; // '>' 的索引
}

/**
 * 扫描 text[start]（必为 '<'）处的一个标签。
 * 属性内引号与 {…} 表达式整体跳过（JSX onClick={() => x > 5}、Vue :style="{...}" 里的
 * > 不会提前截断标签）；返回 undefined 表示此处不是标签（如 a < b 的比较符）。
 */
function scanTag(text: string, start: number): TagInfo | undefined {
  let i = start + 1;
  const closing = text[i] === '/';
  if (closing) i++;

  const nameStart = i;
  while (i < text.length && /[a-zA-Z0-9_-]/.test(text[i])) i++;
  if (i === nameStart) return undefined;
  const name = text.slice(nameStart, i);

  let braceDepth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '{') {
      braceDepth++;
      i++;
      continue;
    }
    if (c === '}') {
      if (braceDepth > 0) braceDepth--;
      i++;
      continue;
    }
    if (c === '>' && braceDepth === 0) break;
    i++;
  }
  if (i >= text.length) return undefined; // 未闭合的 '<'，忽略

  return { name, selfClosing: text[i - 1] === '/', closing, start, end: i };
}

interface RawPair {
  open: { name: string; start: number; end: number };
  close: { start: number; end: number };
}

/** 单次扫描整篇文本的全部标签配对（O(n)），供多光标/多次查询复用 */
export function scanTagPairs(text: string): RawPair[] {
  const stack: { name: string; start: number; end: number }[] = [];
  const pairs: RawPair[] = [];

  let searchFrom = 0;
  while (true) {
    const lt = text.indexOf('<', searchFrom);
    if (lt === -1) break;
    searchFrom = lt + 1;

    const tag = scanTag(text, lt);
    if (!tag) continue;
    if (tag.selfClosing || VOID_ELEMENTS.has(tag.name.toLowerCase())) continue;

    if (tag.closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name.toLowerCase() === tag.name.toLowerCase()) {
          const matchedOpen = stack[i];
          stack.splice(i, 1);
          pairs.push({ open: matchedOpen, close: { start: tag.start, end: tag.end + 1 } });
          break;
        }
      }
    } else {
      stack.push({ name: tag.name, start: tag.start, end: tag.end + 1 });
    }
  }

  return pairs;
}

/** 取包含指定偏移的最内层标签对 */
function findPairAt(pairs: RawPair[], offset: number): RawPair | undefined {
  return pairs
    .filter(p => p.open.start <= offset && p.close.end >= offset)
    .sort((a, b) => b.open.start - a.open.start || a.close.end - b.close.end)[0];
}

export function findEnclosingTags(document: vscode.TextDocument, position: vscode.Position): MatchedTagPair | undefined {
  const offset = document.offsetAt(position);
  const enclosing = findPairAt(scanTagPairs(document.getText()), offset);
  if (!enclosing) return undefined;

  const openTagRange = new vscode.Range(
    document.positionAt(enclosing.open.start),
    document.positionAt(enclosing.open.end)
  );
  const closeTagRange = new vscode.Range(
    document.positionAt(enclosing.close.start),
    document.positionAt(enclosing.close.end)
  );
  return {
    openTagRange,
    closeTagRange,
    isMultiLine: openTagRange.start.line !== closeTagRange.end.line,
  };
}

/** 单次扫描文档的全部标签对（含 range），供 unwrapTags 多选区场景复用，避免每选区整文档重扫 */
export function findAllTagPairs(document: vscode.TextDocument): MatchedTagPair[] {
  return scanTagPairs(document.getText()).map(pair => {
    const openTagRange = new vscode.Range(
      document.positionAt(pair.open.start),
      document.positionAt(pair.open.end)
    );
    const closeTagRange = new vscode.Range(
      document.positionAt(pair.close.start),
      document.positionAt(pair.close.end)
    );
    return {
      openTagRange,
      closeTagRange,
      isMultiLine: openTagRange.start.line !== closeTagRange.end.line,
    };
  });
}

/** 取包含指定偏移的最内层标签对（带 range 版本） */
export function findTagPairAt(pairs: MatchedTagPair[], document: vscode.TextDocument, offset: number): MatchedTagPair | undefined {
  return pairs
    .filter(p => document.offsetAt(p.openTagRange.start) <= offset && document.offsetAt(p.closeTagRange.end) >= offset)
    .sort((a, b) => b.openTagRange.start.compareTo(a.openTagRange.start) || a.closeTagRange.end.compareTo(b.closeTagRange.end))[0];
}
