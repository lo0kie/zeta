/**
 * 引号相关纯函数：字符串 token 扫描（注释/正则/模板感知）、引号三态循环、拼接链转模板字符串、属性引号处理。
 */
export const QUOTE_ORDER = ["'", '"', '`'] as const;

export interface StringToken {
  start: number;
  end: number;
  quote: string;
  isAttrQuote?: boolean;
  /** Vue 动态属性（:class/:style/@click 等）：值为 JS 表达式，内部的括号（[]/{}/( )）仍需配对 */
  isDynamicAttr?: boolean;
  isObjectKey?: boolean;
  enclosingQuote?: string;
}

/**
 * 启发式判断 text[index] 处的 / 是否开启正则字面量（而非除法）。
 *
 * 原理：回看 / 前一个有效字符——前是字母/数字/右括号多为除法，前是操作符
 * 或行首多为正则；唯一例外是 return、typeof 等关键字（关键字后是正则）。
 *
 * 已知限制（人工构造的关键字表兜底，无法穷举）：
 * - TSX 泛型 `<T>` 后紧跟 `/`、复杂三元表达式里的 `/` 等场景可能误判；
 * - 误判只会影响 scanStringTokens 之后的字符串 token 提取（引号循环/颜色装饰
 *   可能跳过一段），不改变文本内容，属可接受的已知偏差。
 */
function looksLikeRegexStart(text: string, index: number): boolean {
  let j = index - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (j < 0) return true;
  const prevChar = text[j];

  // 如果前面是字母、数字或右括号，通常是除法（如 a / 2, 1 / 2, (a) / 2）
  if (/[a-zA-Z0-9_$)\]}]/.test(prevChar)) {
    let k = j;
    while (k >= 0 && /[a-zA-Z0-9_$]/.test(text[k])) k--;
    const word = text.slice(k + 1, j + 1);
    // 但如果前面的单词是关键字，则是正则（如 return /a/, typeof /a/）
    if (word) {
      const keywordsBeforeRegex = new Set([
        'return',
        'typeof',
        'instanceof',
        'in',
        'of',
        'new',
        'delete',
        'void',
        'throw',
        'case',
        'do',
        'else',
        'yield',
        'await',
      ]);
      return keywordsBeforeRegex.has(word);
    }
    // 前面是 ) ] }，确认是除法
    return false;
  }
  // 如果前面是其他操作符（如 = ( , : ? + - * < > 等），则是正则
  return true;
}

function isObjectPropertyKey(text: string, start: number, end: number): boolean {
  let k = end;
  while (k < text.length && /\s/.test(text[k])) k++;
  if (k >= text.length || text[k] !== ':' || text[k + 1] === ':') {
    return false;
  }

  let j = start - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (j < 0) return false;

  const prevChar = text[j];
  return prevChar === '{' || prevChar === ',';
}

