/**
 * 文本处理纯函数：行偏移索引、偏移→行号二分、注释等长掩码。
 *
 * 原先 buildLineStarts / lineOf 在 style-parser 与 style-definition 各有一份逐字重复，
 * 此处统一抽取为单一实现，避免未来语义变更（如 CRLF）时漏改一处导致行为漂移。
 * 本模块零业务依赖（纯文本处理）。
 */

/** 预构建行偏移索引（每个行首的绝对偏移），一次 O(n)；配合 lineOf 二分查询 O(log n) */
export function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** 绝对偏移 → 行号（二分查找最后一个 <= offset 的 lineStart） */
export function lineOf(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 仅将注释（`/* ... *​/` 与 `// ...`）替换为等长空白，字符串字面量原样保留、换行保留。
 *
 * 用途：在「去注释后仍要与原文保持同一偏移」的扫描场景（如 mixin 定义正则、选择器定义提取）
 * 替代 `stripCommentsSafe`——后者会删除注释导致文本变短，后续用原文 lineStarts 换算偏移时错位。
 * 掩码为等长空白既避免注释内容参与匹配，又保证 m.index 与原文偏移一致。
 * 字符串必须原样保留（不能掩码）：mixin 参数里的字符串（如 `.mixin(@a: "x;y")`）需要保留其内容。
 */
export function maskComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*/g, match => match.replace(/[^\r\n]/g, ' '));
}

/**
 * 将注释与字符串字面量都替换为等长空白（换行保留）。
 * 与 maskComments 的区别：字符串也被掩码（`'...'`/`"..."`/`` `...` ``）。
 * 用于「注释与字符串内容都不该参与匹配、且需保持偏移」的扫描（如符号定义提取）。
 */
export function maskCommentsAndStrings(content: string): string {
  return content.replace(/(['"`])(?:\\.|[^\\\r\n])*?(?:\1|\r?\n|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/.*/g, match =>
    match.replace(/[^\r\n]/g, ' ')
  );
}
