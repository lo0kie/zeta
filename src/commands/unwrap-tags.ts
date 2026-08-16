import Editor from '@/core/editor';
import { findEnclosingTags } from '@/utils/tag';
import * as vscode from 'vscode';

export default async function unwrapTags(textEditor: vscode.TextEditor): Promise<void> {
  const { document, selections, options } = textEditor;
  if (selections.length === 0) return;

  const editor = new Editor(document.uri);
  let hasChanges = false;

  for (const selection of selections) {
    const pos = selection.isEmpty ? selection.active : selection.start;
    const tagPair = findEnclosingTags(document, pos);
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
        const prevLine = document.lineAt(closeTagRange.start.line - 1);
        editor.replace(new vscode.Range(prevLine.range.end, closeLine.range.end), '');
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