function getAttrNameBeforeEqual(text: string, quoteIndex: number): string | null {
  let j = quoteIndex - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (j < 0 || text[j] !== '=') return null;
  j--;
  while (j >= 0 && /\s/.test(text[j])) j--;
  const endName = j + 1;
  while (j >= 0 && /[a-zA-Z0-9_.:\-#@]/.test(text[j])) j--;
  const attrName = text.slice(j + 1, endName);

  if (j >= 0 && (text[j] === '=' || text[j] === '!' || text[j] === '<' || text[j] === '>')) return null;
  if (/^(const|let|var|return|case)$/.test(attrName)) return null;

  return attrName.length > 0 ? attrName : null;
}

function isVueDynamicAttr(attrName: string): boolean {
  return attrName.startsWith(':') || attrName.startsWith('@') || attrName.startsWith('v-') || attrName.startsWith('#');
}

/**
 * 命中与选区相交的字符串 token：
 * - 空选区（selStart === selEnd）：取「包含光标的最小 token」（嵌套时选最内层）；
 * - 非空选区：取「与选区相交」的 token（token 含选区，或选区含 token）；
 * - 多个命中时按区间长度升序取最小者。
 * 可选 filter 仅保留满足条件的 token（如 t.quote === '`'）。
 */
export function findTokenAt(
  tokens: StringToken[],
  selStart: number,
  selEnd: number,
  isEmpty: boolean,
  filter?: (t: StringToken) => boolean
): StringToken | undefined {
  return tokens
    .filter(
      t =>
        (!filter || filter(t)) &&
        (isEmpty
          ? t.start <= selStart && t.end >= selEnd
          : (t.start <= selStart && t.end >= selEnd) || (selStart <= t.start && selEnd >= t.end))
    )
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
}

export function getNextQuote(
  currentQuote: string,
  enclosingQuote?: string,
  isAttrQuote?: boolean,
  isObjectKey?: boolean
): string {
  if (isAttrQuote) {
    return currentQuote === '"' ? "'" : '"';
  }

  let order: readonly string[] = QUOTE_ORDER;
  if (isObjectKey) {
    order = ["'", '"'];
  }
  if (enclosingQuote && (enclosingQuote === '"' || enclosingQuote === "'")) {
    order = order.filter(q => q !== enclosingQuote);
  }

  if (order.length === 0) {
    return currentQuote;
  }

  const currentIndex = order.indexOf(currentQuote as (typeof QUOTE_ORDER)[number]);
  if (currentIndex === -1) return order[0];
  return order[(currentIndex + 1) % order.length];
}

export function scanStringTokens(text: string): StringToken[] {
  const tokens: StringToken[] = [];
  let i = 0;
  const len = text.length;
  let inTag = false;

  type Mode = 'CODE' | 'STRING' | 'TEMPLATE' | 'VUE_ATTR';
  interface State {
    mode: Mode;
    quote?: string;
    start?: number;
    braceDepth?: number;
    attrQuote?: string;
    isAttrQuote?: boolean;
  }
  const stack: State[] = [{ mode: 'CODE' }];

  function currentEnclosingQuote(): string | undefined {
    for (let s = stack.length - 1; s >= 0; s--) {
      if (stack[s].mode === 'VUE_ATTR') {
        return stack[s].attrQuote;
      }
    }
    return undefined;
  }

  while (i < len) {
    const current = stack[stack.length - 1];
    const char = text[i];
    const next = text[i + 1];

    if (current.mode === 'CODE' || current.mode === 'VUE_ATTR') {
      if (char === '<' && text.slice(i, i + 4) === '<!--') {
        i += 4;
        while (i < len && text.slice(i, i + 3) !== '-->') i++;
        i += 3;
        continue;
      }
      if (char === '<' && /[a-zA-Z/]/.test(next) && current.mode === 'CODE') {
        let j = i - 1;
        while (j >= 0 && /\s/.test(text[j])) j--;
        const prevChar = j >= 0 ? text[j] : '';
        // 排除前一个字符为合法标识符（如 Array<T>）或右括号（如 (a) < b）
        // 真实标签前通常是空白、等号、大括号、标签闭合 > 或换行
        if (!/[a-zA-Z0-9_$)\]]/.test(prevChar)) {
          inTag = true;
        }
      }
      if (char === '>' && inTag && current.mode === 'CODE') {
        inTag = false;
      }

      if (char === '/' && next === '/') {
        i += 2;
        while (i < len && text[i] !== '\n') i++;
        continue;
      }
      if (char === '/' && next === '*') {
        i += 2;
        while (i < len && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      if (char === '/' && next !== '/' && next !== '*' && looksLikeRegexStart(text, i)) {
        i++;
        let inClass = false;
        while (i < len) {
          const c = text[i];
          if (c === '\\') {
            i += 2;
            continue;
          }
          if (c === '[') {
            inClass = true;
            i++;
            continue;
          }
          if (c === ']') {
            inClass = false;
            i++;
            continue;
          }
          if (c === '/' && !inClass) {
            i++;
            break;
          }
          if (c === '\n') break;
          i++;
        }
        while (i < len && /[a-zA-Z]/.test(text[i])) i++;
        continue;
      }

      if (current.mode === 'VUE_ATTR' && char === current.attrQuote && (current.braceDepth ?? 0) === 0) {
        tokens.push({
          start: current.start!,
          end: i + 1,
          quote: current.attrQuote!,
          isAttrQuote: true,
          isDynamicAttr: true,
        });
        stack.pop();
        i++;
        continue;
      }

      if (current.mode === 'CODE' && inTag && (char === '"' || char === "'")) {
        const attrName = getAttrNameBeforeEqual(text, i);
        if (attrName && isVueDynamicAttr(attrName)) {
          stack.push({ mode: 'VUE_ATTR', attrQuote: char, braceDepth: 0, start: i });
          i++;
          continue;
        }
        stack.push({ mode: 'STRING', quote: char, start: i, isAttrQuote: true });
        i++;
        continue;
      }

      if (char === "'" || char === '"') {
        stack.push({ mode: 'STRING', quote: char, start: i, isAttrQuote: false });
        i++;
        continue;
      }
      if (char === '`') {
        stack.push({ mode: 'TEMPLATE', quote: '`', start: i });
        i++;
        continue;
      }
      if (char === '{') {
        if (current.braceDepth !== undefined) current.braceDepth++;
        i++;
        continue;
      }
      if (char === '}') {
        if (current.braceDepth !== undefined) {
          if (current.braceDepth === 0 && current.mode === 'CODE') {
            stack.pop();
            i++;
            continue;
          }
          if (current.braceDepth > 0) {
            current.braceDepth--;
          }
        }
        i++;
        continue;
      }
      i++;
    } else if (current.mode === 'STRING') {
      // 转义判定走「边扫边跳过」（\ 直接跳 2 字符）；与 style-completion.ts 的 isEscapedAt
      // （向前数连续反斜杠判断是否转义）是同一问题的两种等价实现，行为应保持一致，改动需同步验证
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === current.quote) {
        const isObjKey = isObjectPropertyKey(text, current.start!, i + 1);
        tokens.push({
          start: current.start!,
          end: i + 1,
          quote: current.quote!,
          isAttrQuote: current.isAttrQuote,
          isObjectKey: isObjKey,
          enclosingQuote: currentEnclosingQuote(),
        });
        stack.pop();
        i++;
        continue;
      }
      i++;
    } else if (current.mode === 'TEMPLATE') {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === '`') {
        const isObjKey = isObjectPropertyKey(text, current.start!, i + 1);
        tokens.push({
          start: current.start!,
          end: i + 1,
          quote: '`',
          isAttrQuote: false,
          isObjectKey: isObjKey,
          enclosingQuote: currentEnclosingQuote(),
        });
        stack.pop();
        i++;
        continue;
      }
      if (char === '$' && next === '{') {
        stack.push({ mode: 'CODE', braceDepth: 0 });
        i += 2;
        continue;
      }
      i++;
    }
  }
  return tokens;
}

