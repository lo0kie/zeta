import { Configuration } from '@/core/configuration';
import { TextEdit } from '@/utils/edits';
import * as vscode from 'vscode';

type OrderedEdit = TextEdit & { order: number };

function escapeSnippetText(text: string): string {
  return text.replace(/[$}\\]/g, '\\$&');
}

function pushInsert(edits: OrderedEdit[], offset: number, text: string): void {
  edits.push({ start: offset, end: offset, text, order: edits.length });
}

function handleEmptyLine(
  start: vscode.Position,
  openTag: string,
  closeTag: string,
  edits: OrderedEdit[],
  offsetOf: (pos: vscode.Position) => number
): void {
  const offset = offsetOf(start);
  pushInsert(edits, offset, `${openTag}${closeTag}`);
}

function handleLastCharacter(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  tabSize: string,
  openTag: string,
  closeTag: string,
  edits: OrderedEdit[],
  offsetOf: (pos: vscode.Position) => number
): void {
  const { start, end } = selection;
  const { text } = document.lineAt(start.line);
  const [_, space = ''] = text.match(/^(\s*)\S/) || [];

  const lineStartOffset = offsetOf(start.translate(0, -start.character));
  pushInsert(edits, lineStartOffset, `${space}${openTag}\n${tabSize}`);

  const endOffset = offsetOf(end);
  pushInsert(edits, endOffset, `\n${space}${closeTag}`);
}

function handleSingleLine(
  selection: vscode.Selection,
  openTag: string,
  closeTag: string,
  edits: OrderedEdit[],
  offsetOf: (pos: vscode.Position) => number
): void {
  const { start, end } = selection;
  pushInsert(edits, offsetOf(start), openTag);
  pushInsert(edits, offsetOf(end), closeTag);
}

function handleMultiLine(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  tabSize: string,
  openTag: string,
  closeTag: string,
  edits: OrderedEdit[],
  offsetOf: (pos: vscode.Position) => number
): void {
  const { start, end } = selection;
  const { text } = document.lineAt(start.line);
  const [_, fullLineSpace = ''] = text.match(/^(\s*)\S/) || [];
  const frontSpace = fullLineSpace.slice(0, start.character);
  const behindSpace = fullLineSpace.slice(start.character);

  const startOffset = offsetOf(start);
  pushInsert(edits, startOffset, `${behindSpace}${openTag}\n${frontSpace}${tabSize}`);

  const endOffset = offsetOf(end);
  pushInsert(edits, endOffset, `\n${fullLineSpace}${closeTag}`);

  const lastLineToIndent = end.character > 0 ? end.line : end.line - 1;
  for (let line = start.line + 1; line <= lastLineToIndent; line++) {
    if (!document.lineAt(line).range.isEmpty) {
      pushInsert(edits, offsetOf(new vscode.Position(line, 0)), tabSize);
    }
  }
}

export default async function tagsWrap(textEditor: vscode.TextEditor): Promise<void> {
  const { document, selections, options } = textEditor;
  if (selections.length === 0) return;

  const tagName = Configuration.TAG;
  const cleanedName = tagName.trim();
  // 空/纯空白配置回退到 div；标签名与属性均做 snippet 转义，防止 $、}、\ 破坏 Snippet 模板
  const openName = cleanedName.split(/\s+/)[0] || 'div';
  // openName 不在原配置中（空白回退场景）时属性为空，避免 indexOf 返回 -1 后 slice 截出尾部残留
  const tagStart = tagName.indexOf(openName);
  const restAttrs = tagStart >= 0 ? tagName.slice(tagStart + openName.length) : '';
  const tabSize = options.insertSpaces ? ' '.repeat(Number(options.tabSize || 2)) : '\t';
  const originalText = document.getText();
  const offsetOf = (pos: vscode.Position) => document.offsetAt(pos);

  const sortedSelections = [...selections].sort((a, b) => a.start.compareTo(b.start));
  const edits: OrderedEdit[] = [];

  sortedSelections.forEach((selection, index) => {
    const { start, end } = selection;
    const isEmpty = selection.isEmpty;
    const isSingleLine = start.line === end.line;
    const { text, range } = document.lineAt(start.line);

    const isLastChar = isEmpty && start.character === range.end.character && text.trim().length > 0;
    const tabIndex = index + 1;
    const openTag = `<\${${tabIndex}:${escapeSnippetText(openName)}}${escapeSnippetText(restAttrs)}>`;
    const closeTag = `</\$${tabIndex}>`;

    if (isEmpty) {
      if (isLastChar) {
        handleLastCharacter(document, selection, tabSize, openTag, closeTag, edits, offsetOf);
      } else {
        handleEmptyLine(start, openTag, closeTag, edits, offsetOf);
      }
    } else if (isSingleLine) {
      handleSingleLine(selection, openTag, closeTag, edits, offsetOf);
    } else {
      handleMultiLine(document, selection, tabSize, openTag, closeTag, edits, offsetOf);
    }
  });

  if (edits.length === 0) return;

  const minOffset = Math.min(...edits.map(e => e.start));
  const maxOffset = Math.max(...edits.map(e => e.end));
  const sortedEdits = [...edits].sort((a, b) => a.start - b.start || a.order - b.order);

  let snippetText = '';
  let cursor = minOffset;

  for (const edit of sortedEdits) {
    if (edit.start > cursor) {
      snippetText += escapeSnippetText(originalText.slice(cursor, edit.start));
    }
    snippetText += edit.text;
    cursor = edit.end;
  }
  if (maxOffset > cursor) {
    snippetText += escapeSnippetText(originalText.slice(cursor, maxOffset));
  }

  const spanRange = new vscode.Range(document.positionAt(minOffset), document.positionAt(maxOffset));
  await textEditor.insertSnippet(new vscode.SnippetString(snippetText), spanRange);
}
