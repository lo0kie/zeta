/**
 * 编辑纯函数工具：区间合并、缩进推断、最终文本构建、偏移重映射、偏移转行列。
 */
import * as vscode from 'vscode';

/** 一次文本编辑：start/end 为原文偏移（insert 时 end === start） */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

export interface OffsetRange {
  start: number;
  end: number;
}

export function mergeOverlappingRanges<T extends OffsetRange>(ranges: T[]): T[] {
  if (ranges.length <= 1) return ranges.map(r => ({ ...r }));
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  // 完全解除原始引用
  const merged: T[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start < last.end) {
      if (current.end > last.end) {
        last.end = current.end;
      }
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

export function indentUnit(options?: vscode.TextEditorOptions): string {
  if (!options) return '  ';
  return options.insertSpaces ? ' '.repeat(Number(options.tabSize || 2)) : '\t';
}

/** 转义 Snippet 语法保留字符（$、}、\），防止原代码内容被 Snippet 引擎误解析 */
export function escapeSnippetText(text: string): string {
  return text.replace(/[$}\\]/g, '\\$&');
}

export function leadingIndent(text: string): string {
  return text.match(/^[\t ]*/)?.[0] ?? '';
}

/**
 * 把一组互不重叠的编辑应用到原文，得到最终文本。
 * 编辑按 (start, end) 升序处理；同一偏移的多条编辑按传入顺序拼接，保证与
 * remapOffset 的「同偏移编辑按先后」约定一致。replace 会跳过被替换的原文区间。
 */
export function buildFinalText(original: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let result = '';
  let cursor = 0;
  for (const edit of sorted) {
    result += original.slice(cursor, edit.start);
    result += edit.text;
    cursor = edit.end;
  }
  result += original.slice(cursor);
  return result;
}

/**
 * 计算最终文本中的偏移（与 buildFinalText 使用同一约定）：
 * 原偏移 offset 会依次被「完全位于其前的编辑」（edit.end <= offset）位移；
 * 若 offset 落在某条替换内部（编辑自身占据 offset 至其 end），则按该替换的长度钳制。
 */
export function remapOffset(offset: number, edits: TextEdit[]): number {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let result = offset;
  for (const edit of sorted) {
    if (edit.end <= offset) {
      result += edit.text.length - (edit.end - edit.start);
    } else if (edit.start < offset && offset < edit.end) {
      const deltaBefore = result - offset;
      result = edit.start + deltaBefore + edit.text.length;
      break;
    }
  }
  return result;
}

/** 选区重映射记录：用于编辑后按最终文本重算选区位置 */
export interface SelectionRecord {
  start: number;
  end: number;
  isEmpty: boolean;
  /** 选区方向：true 表示反向（anchor > active，即「向左选择」）；默认正向 */
  reversed?: boolean;
  /** 光标/选区起点相对「编辑起点」的偏移（编辑后映射回新文本，夹在长度内） */
  relativeOffset?: number;
  /** 非空选区终点相对「编辑起点」的偏移（relativeOffset 表示起点时使用） */
  relativeEnd?: number;
  /** 对应编辑的起点（从 edits 中查找该编辑以取新文本长度） */
  replaceStart?: number;
  /** 原编辑范围长度（对应编辑缺失时兜底） */
  replaceLength?: number;
}

/**
 * 按「编辑前文本 + 编辑列表」重算所有选区在最终文本中的位置，并保持选区方向
 * （正向/反向不变——vscode.Selection(anchor, active) 的参数顺序决定方向）。
 * - 若记录了 relativeOffset（+可选 relativeEnd）与 replaceStart：映射到新文本内同相对区间
 *   （夹在替换长度内）。空光标相对区间为零长；非空选区选中了替换内部的一部分时，
 *   用 remapOffset 会把选区起点/终点都钳制到替换末尾——必须走相对映射保持选区内容。
 * - 否则按 remapOffset 的位移规则映射（落在替换内部时钳制到替换末尾）。
 */
export function remapSelections(
  originalText: string,
  edits: TextEdit[],
  records: SelectionRecord[]
): vscode.Selection[] {
  const finalText = buildFinalText(originalText, edits);
  // 预建「编辑起点 → 编辑」索引，避免每条记录都线性 find（编辑多时 O(n·m)）
  const editByStart = new Map<number, TextEdit>(edits.map(e => [e.start, e]));
  return records.map(record => {
    // 按方向构造：reversed 时 anchor 在后（大偏移）、active 在前（小偏移）
    const makeSelection = (a: vscode.Position, b: vscode.Position) =>
      record.reversed ? new vscode.Selection(b, a) : new vscode.Selection(a, b);

    if (record.relativeOffset !== undefined && record.replaceStart !== undefined) {
      const matchedEdit = editByStart.get(record.replaceStart);
      const mappedStart = remapOffset(record.replaceStart, edits);
      const newLength = matchedEdit ? matchedEdit.text.length : (record.replaceLength ?? 0);
      const newStart = mappedStart + Math.min(record.relativeOffset, newLength);
      const endRel = record.relativeEnd ?? record.relativeOffset;
      const newEnd = mappedStart + Math.min(endRel, newLength);
      return makeSelection(positionAt(finalText, newStart), positionAt(finalText, newEnd));
    }
    if (record.isEmpty) {
      const endPos = positionAt(finalText, remapOffset(record.end, edits));
      return new vscode.Selection(endPos, endPos);
    }
    return makeSelection(
      positionAt(finalText, remapOffset(record.start, edits)),
      positionAt(finalText, remapOffset(record.end, edits))
    );
  });
}

/** 把最终文本偏移换算成 Position（text 为 buildFinalText 的产物）；越界钳制，用原生 indexOf 跳跃数换行 */
export function positionAt(text: string, offset: number): vscode.Position {
  const validOffset = Math.max(0, Math.min(offset, text.length));
  const textBefore = text.slice(0, validOffset);

  let line = 0;
  let lastNewLineIndex = -1;

  while (true) {
    const nextIndex = textBefore.indexOf('\n', lastNewLineIndex + 1);
    if (nextIndex === -1) break;
    line++;
    lastNewLineIndex = nextIndex;
  }

  return new vscode.Position(line, validOffset - lastNewLineIndex - 1);
}