export function splitTemplateSegments(rawText: string): { type: 'str' | 'expr'; value: string }[] {
  const content = rawText.slice(1, -1);
  const segments: { type: 'str' | 'expr'; value: string }[] = [];
  let i = 0;
  let strBuffer = '';
  while (i < content.length) {
    if (content[i] === '\\') {
      strBuffer += content[i] + (content[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (content[i] === '$' && content[i + 1] === '{') {
      if (strBuffer.length > 0) {
        segments.push({ type: 'str', value: strBuffer });
        strBuffer = '';
      }
      i += 2;
      let exprBuffer = '';
      let braceDepth = 1;
      let inSubQuote: string | null = null;

      while (i < content.length && braceDepth > 0) {
        const c = content[i];

        // 新增：跳过单行注释
        if (!inSubQuote && c === '/' && content[i + 1] === '/') {
          exprBuffer += '//';
          i += 2;
          while (i < content.length && content[i] !== '\n') exprBuffer += content[i++];
          continue;
        }
        // 新增：跳过块注释
        if (!inSubQuote && c === '/' && content[i + 1] === '*') {
          exprBuffer += '/*';
          i += 2;
          while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) exprBuffer += content[i++];
          exprBuffer += '*/';
          i += 2;
          continue;
        }

        if (inSubQuote) {
          if (c === '\\') {
            exprBuffer += c + (content[i + 1] ?? '');
            i += 2;
            continue;
          }
          if (c === inSubQuote) inSubQuote = null;
          exprBuffer += c;
          i++;
          continue;
        }

        if (c === '"' || c === "'" || c === '`') {
          inSubQuote = c;
          exprBuffer += c;
          i++;
          continue;
        }

        if (c === '{') braceDepth++;
        else if (c === '}') braceDepth--;
        if (braceDepth > 0) exprBuffer += c;
        i++;
      }
      segments.push({ type: 'expr', value: exprBuffer.trim() });
      continue;
    }
    strBuffer += content[i];
    i++;
  }
  if (strBuffer.length > 0) {
    segments.push({ type: 'str', value: strBuffer });
  }
  return segments;
}

function escapeStringContent(content: string, fromQuote: string, toQuote: string): string {
  let result = '';
  let i = 0;
  while (i < content.length) {
    const char = content[i];
    if (toQuote === '`' && char === '$' && content[i + 1] === '{' && fromQuote !== '`') {
      result += '\\$';
      i++;
      continue;
    }
    if (char === '\\') {
      const next = content[i + 1];
      if (next === fromQuote && next !== toQuote) {
        result += next;
      } else {
        result += '\\' + (next ?? '');
      }
      i += 2;
      continue;
    }
    if (char === '\r' && content[i + 1] === '\n') {
      if (toQuote !== '`') {
        result += '\\n';
        i += 2;
        continue;
      }
    }
    if (char === '\n') {
      if (toQuote !== '`') {
        result += '\\n';
        i++;
        continue;
      }
    }
    if (char === toQuote) {
      result += '\\' + char;
      i++;
      continue;
    }
    result += char;
    i++;
  }
  return result;
}

const CHAIN_TERM_SRC = String.raw`(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\`(?:[^\`\\]|\\.)*\`|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|\d+(?:\.\d+)?)`;

const CONCAT_CHAIN_REGEXP = new RegExp(`${CHAIN_TERM_SRC}(?:\\s*\\+\\s*${CHAIN_TERM_SRC})+`, 'g');

export function findConcatenationChain(
  lineText: string,
  lineStartOffset: number,
  token: StringToken
): { start: number; end: number; raw: string } | null {
  const relStart = token.start - lineStartOffset;
  const relEnd = token.end - lineStartOffset;

  CONCAT_CHAIN_REGEXP.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONCAT_CHAIN_REGEXP.exec(lineText)) !== null) {
    if (match.index <= relStart && match.index + match[0].length >= relEnd) {
      return {
        start: lineStartOffset + match.index,
        end: lineStartOffset + match.index + match[0].length,
        raw: match[0].trim(),
      };
    }
  }
  return null;
}

