import Editor from '@/core/editor';
import { SelectionRecord, TextEdit, remapSelections } from '@/utils/edits';
import {
  convertConcatToTemplate,
  findConcatenationChain,
  findTokenAt,
  mapConcatOffset,
  mapTemplateOffset,
  scanStringTokens,
  transformQuotes,
} from '@/utils/quote';
import * as vscode from 'vscode';

/** zeta 输出通道（惰性）：记录互转命令执行过程，供用户从「输出 → zeta」查看。测试环境无该 API 时降级为 no-op。 */
let outChannel: vscode.OutputChannel | undefined;
function log(line: string): void {
  try {
    if (!outChannel && typeof vscode.window.createOutputChannel === 'function') {
      outChannel = vscode.window.createOutputChannel('zeta');
    }
    outChannel?.appendLine(line);
  } catch {
    /* 测试环境无 OutputChannel：忽略 */
  }
}

/**
 * 模板字符串 ↔ 字符串拼接 双向互转（同一个命令自动判断方向）：
 * - 命中含 `${...}` 的模板字符串（`` `hello ${name}` ``）→ 拆成拼接 `'hello ' + name`；
 *   无表达式的纯文本模板拆拼接没有意义，保持原样。
 * - 命中字符串拼接链（`'a' + x + 'b'`）→ 合并成模板字符串 `` `a${x}b` ``。
 * 多光标各自处理命中的目标；同一段被多光标命中时只转换一次。
 * 编辑后按「编辑前文本 + 编辑列表」重算全部选区在最终文本中的位置并写回，
 * 保证光标/选区在模板↔拼接（文本长度变化）时不漂移。
 */
