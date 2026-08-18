import Editor from '@/core/editor';
import {
  convertConcatToTemplate,
  findConcatenationChain,
  getNextQuote,
  scanStringTokens,
  transformAttrQuotes,
  transformQuotes,
} from '@/utils/quote';
import * as vscode from 'vscode';

/**
 * 切换引号：单引号 / 双引号 / 模板字符串三态循环。
 * - 字符串拼接链（'a' + 'b'）在切换到反引号时自动合并为模板字符串；
 * - Vue 动态指令属性值切换外层引号并反转内部冲突引号；对象字面量 key 与
 *   HTML 纯文本属性中的撇号按各自规则处理；
 * - 多选区互不重叠地逐个处理，非空选区存在时空光标选区跳过。
 */
export default async function cycleQuotes(textEditor: vscode.TextEditor): Promise<void> {
  const { document, selections } = textEditor;
  const text = document.getText();
  const tokens = scanStringTokens(text);
  if (tokens.length === 0) return;

  const editor = new Editor(document.uri);
  const processedRanges: { start: number; end: number }[] = [];
  let hasChanges = false;
  const hasNonEmpty = selections.some(s => !s.isEmpty);

  for (const selection of selections) {
    // 已有非空选区时，空光标选区不参与（避免误改相邻字符串）
    if (hasNonEmpty && selection.isEmpty) continue;

    const selStart = document.offsetAt(selection.start);
    const selEnd = document.offsetAt(selection.end);

    // 命中与选区相交的字符串 token：空选区取包含光标的最近 token；非空选区取相交 token
    const matched = tokens
      .filter(t =>
        selection.isEmpty
          ? t.start <= selStart && t.end >= selEnd
          : (t.start <= selStart && t.end >= selEnd) || (selStart <= t.start && selEnd >= t.end)
      )
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];

    if (!matched) continue;
    // 同一段字符串已被前面的选区处理过则跳过（多选区重叠保护）
    if (processedRanges.some(r => matched.start >= r.start && matched.end <= r.end)) continue;

    const line = document.lineAt(document.positionAt(matched.start).line);
    const lineStartOffset = document.offsetAt(line.range.start);
    const concatChain = findConcatenationChain(line.text, lineStartOffset, matched);

    let replaceStart = matched.start;
    let replaceEnd = matched.end;
    let newText = '';

    const nextQuote = getNextQuote(matched.quote, matched.enclosingQuote, matched.isAttrQuote, matched.isObjectKey);
    if (!nextQuote || nextQuote === matched.quote) continue;

    const rawText = text.slice(matched.start, matched.end);

    if (matched.isAttrQuote) {
      // Vue 属性引号：直接换外层引号，内部冲突引号做实体/反转处理
      newText = transformAttrQuotes(rawText, matched.quote, nextQuote);
    } else if (concatChain && nextQuote === '`') {
      // 拼接链 → 模板字符串：替换范围扩展到整条链
      replaceStart = concatChain.start;
      replaceEnd = concatChain.end;
      newText = convertConcatToTemplate(concatChain.raw);
    } else {
      newText = transformQuotes(rawText, matched.quote, nextQuote);
    }

    processedRanges.push({ start: replaceStart, end: replaceEnd });
    editor.replace(new vscode.Range(document.positionAt(replaceStart), document.positionAt(replaceEnd)), newText);
    hasChanges = true;
  }

  if (hasChanges) await editor.apply();
}