/**
 * 按选区范围在整行内查找拼接链：返回「与选区相交」且「覆盖选区主体」的拼接链。
 * 用于选区不含两端引号（起止落在拼接链内部）时也能识别整条拼接链——此时 findTokenAt
 * 因选区跨多个字符串 token 而失败，但选区实际覆盖的是同一条拼接链。
 * 返回 null 表示该行内没有命中选区的拼接链。
 */
export function findConcatChainByRange(
  lineText: string,
  lineStartOffset: number,
  selStart: number,
  selEnd: number
): { start: number; end: number; raw: string } | null {
  const relStart = selStart - lineStartOffset;
  const relEnd = selEnd - lineStartOffset;

  CONCAT_CHAIN_REGEXP.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONCAT_CHAIN_REGEXP.exec(lineText)) !== null) {
    const mStart = match.index;
    const mEnd = match.index + match[0].length;
    // 选区与拼接链相交（重叠），即选区起止任一落在链内或覆盖链的一部分
    const overlap = relStart <= mEnd && relEnd >= mStart;
    // 选区起点在链起点之后、终点在链终点之前（不含两端引号，但覆盖链主体）视为命中
    const coversBody = relStart >= mStart && relEnd <= mEnd;
    if (overlap && coversBody) {
      return {
        start: lineStartOffset + mStart,
        end: lineStartOffset + mEnd,
        raw: match[0].trim(),
      };
    }
  }
  return null;
}