export default async function splitTemplateToConcat(textEditor: vscode.TextEditor): Promise<void> {
  log(`[zeta:templateToConcat] 命令已触发, selections=${textEditor.selections.length}`);
  const { document, selections } = textEditor;
  if (selections.length === 0) return;
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
    // 反向选区（active < anchor）：重映射后要保持方向不变
    const reversed = selection.isReversed;
    // 非空选区跨行不处理：模板可跨行，拼接链仅单行（findConcatenationChain 按行扫描）
    const spansLines = !isEmpty && selection.start.line !== selection.end.line;

    // 方向一：命中含光标的模板字符串 token
    const templateMatch = spansLines ? undefined : findTokenAt(tokens, selStart, selEnd, isEmpty, t => t.quote === '`');
    const rawTemplate = templateMatch ? originalText.slice(templateMatch.start, templateMatch.end) : '';
    if (templateMatch && rawTemplate.includes('${')) {
      const newText = transformQuotes(rawTemplate, '`', "'");
      if (newText === rawTemplate) {
        records.push({ start: selStart, end: selEnd, isEmpty, reversed });
        continue;
      }
      // 同一段已被前面的选区处理过则跳过，但记录位置带相对偏移
      const existingRange = processedRanges.find(r => templateMatch!.start >= r.start && templateMatch!.end <= r.end);
      if (existingRange) {
        pushRelative(records, selStart, selEnd, isEmpty, reversed, existingRange);
        continue;
      }
      processedRanges.push({ start: templateMatch.start, end: templateMatch.end });
      edits.push({ start: templateMatch.start, end: templateMatch.end, text: newText });
      editor.replace(
        new vscode.Range(document.positionAt(templateMatch.start), document.positionAt(templateMatch.end)),
        newText
      );
      hasChanges = true;
      pushRelative(records, selStart, selEnd, isEmpty, reversed, {
        start: templateMatch.start,
        end: templateMatch.end,
      });
      continue;
    }

    // 方向二：命中字符串 token 且其处于拼接链中 → 合并为模板
    if (!spansLines) {
      const stringMatch = findTokenAt(tokens, selStart, selEnd, isEmpty, t => t.quote !== '`');
      if (stringMatch) {
        const line = document.lineAt(document.positionAt(stringMatch.start).line);
        const lineStartOffset = document.offsetAt(line.range.start);
        const concatChain = findConcatenationChain(line.text, lineStartOffset, stringMatch);
        if (concatChain) {
          const existingRange = processedRanges.find(r => concatChain!.start >= r.start && concatChain!.end <= r.end);
          if (existingRange) {
            pushRelative(records, selStart, selEnd, isEmpty, reversed, existingRange);
            continue;
          }
          const newText = convertConcatToTemplate(concatChain.raw);
          processedRanges.push({ start: concatChain.start, end: concatChain.end });
          edits.push({ start: concatChain.start, end: concatChain.end, text: newText });
          editor.replace(
            new vscode.Range(document.positionAt(concatChain.start), document.positionAt(concatChain.end)),
            newText
          );
          hasChanges = true;
          pushRelative(records, selStart, selEnd, isEmpty, reversed, {
            start: concatChain.start,
            end: concatChain.end,
          });
          continue;
        }
      }
    }

    // 未命中任何目标：仅记录位置，供前面编辑后的整体重算
    records.push({ start: selStart, end: selEnd, isEmpty, reversed });
  }

  if (hasChanges) {
    const applied = await editor.apply();
    log(`[zeta:templateToConcat] applied=${applied} edits=${edits.length} records=${records.length}`);
    if (applied) {
      const newSelections = remapSelectionsByEdit(originalText, edits, records);
      log(
        '[zeta:templateToConcat] newSelections=' +
          newSelections.map(s => `${s.start.line}:${s.start.character}-${s.end.line}:${s.end.character}`).join(' ')
      );
      textEditor.selections = newSelections;
    }
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
 * 编辑后按「被替换段的方向」重算选区位置。
 * 对被替换段内的选区，用段级映射精确对应到新文本内的相同语义位置：
 * - 模板→拼接：mapTemplateOffset（前缀/后缀 +2，${expr} 段 -2，段间 +3）
 * - 拼接→模板：mapConcatOffset（与上互为逆方向）
 * 因为模板↔拼接后各段长度变化不均，通用 remapSelections 的「块内均匀映射」会导致光标漂移。
 * 段外选区仍走通用 remapSelections。
 */
export function remapSelectionsByEdit(
  originalText: string,
  edits: TextEdit[],
  records: SelectionRecord[]
): vscode.Selection[] {
  const editByStart = new Map<number, TextEdit>();
  for (const e of edits) editByStart.set(e.start, e);

  // 计算每个 edit 在最终文本中的起点（累积前面 edit 的长度差）
  const editFinalStart = new Map<number, number>();
  {
    let acc = 0;
    for (const e of edits.slice().sort((a, b) => a.start - b.start)) {
      editFinalStart.set(e.start, e.start + acc);
      acc += e.text.length - (e.end - e.start);
    }
  }

  const selArray: vscode.Selection[] = [];

  // 先处理被替换段内的选区（段级映射）
  const unconverted: { record: SelectionRecord; idx: number }[] = [];
  for (let idx = 0; idx < records.length; idx++) {
    const record = records[idx];
    if (record.replaceStart !== undefined && record.relativeOffset !== undefined) {
      const edit = editByStart.get(record.replaceStart);
      const rawSrc = edit ? originalText.slice(edit.start, edit.end) : '';
      const finalStart = editFinalStart.get(record.replaceStart) ?? record.replaceStart;

      // 覆盖整个替换段（起点 = 0，终点 = 原段长）→ 映射到整个新文本
      const fullLen = rawSrc.length;
      if (record.relativeOffset <= 0 && record.relativeEnd !== undefined && record.relativeEnd >= fullLen) {
        const newLen = edit ? edit.text.length : 0;
        selArray[idx] = makeSelection(
          record,
          positionAtOffset(originalText, edits, finalStart),
          positionAtOffset(originalText, edits, finalStart + newLen)
        );
        continue;
      }

      // 按替换方向选择段级映射：
      // - 源是模板（以反引号包围）→ 模板→拼接，用 mapTemplateOffset(rawSrc=模板)
      // - 源不是模板、目标是模板 → 拼接→模板，用 mapConcatOffset(rawSrc=拼接链)
      // - 普通引号切换（源/目标都不是模板）→ 长度近似、通用 remapSelections 足够，走 unconverted
      const rawTarget = edit ? edit.text : '';
      const srcIsTemplate = rawSrc.startsWith('`') && rawSrc.endsWith('`');
      const dstIsTemplate = rawTarget.startsWith('`') && rawTarget.endsWith('`');
      if (srcIsTemplate || dstIsTemplate) {
        const mapOffset = srcIsTemplate ? mapTemplateOffset : mapConcatOffset;
        const mappedRel = mapOffset(rawSrc, record.relativeOffset);
        if (mappedRel !== null) {
          const newStart = finalStart + mappedRel;
          const newEnd =
            record.relativeEnd !== undefined && record.relativeEnd !== record.relativeOffset
              ? finalStart + (mapOffset(rawSrc, record.relativeEnd) ?? mappedRel)
              : newStart;
          selArray[idx] = makeSelection(
            record,
            positionAtOffset(originalText, edits, newStart),
            positionAtOffset(originalText, edits, newEnd)
          );
          continue;
        }
      }
    }
    unconverted.push({ record, idx });
  }

  // 未段级映射的走通用 remapSelections
  if (unconverted.length > 0) {
    const mapped = remapSelections(
      originalText,
      edits,
      unconverted.map(u => u.record)
    );
    for (let i = 0; i < unconverted.length; i++) {
      selArray[unconverted[i].idx] = mapped[i];
    }
  }
  return selArray;
}

/** 按记录方向构造选区（reversed 时 anchor 在后） */
function makeSelection(record: SelectionRecord, start: vscode.Position, end: vscode.Position): vscode.Selection {
  return record.reversed ? new vscode.Selection(end, start) : new vscode.Selection(start, end);
}

/** 在「编辑后」文档中定位 offset 对应的 Position（通过应用 edits 得到最终文本） */
function positionAtOffset(originalText: string, edits: TextEdit[], offset: number): vscode.Position {
  const finalText = edits
    .slice()
    .sort((a, b) => a.start - b.start)
    .reduce((acc, e) => acc.slice(0, e.start) + e.text + acc.slice(e.end), originalText);
  let line = 0;
  let col = 0;
  const clamped = Math.max(0, Math.min(offset, finalText.length));
  for (let i = 0; i < clamped; i++) {
    if (finalText[i] === '\n') {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return new vscode.Position(line, col);
}
