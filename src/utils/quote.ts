export const QUOTE_ORDER = ["'", '"', '`'] as const;

export interface StringToken {
  start: number;
  end: number;
  quote: string;
}

function looksLikeRegexStart(text: string, index: number): boolean {
  let j = index - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (j < 0) return true;
  const prevChar = text[j];
  if (/[a-zA-Z0-9_$)\]]/.test(prevChar)) {
    let k = j;
    while (k >= 0 && /[a-zA-Z0-9_$]/.test(text[k])) k--;
    const word = text.slice(k + 1, j + 1);
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
    return /[a-zA-Z_$]/.test(prevChar) && keywordsBeforeRegex.has(word);
  }
  return true;
}

export function scanStringTokens(text: string): StringToken[] {
  const tokens: StringToken[] = [];
  let i = 0;
  const len = text.length;
  type Mode = 'CODE' | 'STRING' | 'TEMPLATE';
  interface State {
    mode: Mode;
    quote?: string;
    start?: number;
    braceDepth?: number;
  }
  const stack: State[] = [{ mode: 'CODE' }];

  while (i < len) {
    const current = stack[stack.length - 1];
    const char = text[i];
    const next = text[i + 1];
    if (current.mode === 'CODE') {
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
      if (char === "'" || char === '"') {
        stack.push({ mode: 'STRING', quote: char, start: i });
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
          if (current.braceDepth === 0) {
            stack.pop();
            i++;
            continue;
          }
          current.braceDepth--;
        }
        i++;
        continue;
      }
      i++;
    } else if (current.mode === 'STRING') {
      if (char === '\\') {
        i += 2;
        continue;
      }
      if (char === current.quote) {
        tokens.push({ start: current.start!, end: i + 1, quote: current.quote! });
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
        tokens.push({ start: current.start!, end: i + 1, quote: '`' });
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
      while (i < content.length && braceDepth > 0) {
        if (content[i] === '{') braceDepth++;
        else if (content[i] === '}') braceDepth--;
        if (braceDepth > 0) exprBuffer += content[i];
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

export function findConcatenationChain(
  lineText: string,
  lineStartOffset: number,
  token: StringToken
): { start: number; end: number; raw: string } | null {
  const relStart = token.start - lineStartOffset;
  const relEnd = token.end - lineStartOffset;
  let left = relStart;
  while (left > 0) {
    const prevText = lineText.slice(0, left).trimEnd();
    if (prevText.endsWith('+')) {
      const plusIdx = prevText.lastIndexOf('+');
      left = lineText.slice(0, plusIdx).search(/\S[^\n]*$/);
      if (left === -1) break;
    } else {
      break;
    }
  }
  let right = relEnd;
  while (right < lineText.length) {
    const restText = lineText.slice(right).trimStart();
    if (restText.startsWith('+')) {
      const afterPlusOffset = lineText.indexOf('+', right) + 1;
      const match = lineText.slice(afterPlusOffset).match(/^\s*([^+\n;,\)]+)/);
      if (match) {
        right = afterPlusOffset + match[0].length;
      } else {
        break;
      }
    } else {
      break;
    }
  }
  if (left === relStart && right === relEnd) return null;
  return {
    start: lineStartOffset + left,
    end: lineStartOffset + right,
    raw: lineText.slice(left, right).trim(),
  };
}

export function convertConcatToTemplate(concatExpr: string): string {
  const parts = concatExpr.split(/\s*\+\s*/);
  let result = '`';
  for (const part of parts) {
    const trimmed = part.trim();
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
          if (
            (seg.value.startsWith("'") && seg.value.endsWith("'")) ||
            (seg.value.startsWith('"') && seg.value.endsWith('"'))
          ) {
            const innerQuote = seg.value[0];
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