export function convertConcatToTemplate(concatExpr: string): string {
  const terms = concatExpr.match(new RegExp(CHAIN_TERM_SRC, 'g')) ?? [];
  let result = '`';
  for (const term of terms) {
    const trimmed = term.trim();
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      result += escapeStringContent(trimmed.slice(1, -1), trimmed[0], '`');
    } else if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
      result += trimmed.slice(1, -1);
    } else if (trimmed.length > 0) {
      result += `\${${trimmed}}`;
    }
  }
  return result + '`';
}

/**
 * 把拼接链整体从一种引号切到另一种引号（保留拼接结构，不合并）。
 * 用于引号循环中间态（如 `'a' + x + 'b'` → `"a" + x + "b"`）：
 * - 字符串 term 整体换引号（内部冲突引号反转、转义规整）
 * - 裸表达式 term 保持原样
 * 与 convertConcatToTemplate（→ 模板合并）互补：后者在切到反引号时使用。
 * 拼接链 term 间以原有空白连接，保证非字符串 term（如数字/标识符）原样保留。
 */
export function transformConcatQuotes(concatExpr: string, fromQuote: string, toQuote: string): string {
  // 逐 term 重建，保留 term 间的分隔（+ 两侧空白）。用 splitConcatTerms 定位每个 term，
  // 对字符串 term 换引号，expr term 原样；term 之间的间隔原文（空白 + + + 空白）原样拼接。
  const terms = splitConcatTerms(concatExpr);
  let result = '';
  let prevEnd = 0;
  for (const term of terms) {
    result += concatExpr.slice(prevEnd, term.start); // term 前间隔（含 + 与空白）
    if (term.type === 'str') {
      result += `${toQuote}${escapeStringContent(term.value, fromQuote, toQuote)}${toQuote}`;
    } else {
      result += concatExpr.slice(term.start, term.end); // 表达式/数字等原样
    }
    prevEnd = term.end;
  }
  result += concatExpr.slice(prevEnd); // 尾部（trim 掉的空白）
  return result;
}

export function transformQuotes(rawText: string, fromQuote: string, toQuote: string): string {
  if (fromQuote === '`' && toQuote !== '`') {
    const segments = splitTemplateSegments(rawText);
    const hasExpressions = segments.some(s => s.type === 'expr');
    if (hasExpressions) {
      const parts = segments.map(seg => {
        if (seg.type === 'expr') {
          // 使用精确词法扫描，验证是否为单一字符串字面量
          const innerTokens = scanStringTokens(seg.value);
          if (innerTokens.length === 1 && innerTokens[0].start === 0 && innerTokens[0].end === seg.value.length) {
            const innerQuote = innerTokens[0].quote;
            const innerContent = seg.value.slice(1, -1);
            return `${toQuote}${escapeStringContent(innerContent, innerQuote, toQuote)}${toQuote}`;
          }
          return seg.value;
        }
        return `${toQuote}${escapeStringContent(seg.value, '`', toQuote)}${toQuote}`;
      });
      return parts.join(' + ');
    }
  }
  const content = rawText.slice(1, -1);
  return `${toQuote}${escapeStringContent(content, fromQuote, toQuote)}${toQuote}`;
}

