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

/** 把最终文本偏移换算成 Position（text 为 buildFinalText 的产物） */
export function positionAt(text: string, offset: number): vscode.Position {
  let line = 0;
  let character = 0;
  const end = Math.max(0, Math.min(offset, text.length));
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return new vscode.Position(line, character);
}
