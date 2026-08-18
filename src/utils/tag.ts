/**
 * HTML/JSX 标签配对扫描：自闭合/void 元素/注释/script-style 块感知。
 */
import { escapeRegExp } from '@/core/strings';
import * as vscode from 'vscode';

export interface MatchedTagPair {
  openTagRange: vscode.Range;
  closeTagRange: vscode.Range;
  isMultiLine: boolean;
}

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
  'path',
  'rect',
  'circle',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'use',
  'stop',
  'image',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'feblend',
  'fecolormatrix',
  'fecomponenttransfer',
  'fecomposite',
  'feconvolvematrix',
  'fediffuselighting',
  'fedisplacementmap',
  'fedistantlight',
  'fedropshadow',
  'feflood',
  'fefunca',
  'fefuncb',
  'fefuncg',
  'fefuncr',
  'fegaussianblur',
  'feimage',
  'femerge',
  'femergenode',
  'femorphology',
  'feoffset',
  'fepointlight',
  'fespecularlighting',
  'fespotlight',
  'fetile',
  'feturbulence',
]);

interface TagInfo {
  name: string;
  selfClosing: boolean;
  closing: boolean;
  start: number;
  end: number;
}

function scanTag(text: string, start: number): TagInfo | undefined {
  let i = start + 1;
  const closing = text[i] === '/';
  if (closing) i++;

  const nameStart = i;
  while (i < text.length && /[a-zA-Z0-9_-]/.test(text[i])) i++;
  if (i === nameStart) return undefined;
  const name = text.slice(nameStart, i);

  let braceDepth = 0;
  let inQuote: string | null = null;
  const templateBraceDepth: number[] = [];

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuote) {
      if (c === '\\') {
        i++;
      } else if (inQuote === '`' && c === '$' && next === '{') {
        // 记录进入 ${} 时的外部括号深度，并暂时退出引号状态
        templateBraceDepth.push(braceDepth);
        inQuote = null;
      } else if (c === inQuote) {
        inQuote = null;
      }
    } else {
      if (c === '"' || c === "'" || c === '`') {
        inQuote = c;
      } else if (c === '{') {
        braceDepth++;
      } else if (c === '}') {
        if (braceDepth > 0) braceDepth--;
        // 如果当前括号深度回落到了最近一次插值 ${} 开始前的深度，说明插值结束，恢复模板字符串状态
        if (templateBraceDepth.length > 0 && braceDepth === templateBraceDepth[templateBraceDepth.length - 1]) {
          templateBraceDepth.pop();
          inQuote = '`';
        }
      } else if (c === '>' && braceDepth === 0) {
        break;
      }
    }
    i++;
  }

  if (i >= text.length) return undefined;

  let j = i - 1;
  while (j > nameStart && /\s/.test(text[j])) j--;
  const selfClosing = text[j] === '/';

  return { name, selfClosing, closing, start, end: i };
}

interface RawPair {
  open: { name: string; start: number; end: number };
  close: { start: number; end: number };
}

export function scanTagPairs(text: string): RawPair[] {
  const stack: { name: string; start: number; end: number }[] = [];
  const pairs: RawPair[] = [];

  let searchFrom = 0;
  while (true) {
    const lt = text.indexOf('<', searchFrom);
    if (lt === -1) break;

    // --- 新增：跨越 HTML 注释，防止内部残缺标签污染配对栈 ---
    if (text.startsWith('<!--', lt)) {
      const commentEnd = text.indexOf('-->', lt + 4);
      searchFrom = commentEnd !== -1 ? commentEnd + 3 : text.length;
      continue;
    }

    searchFrom = lt + 1;

    const tag = scanTag(text, lt);
    if (!tag) continue;
    if (tag.selfClosing || VOID_ELEMENTS.has(tag.name.toLowerCase())) continue;

    const lowerName = tag.name.toLowerCase();
    if (!tag.closing && (lowerName === 'script' || lowerName === 'style')) {
      const closePattern = new RegExp(`</${escapeRegExp(tag.name)}\\b[^>]*>`, 'gi');
      closePattern.lastIndex = tag.end + 1;
      const endMatch = closePattern.exec(text);
      if (endMatch) {
        pairs.push({
          open: { name: tag.name, start: tag.start, end: tag.end + 1 },
          close: { start: endMatch.index, end: endMatch.index + endMatch[0].length },
        });
        searchFrom = endMatch.index + endMatch[0].length;
        continue;
      } else {
        // 新增：遇到未闭合的 script/style 块直接中止扫描
        // 防止将脚本内部的纯文本 < 或 > 当作真实 HTML 标签解析而导致栈污染
        break;
      }
    }

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

export function findAllTagPairs(document: vscode.TextDocument): MatchedTagPair[] {
  return scanTagPairs(document.getText()).map(pair => {
    const openTagRange = new vscode.Range(document.positionAt(pair.open.start), document.positionAt(pair.open.end));
    const closeTagRange = new vscode.Range(document.positionAt(pair.close.start), document.positionAt(pair.close.end));
    return {
      openTagRange,
      closeTagRange,
      isMultiLine: openTagRange.start.line !== closeTagRange.end.line,
    };
  });
}

export function findTagPairAt(
  pairs: MatchedTagPair[],
  document: vscode.TextDocument,
  offset: number
): MatchedTagPair | undefined {
  return pairs
    .filter(p => document.offsetAt(p.openTagRange.start) <= offset && document.offsetAt(p.closeTagRange.end) >= offset)
    .sort(
      (a, b) =>
        b.openTagRange.start.compareTo(a.openTagRange.start) || a.closeTagRange.end.compareTo(b.closeTagRange.end)
    )[0];
}