/**
 * 模板字符串（含表达式）→ 拼接时，把「模板内部偏移」映射为「拼接文本内偏移」。
 * 与 transformQuotes('`' → "'") 的分段结构保持一致，按 str/expr 段分别映射：
 * - str 段：模板内 `内容` → `'内容'`（内容前 +1 引号）
 * - expr 段：模板内 `${expr}` → `expr`（expr 起点从 ${ 后开始，去掉 ${ 与 }）
 * - 段间以 ` + ` 连接（每处 +3）
 * 返回 null 表示无表达式（保持原样，偏移不变）或偏移落在无法映射的边界（如 trim 掉的空白）。
 */
export function mapTemplateOffset(rawText: string, offsetInTemplate: number): number | null {
  const segments = splitTemplateSegments(rawText);
  if (!segments.some(s => s.type === 'expr')) return null;

  let cursorInTemplate = 1; // 模板内起点（跳过开头反引号）
  let cursorInConcat = 0; // 拼接文本起点
  let lastMapped: number | null = null; // 最近一个可映射的拼接偏移，供边界兜底
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'str') {
      const innerLen = seg.value.length;
      // 该 str 段对应拼接内 `'内容'`：模板内 [cursorInTemplate, +innerLen) → 拼接内 [cursorInConcat+1, +innerLen)
      if (offsetInTemplate >= cursorInTemplate && offsetInTemplate <= cursorInTemplate + innerLen) {
        const rel = offsetInTemplate - cursorInTemplate;
        return cursorInConcat + 1 + rel;
      }
      if (offsetInTemplate < cursorInTemplate) return lastMapped; // 落在本段之前（如 ${ 前缀）→ 用上一映射
      lastMapped = cursorInConcat + innerLen + 1; // 本段末尾（'内容' 的闭引号位置）
      cursorInTemplate += innerLen;
      cursorInConcat += innerLen + 2; // '内容'
    } else {
      // expr 段：模板内 `${expr}`（expr 从 cursorInTemplate+2 开始，占 2 + innerLen 字符，含 ${ 与 }）
      const exprStart = cursorInTemplate + 2;
      const innerLen = seg.value.length;
      // 落在 ${ 前缀（`$`/`{`，即 [cursorInTemplate, exprStart)）→ 映射到 expr 起点
      if (offsetInTemplate >= cursorInTemplate && offsetInTemplate < exprStart) return cursorInConcat;
      if (offsetInTemplate >= exprStart && offsetInTemplate <= exprStart + innerLen) {
        const rel = offsetInTemplate - exprStart;
        return cursorInConcat + rel;
      }
      lastMapped = cursorInConcat + innerLen; // expr 末尾（拼接内表达式结束）
      cursorInTemplate = exprStart + innerLen + 1; // 到表达式结束含 `}`（共 ${expr}）
      cursorInConcat += innerLen;
    }
    if (i < segments.length - 1) cursorInConcat += 3; // 段间 ' + '
  }
  // 落在结尾（闭反引号/`}` 后）→ 返回最后的映射
  return lastMapped;
}

/** 拼接链的单个片段：str 为引号字符串（值去引号，quote 为引号字符），expr 为裸表达式 */
export interface ConcatTerm {
  type: 'str' | 'expr';
  value: string;
  /** str 段的引号字符（' / " / `）；expr 段为 undefined */
  quote?: string;
  /** 在拼接链原文中的起点（不含前导空白） */
  start: number;
  /** 终点（不含） */
  end: number;
}

/**
 * 把拼接链（如 `'a' + x + 'b'`）拆成 str/expr 段。
 * 与 splitTemplateSegments 互为逆方向：str 段对应模板文本，expr 段对应 `${expr}`。
 * 复用 CHAIN_TERM_SRC 逐个匹配 term，str 为引号包围、其余为裸表达式。
 */
