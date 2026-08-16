import Editor from '@/core/editor';
import { findAllTagPairs, findTagPairAt } from '@/utils/tag';
import * as vscode from 'vscode';

export default async function unwrapTags(textEditor: vscode.TextEditor): Promise<void> {
  const { document, selections, options } = textEditor;
  if (selections.length === 0) return;

  const editor = new Editor(document.uri);
  let hasChanges = false;

  // 整篇文档只扫描一次全部标签配对，多光标按偏移分别取包含关系，避免每选区 O(文档) 重扫
  const tagPairs = findAllTagPairs(document);

  for (const selection of selections) {
    const pos = selection.isEmpty ? selection.active : selection.start;
    const tagPair = findTagPairAt(tagPairs, document, document.offsetAt(pos));
    if (!tagPair) continue;

    const { openTagRange, closeTagRange, isMultiLine } = tagPair;

    if (isMultiLine) {
      const tabSize = options.insertSpaces ? Number(options.tabSize) : 1;
      const openStartLine = document.lineAt(openTagRange.start.line);
      const openEndLine = document.lineAt(openTagRange.end.line);
      const closeLine = document.lineAt(closeTagRange.start.line);

      const openTagOwnsLines =
        openStartLine.text.slice(0, openTagRange.start.character).trim() === '' &&
        openEndLine.text.slice(openTagRange.end.character).trim() === '';

      if (openTagOwnsLines) {
        editor.replace(
          new vscode.Range(openStartLine.range.start, new vscode.Position(openTagRange.end.line + 1, 0)),
          ''
        );
      } else {
        editor.replace(openTagRange, '');
      }

      if (closeLine.text.trim() === document.getText(closeTagRange).trim()) {
        // 闭标签独占整行：连同其行尾换行一起删除。
        // 与开标签的整行删除（Range 到下一行行首）相邻而非重叠，
        // 避免空标签场景（<div>\n</div>）两个 Range 在行交界处重叠导致 applyEdit 静默失败
        editor.replace(closeLine.rangeIncludingLineBreak, '');
      } else {
        editor.replace(closeTagRange, '');
      }

      for (let line = openTagRange.end.line + 1; line < closeTagRange.start.line; line++) {
        const currentLine = document.lineAt(line);
        if (currentLine.range.isEmpty) continue;
        const text = currentLine.text;
        const spacesToRemove = options.insertSpaces ? ' '.repeat(tabSize) : '\t';
        if (text.startsWith(spacesToRemove)) {
          editor.replace(new vscode.Range(line, 0, line, spacesToRemove.length), '');
        }
      }
    } else {
      editor.replace(closeTagRange, '');
      editor.replace(openTagRange, '');
    }

    hasChanges = true;
  }

  if (hasChanges) await editor.apply();
}
