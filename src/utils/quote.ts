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

function splitTemplateSegments(rawText: string): { type: 'str' | 'expr'; value: string }[] {
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
