import Editor from '@/core/editor';
import { SelectionRecord, TextEdit } from '@/utils/edits';
import { remapSelectionsByEdit } from './template-to-concat';
import {
  convertConcatToTemplate,
  findConcatChainByRange,
  findConcatenationChain,
  findTokenAt,
  getNextQuote,
  scanStringTokens,
  splitConcatTerms,
  transformAttrQuotes,
  transformConcatQuotes,
  transformQuotes,
} from '@/utils/quote';
import * as vscode from 'vscode';

/**
 * 切换引号：单引号 / 双引号 / 模板字符串三态循环。
 * - 字符串拼接链（'a' + 'b'）在切换到反引号时自动合并为模板字符串；
 * - 含表达式的模板字符串切换到单/双引号时反向拆成拼接（`hello ${name}` → 'hello ' + name）；
 * - Vue 动态指令属性值切换外层引号并反转内部冲突引号；对象字面量 key 与
 *   HTML 纯文本属性中的撇号按各自规则处理；
 * - 多选区各自独立处理其所在字符串（空光标与非空选区平等参与）；同一段字符串被
 *   多个光标命中时只转换一次，其余光标按相对偏移保持位置；
 * - 编辑后按「编辑前文本 + 编辑列表」重算全部选区在最终文本中的位置并写回，
 *   模板↔拼接切换走段级映射（mapTemplateOffset/mapConcatOffset），普通引号切换走
 *   通用 remapSelections，保证光标/选区在引号切换（尤其长度变化时）不漂移。
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

    // 命中与选区相交的字符串 token：空选区取包含光标的最小 token；非空选区取相交 token
    const matched = findTokenAt(tokens, selStart, selEnd, isEmpty);

    if (!matched) {
      // 非空选区跨多个字符串 token（如选中整条拼接链但未含两端引号）时，
      // findTokenAt 取不到单一 token。此时按选区范围在该行内查找拼接链：
      // 选区起止落在同一条拼接链内部则整条链处理，否则视为非字符串选区。
      if (!isEmpty) {
        const line = document.lineAt(selection.start.line);
        const lineStartOffset = document.offsetAt(line.range.start);
        const concatChain = findConcatChainByRange(line.text, lineStartOffset, selStart, selEnd);
        if (concatChain) {
          if (
            applyConcatChain(
              concatChain,
              editor,
              document,
              processedRanges,
              edits,
              records,
              selStart,
              selEnd,
              isEmpty,
              reversed
            )
          ) {
            hasChanges = true;
          }
          continue;
        }
      }
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

    if (concatChain) {
      // 拼接链：以整条链为单元做引号循环。链的「当前引号」取第一个字符串 term 的引号，
      // 使整条链按 ' → " → ` 顺序整体推进（到 ` 时合并为模板），而非只处理命中的单个字符串。
      if (
        applyConcatChain(
          concatChain,
          editor,
          document,
          processedRanges,
          edits,
          records,
          selStart,
          selEnd,
          isEmpty,
          reversed
        )
      ) {
        hasChanges = true;
      }
      continue;
    }

    // 非拼接链：按单个字符串处理
    const nextQuote = getNextQuote(matched.quote, matched.enclosingQuote, matched.isAttrQuote, matched.isObjectKey);
    if (!nextQuote || nextQuote === matched.quote) {
      // 无法切换（如对象 key 已是最内层可换引号）：仍记录位置
      records.push({ start: selStart, end: selEnd, isEmpty, reversed });
      continue;
    }
    const rawText = originalText.slice(matched.start, matched.end);
    const newText = matched.isAttrQuote
      ? transformAttrQuotes(rawText, matched.quote, nextQuote)
      : transformQuotes(rawText, matched.quote, nextQuote);

    processedRanges.push({ start: matched.start, end: matched.end });
    edits.push({ start: matched.start, end: matched.end, text: newText });
    editor.replace(new vscode.Range(document.positionAt(matched.start), document.positionAt(matched.end)), newText);
    hasChanges = true;
    pushRelative(records, selStart, selEnd, isEmpty, reversed, { start: matched.start, end: matched.end });
  }

  if (hasChanges) {
    const applied = await editor.apply();
    if (applied) textEditor.selections = remapSelectionsByEdit(originalText, edits, records);
  }
}

/** 记录落在替换范围 r 内的选区为相对区间，编辑后映射回新文本内同相对位置 */
function pushRelative(
  records: SelectionRecord[],
  selStart: number,
  selEnd: number,
  isEmpty: boolean,
  reversed: boolean,
  r: { start: number; end: number }
): void {
  if (selStart >= r.start && selEnd <= r.end) {
    records.push({
      start: selStart,
      end: selEnd,
      isEmpty,
      reversed,
      relativeOffset: selStart - r.start,
      relativeEnd: selEnd - r.start,
      replaceStart: r.start,
      replaceLength: r.end - r.start,
    });
  } else {
    records.push({ start: selStart, end: selEnd, isEmpty, reversed });
  }
}

/**
 * 对整条拼接链做一次引号循环。链的「当前引号」取第一个字符串 term 的引号，
 * 使整条链按 ' → " → ` 顺序整体推进：
 * - 下一个是反引号 → 合并为模板字符串；
 * - 否则整条链整体换引号（保留拼接结构）。
 * 返回是否产生了编辑。
 */
function applyConcatChain(
  concatChain: { start: number; end: number; raw: string },
  editor: Editor,
  document: vscode.TextDocument,
  processedRanges: { start: number; end: number }[],
  edits: TextEdit[],
  records: SelectionRecord[],
  selStart: number,
  selEnd: number,
  isEmpty: boolean,
  reversed: boolean
): boolean {
  const terms = splitConcatTerms(concatChain.raw);
  const firstStr = terms.find(t => t.type === 'str');
  if (!firstStr?.quote) return false;

  const chainQuote = firstStr.quote;
  const nextQuote = getNextQuote(chainQuote);
  if (!nextQuote || nextQuote === chainQuote) return false;

  const newText =
    nextQuote === '`'
      ? convertConcatToTemplate(concatChain.raw)
      : transformConcatQuotes(concatChain.raw, chainQuote, nextQuote);

  processedRanges.push({ start: concatChain.start, end: concatChain.end });
  edits.push({ start: concatChain.start, end: concatChain.end, text: newText });
  editor.replace(
    new vscode.Range(document.positionAt(concatChain.start), document.positionAt(concatChain.end)),
    newText
  );
  pushRelative(records, selStart, selEnd, isEmpty, reversed, { start: concatChain.start, end: concatChain.end });
  return true;
}
