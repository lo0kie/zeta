import Editor from '@/core/editor';
import { mergeOverlappingRanges } from '@/utils/edits';
import { findAllTagPairs, findTagPairAt } from '@/utils/tag';
import * as vscode from 'vscode';

interface DeleteRange {
  start: number;
  end: number;
}

/** 解包光标所在的最内层标签对：多光标分别取配对，删除区间去重合并后一次性应用 */
export default async function unwrapTags(textEditor: vscode.TextEditor): Promise<void> {
  const { document, selections, options } = textEditor;
  if (selections.length === 0) return;

  const editor = new Editor(document.uri);
  const offsetOf = (pos: vscode.Position) => document.offsetAt(pos);
  const deletes: DeleteRange[] = [];
  const seen = new Set<string>();
  const addRange = (range: vscode.Range) => {
    const start = offsetOf(range.start);
    const end = offsetOf(range.end);
    if (end <= start) return;
    const key = `${start}-${end}`;
    if (seen.has(key)) return; // 多光标命中同一标签对时去重，避免 applyEdit 因重叠编辑静默失败
    seen.add(key);
    deletes.push({ start, end });
  };

  // 整篇文档只扫描一次全部标签配对，多光标按偏移分别取包含关系，避免每选区 O(文档) 重扫
  const tagPairs = findAllTagPairs(document);

  for (const selection of selections) {
    const pos = selection.isEmpty ? selection.active : selection.start;
    const tagPair = findTagPairAt(tagPairs, document, document.offsetAt(pos));
    if (!tagPair) continue;

    const { openTagRange, closeTagRange, isMultiLine } = tagPair;

    if (isMultiLine) {
      const tabSize = options.insertSpaces ? Number(options.tabSize || 2) : 1;
      const openStartLine = document.lineAt(openTagRange.start.line);
      const openEndLine = document.lineAt(openTagRange.end.line);
      const closeLine = document.lineAt(closeTagRange.start.line);

      const openTagOwnsLines =
        openStartLine.text.slice(0, openTagRange.start.character).trim() === '' &&
        openEndLine.text.slice(openTagRange.end.character).trim() === '';

      if (openTagOwnsLines) {
        addRange(new vscode.Range(openStartLine.range.start, openEndLine.rangeIncludingLineBreak.end));
      } else {
        addRange(openTagRange);
      }

      if (closeLine.text.trim() === document.getText(closeTagRange).trim()) {
        // 闭标签独占整行：连同其行尾换行一起删除。
        addRange(closeLine.rangeIncludingLineBreak);
      } else {
        addRange(closeTagRange);
      }

      for (let line = openTagRange.end.line + 1; line < closeTagRange.start.line; line++) {
        const currentLine = document.lineAt(line);
        if (currentLine.range.isEmpty) continue;
        const spacesToRemove = options.insertSpaces ? ' '.repeat(tabSize) : '\t';
        if (currentLine.text.startsWith(spacesToRemove)) {
          addRange(new vscode.Range(line, 0, line, spacesToRemove.length));
        }
      }
    } else {
      addRange(closeTagRange);
      addRange(openTagRange);
    }
  }

  if (deletes.length === 0) return;

  // 合并重叠/相邻区间为互不重叠的删除，保证 applyEdit 一次成功；
  // 空标签对（<div>\n</div>）的两段仅相邻不重叠，保持为两条编辑
  const merged = mergeOverlappingRanges(deletes);

  for (const range of merged) {
    editor.replace(new vscode.Range(document.positionAt(range.start), document.positionAt(range.end)), '');
  }

  await editor.apply();
}
