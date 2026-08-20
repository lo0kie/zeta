/**
 * 选中当前块：光标位于某括号块内时，只选中块的内容——开括号之后到闭合括号之前，不含块头声明与括号本身。
 * 策略：最近括号——在 ()、[]、{} 三种类型中，取「包含光标的最内层」那一对。
 * 例如 CSS `[data-...]:focus-visible { color: var(--x); }`：
 *   光标在 var(--x) 实参内 → 选圆括号内容 --x；
 *   光标在花括号块内但不在圆括号内（如分号后）→ 选花括号块内容。
 * 多光标：每个光标独立找所在块；多个光标命中同一块时去重。
 * 复用 scanStringTokens 与 maskComments 做字符串/正则/注释感知扫描，
 * 避免字符串、正则、注释里的括号干扰配对。
 */
import { TtlCache } from '@/core/ttl-cache';
import { scanStringTokens } from '@/utils/quote';
import { maskComments } from '@/utils/text';
import * as vscode from 'vscode';

// 按 document.version 缓存「掩码文本 + 字符串 token」：命令连续触发时避免每次全文重扫。
// 用 TtlCache（带容量上限），关闭文档的 key 由 onDidCloseTextDocument 清理。
// 额外记录 text 并在命中时比对：规避某些环境（如单测 shim）version 不随编辑变化导致的误命中。
const scanCache = new TtlCache<{ version: number; text: string; masked: string; tokens: [number, number][] }>(60_000);

/** 括号对定义：开→闭，以及闭→开映射 */
const OPEN = { '(': ')', '[': ']', '{': '}' } as const;
type Bracket = keyof typeof OPEN;
const CLOSE_TO_OPEN: Record<string, Bracket> = { ')': '(', ']': '[', '}': '{' };

/** 判断 offset 是否落在任一字符串 token 区间内（这些位置的括号不参与配对） */
function isInStringToken(tokens: [number, number][], offset: number): boolean {
  // tokens 已按 start 升序，用二分/线性皆可；token 数通常远小于文本长度
  let lo = 0;
  let hi = tokens.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = tokens[mid];
    if (offset < s) hi = mid - 1;
    else if (offset >= e) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * 在 openings（形如 '(', '{' 等候选开括号）里，向前找包含 cursor 的最内层未闭合开括号并向后配对。
 * 只统计候选类型：遇闭括号对应计数 +1、遇候选开括号且计数为 0 → 起点（最靠右即最内层）。
 * 返回 [开括号 offset, 闭括号 offset]；找不到返回 null。
 */
function findBlockFor(
  masked: string,
  tokens: [number, number][],
  cursor: number,
  openings: Bracket[]
): [number, number] | null {
  const openingSet = new Set<string>(openings);
  const closed: Record<string, number> = {};
  for (const o of openings) closed[o] = 0;

  let open = -1;
  for (let i = cursor - 1; i >= 0; i--) {
    if (isInStringToken(tokens, i)) continue;
    const c = masked[i];
    if (openingSet.has(c)) {
      if (closed[c] === 0) {
        open = i;
        break;
      }
      closed[c]--;
    } else if (CLOSE_TO_OPEN[c] !== undefined) {
      // 命中候选类型的闭括号：计数 +1（表示内层已闭合一个）
      const openOf = CLOSE_TO_OPEN[c];
      if (closed[openOf] !== undefined) closed[openOf]++;
    }
  }
  // 必须光标位于该类型括号内部才触发
  if (open === -1) return null;

  // 向后找与 open 配对的闭合括号：只数同类型深度，跨类型括号忽略（它们自配）。
  const openChar = masked[open] as Bracket;
  const closeChar = OPEN[openChar];
  let depth = 0;
  let close = -1;
  for (let i = open; i < masked.length; i++) {
    if (isInStringToken(tokens, i)) continue;
    const c = masked[i];
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return null;

  // 只选中块内容：起点为开括号之后、终点为闭括号之前。
  return [open + 1, close];
}

/**
 * 找到包含 cursor 的块：最近括号（()/[]/{} 三种类型中取最靠右即最内层的一对）。
 * 语义是「光标所在层级的括号块」：
 * - 光标在对象值内 → 该值所属对象块（如 scripts 值内选 scripts 对象）；
 * - 光标在键名/逗号后/顶层 → 键名所属外层对象（如 scripts 键名上选根对象，即 scripts 所在层级）。
 */
function findEnclosingBlock(masked: string, tokens: [number, number][], cursor: number): [number, number] | null {
  return findBlockFor(masked, tokens, cursor, ['(', '[', '{']);
}

export function clearSelectionBlockCache(uri: vscode.Uri): void {
  scanCache.delete(uri.toString());
}

export default function selectBlock(textEditor: vscode.TextEditor): void {
  const { document, selections } = textEditor;
  const uriKey = document.uri.toString();
  const text = document.getText();
  const cached = scanCache.get(uriKey);
  const hit = cached && cached.version === document.version && cached.text === text;
  let masked: string;
  let tokens: [number, number][];
  if (hit) {
    masked = cached.masked;
    tokens = cached.tokens;
  } else {
    // 注释等长掩码为空白，字符串原样保留；再扫描字符串 token 得到「不参与配对的区间」。
    // 注释已掩码为空白，其内不可能出现 { }，故只需跳过字符串区间即可。
    // 注意：Vue 动态属性（:class="[...]" 等）的值是 JS 表达式，其 token（isDynamicAttr）整段
    // 不应视为字符串——否则 []/{}/() 全被跳过选不了。只过滤整段动态属性 token，
    // 内部的真实字符串字面量（'is-icon-only' 等）会作为独立 STRING token 保留、继续跳过配对。
    masked = maskComments(text);
    tokens = scanStringTokens(masked)
      .filter(t => !t.isDynamicAttr)
      .map(t => [t.start, t.end] as [number, number]);
    scanCache.set(uriKey, { version: document.version, text, masked, tokens });
  }

  const seen = new Set<string>();
  const nextSelections: vscode.Selection[] = [];
  for (const selection of selections) {
    const cursor = document.offsetAt(selection.active);
    const block = findEnclosingBlock(masked, tokens, cursor);
    if (!block) {
      nextSelections.push(selection); // 不在任何块内：保持原选区不动
      continue;
    }
    const start = document.positionAt(block[0]);
    const end = document.positionAt(block[1]);
    const key = `${start.line}:${start.character}-${end.line}:${end.character}`;
    if (seen.has(key)) continue; // 多个光标命中同一块：只保留一个
    seen.add(key);
    nextSelections.push(new vscode.Selection(start, end));
  }

  textEditor.selections = nextSelections;
}
