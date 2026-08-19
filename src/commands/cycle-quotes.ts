import Editor from '@/core/editor';
import { SelectionRecord, TextEdit, remapSelections } from '@/utils/edits';
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
 * - 多选区各自独立处理其所在字符串（空光标与非空选区平等参与）；同一段字符串被
 *   多个光标命中时只转换一次，其余光标按相对偏移保持位置；
 * - 编辑后按「编辑前文本 + 编辑列表」重算全部选区在最终文本中的位置并写回，
 *   保证光标/选区在引号切换（尤其长度变化时）不漂移。
 */
export default async function cycleQuotes(textEditor: vscode.TextEditor): Promise<void> {
  const { document, selections } = textEditor;
  const originalText = document.getText();
  const tokens = scanStringTokens(originalText);
  if (tokens.length === 0) return;

  const editor = new Editor(document.uri);
  const processedRanges: { start: number; end: number }[] = [];
  const edits: TextEdit[] = [];
  const records: SelectionRecord[] = [];
  let hasChanges = false;

  for (const selection of selections) {
    const selStart = document.offsetAt(selection.start);
    const selEnd = document.offsetAt(selection.end);
    const isEmpty = selection.isEmpty;
    // 反向选区（active < anchor，即「向左选择」）：重映射后要保持方向不变
    const reversed = selection.isReversed;

    // 非空选区跨行（起点与终点不在同一行）不切换引号，仅记录位置：跨行选区跨越多个
    // 字符串，语义不明确。与 changeCase/cycleCase 的跨行跳过保持一致；单光标跨行时
    // 命令面板/快捷键已由 zeta.caseDisabled 禁用，此保护覆盖其余触发途径。
    if (!isEmpty && selection.start.line !== selection.end.line) {
      records.push({ start: selStart, end: selEnd, isEmpty, reversed });
      continue;
    }

    // 命中与选区相交的字符串 token：空选区取包含光标的最近 token；非空选区取相交 token
    const matched = tokens
      .filter(t =>
        isEmpty
          ? t.start <= selStart && t.end >= selEnd
          : (t.start <= selStart && t.end >= selEnd) || (selStart <= t.start && selEnd >= t.end)
      )
      // 优先取「包围选区的最小 token」：空选区在嵌套字符串（如内嵌反引号）时选中最内层
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];

    if (!matched) {
      // 未命中字符串（非字符串选区）：仅记录位置，供前面编辑后的整体重算
      records.push({ start: selStart, end: selEnd, isEmpty, reversed });
      continue;
    }
    // 同一段字符串已被前面的选区处理过则跳过（多选区重叠保护），但记录位置。
    // 光标/选区落在被替换范围内时仍要带相对偏移：否则 remapSelections 对无偏移的选区
    // 用 remapOffset 会把落在替换内部的偏移钳制到替换末尾——同一字符串内的第二个光标
    // （或选中了替换内部一部分的选区）就会跳到字符串末尾。
    const existingRange = processedRanges.find(r => matched.start >= r.start && matched.end <= r.end);
    if (existingRange) {
      if (selStart >= existingRange.start && selEnd <= existingRange.end) {
        records.push({
          start: selStart,
          end: selEnd,
          isEmpty,
          reversed,
          relativeOffset: selStart - existingRange.start,
          relativeEnd: selEnd - existingRange.start,
          replaceStart: existingRange.start,
          replaceLength: existingRange.end - existingRange.start,
        });
      } else {
        records.push({ start: selStart, end: selEnd, isEmpty, reversed });
      }
      continue;
    }

    const line = document.lineAt(document.positionAt(matched.start).line);
    const lineStartOffset = document.offsetAt(line.range.start);
    const concatChain = findConcatenationChain(line.text, lineStartOffset, matched);

    let replaceStart = matched.start;
    let replaceEnd = matched.end;
    let newText = '';

    const nextQuote = getNextQuote(matched.quote, matched.enclosingQuote, matched.isAttrQuote, matched.isObjectKey);
    if (!nextQuote || nextQuote === matched.quote) {
      // 无法切换（如对象 key 已是最内层可换引号）：仍记录位置
      records.push({ start: selStart, end: selEnd, isEmpty, reversed });
      continue;
    }

    const rawText = originalText.slice(matched.start, matched.end);

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
    edits.push({ start: replaceStart, end: replaceEnd, text: newText });
    editor.replace(new vscode.Range(document.positionAt(replaceStart), document.positionAt(replaceEnd)), newText);
    hasChanges = true;

    // 选区完全落在替换范围内时记录相对区间（空光标为零长区间），编辑后映射回
    // 新文本内同相对位置；选区跨出替换范围（如整条字符串连带前后字符）则走 remapOffset
    // 的常规位移，因为起点/终点都不落在替换内部。
    if (selStart >= replaceStart && selEnd <= replaceEnd) {
      records.push({
        start: selStart,
        end: selEnd,
        isEmpty,
        reversed,
        relativeOffset: selStart - replaceStart,
        relativeEnd: selEnd - replaceStart,
        replaceStart,
        replaceLength: replaceEnd - replaceStart,
      });
    } else {
      records.push({ start: selStart, end: selEnd, isEmpty, reversed });
    }
  }

  if (hasChanges) {
    const applied = await editor.apply();
    if (applied) textEditor.selections = remapSelections(originalText, edits, records);
  }
}