export function splitConcatTerms(concatExpr: string): ConcatTerm[] {
  const terms: ConcatTerm[] = [];
  const re = new RegExp(CHAIN_TERM_SRC, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(concatExpr)) !== null) {
    const raw = m[0];
    const isStr =
      (raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith('`') && raw.endsWith('`'));
    terms.push({
      type: isStr ? 'str' : 'expr',
      value: isStr ? raw.slice(1, -1) : raw,
      quote: isStr ? raw[0] : undefined,
      start: m.index,
      end: m.index + raw.length,
    });
  }
  return terms;
}

/**
 * 拼接链（含表达式）→ 模板字符串时，把「拼接内偏移」映射为「模板字符串内偏移」。
 * 与 mapTemplateOffset 互为逆方向，按 str/expr 段分别映射：
 * - str 段：拼接内 `'内容'` → 模板内 `内容`（内容前 -1 引号）
 * - expr 段：拼接内 `expr` → 模板内 `${expr}`（expr 起点从 ${ 后开始，加 ${ 与 }）
 * - 段间拼接以 ` + ` 连接（每处 -3），模板内无分隔
 * 返回相对模板反引号（=0）的偏移；无法映射时返回 null。
 */
export function mapConcatOffset(concatExpr: string, offsetInConcat: number): number | null {
  const terms = splitConcatTerms(concatExpr);
  if (terms.length === 0) return null;

  let cursorConcat = 0; // 拼接文本内游标（相对拼接起点 0）
  let cursorTemplate = 1; // 模板内游标（相对反引号=0，内容从 1 起）
  let lastMapped: number | null = null; // 最近可映射的模板偏移，供段间边界兜底
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (term.type === 'str') {
      const innerLen = term.value.length;
      const contentStart = cursorConcat + 1; // '内容' 的内容起点
      if (offsetInConcat >= contentStart && offsetInConcat <= contentStart + innerLen) {
        return cursorTemplate + (offsetInConcat - contentStart);
      }
      if (offsetInConcat >= cursorConcat && offsetInConcat < contentStart) return cursorTemplate; // 开引号→内容起点
      lastMapped = cursorTemplate + innerLen; // '内容' 的闭引号→内容末尾
      cursorConcat += innerLen + 2; // '内容'
      cursorTemplate += innerLen;
    } else {
      const innerLen = term.value.length;
      const templateExprStart = cursorTemplate + 2; // ${expr} 的 expr 起点
      if (offsetInConcat >= cursorConcat && offsetInConcat <= cursorConcat + innerLen) {
        return templateExprStart + (offsetInConcat - cursorConcat);
      }
      if (offsetInConcat < cursorConcat) return lastMapped ?? templateExprStart;
      lastMapped = templateExprStart + innerLen; // expr 末尾（} 前）
      cursorConcat += innerLen;
      cursorTemplate += innerLen + 3; // ${expr} 共 innerLen+3 字符（${ 2 + expr + } 1）
    }
    if (i < terms.length - 1) cursorConcat += 3; // 段间 ' + '
  }
  return lastMapped;
}

export function transformAttrQuotes(rawText: string, fromQuote: string, toQuote: string): string {
  const content = rawText.slice(1, -1);
  const innerTokens = scanStringTokens(content);
  if (innerTokens.length === 0) {
    let newContent = content;
    if (toQuote === "'") {
      newContent = newContent.replace(/&quot;/g, '"').replace(/'/g, '&#39;');
    } else if (toQuote === '"') {
      newContent = newContent.replace(/(&#39;|&apos;)/g, "'").replace(/"/g, '&quot;');
    }
    return `${toQuote}${newContent}${toQuote}`;
  }

  let newContent = '';
  let lastIndex = 0;

  for (const token of innerTokens) {
    newContent += content.slice(lastIndex, token.start);
    const tokenRaw = content.slice(token.start, token.end);
    if (token.quote === toQuote) {
      newContent += transformQuotes(tokenRaw, toQuote, fromQuote);
    } else {
      newContent += tokenRaw;
    }
    lastIndex = token.end;
  }
  newContent += content.slice(lastIndex);

  return `${toQuote}${newContent}${toQuote}`;
}
