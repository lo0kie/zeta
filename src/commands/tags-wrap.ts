import Editor from '@/classes/Editor';
import { Configuration } from '@/utils/configuration';
import * as vscode from 'vscode';

type TagWrapResult = [start: vscode.Position, end: vscode.Position];

function handleEmptyLine(selection: vscode.Selection, editor: Editor): TagWrapResult {
  const { start } = selection;
  const tagName = Configuration.TAG;

  editor.insert(start, `<${tagName}>`);
  editor.insert(start, `</${tagName}>`);

  return [start.translate(0, 1 + tagName.length), start.translate(0, 1 + tagName.length * 2 + 3)];
}

function handleLastCharacter(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  editor: Editor,
  tabSize: string
): TagWrapResult {
  const { start, end } = selection;
  const tagName = Configuration.TAG;
  const { text } = document.lineAt(start.line);

  const [_, space = ''] = text.match(/^(\s*)\S/) || [];
  editor.insert(start.translate(0, -start.character), `${space}<${tagName}>\n${tabSize}`);
  editor.insert(end, `\n${space}</${tagName}>`);

  return [
    new vscode.Position(start.line, space.length + 1 + tagName.length),
    new vscode.Position(start.line + 2, space.length + 2 + tagName.length),
  ];
}

function handleSingleLine(selection: vscode.Selection, editor: Editor): TagWrapResult {
  const { start, end } = selection;
  const tagName = Configuration.TAG;
  editor.insert(start, `<${tagName}>`);
  editor.insert(end, `</${tagName}>`);

  return [
    new vscode.Position(start.line, start.character + 1 + tagName.length),
    new vscode.Position(end.line, end.character + 2 + tagName.length * 2 + 2),
  ];
}

function handleMultiLine(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  editor: Editor,
  tabSize: string
): TagWrapResult {
  const { start, end } = selection;
  const tagName = Configuration.TAG;
  const { text } = document.lineAt(start.line);

  const [_, fullLineSpace = ''] = text.match(/^(\s*)\S/) || [];
  const frontSpace = fullLineSpace.slice(0, start.character);
  const behindSpace = fullLineSpace.slice(start.character);

  editor.insert(start, `${behindSpace}<${tagName}>\n${frontSpace}${tabSize}`);
  editor.insert(end, `\n${fullLineSpace}</${tagName}>`);

  const lineCount = Math.abs(start.line - end.line);
  for (let i = 0; i < lineCount; i++) {
    const currentLine = start.line + i + 1;
    const { range } = document.lineAt(currentLine);
    if (!range.isEmpty) {
      editor.insert(currentLine, 0, tabSize);
    }
  }

  return [
    start.translate(0, behindSpace.length + tagName.length + 1),
    new vscode.Position(end.line + 2, fullLineSpace.length + tagName.length + 2),
  ];
}

export default async function tagsWrap(textEditor: vscode.TextEditor) {
  const { document, selections, options } = textEditor;
  if (selections.length > 1) return;

  const selection = selections[0];
  const editor = new Editor(document.uri);
  const tabSize = options.insertSpaces ? ' '.repeat(Number(options.tabSize)) : '\t';
  const tagName = Configuration.TAG;

  let targetPositions: TagWrapResult;

  const { start, isEmpty, isSingleLine } = selection;
  const { text, range } = document.lineAt(start.line);

  if (isEmpty) {
    if (start.character === range.end.character && text.trim().length > 0) {
      targetPositions = handleLastCharacter(document, selection, editor, tabSize);
    } else {
      targetPositions = handleEmptyLine(selection, editor);
    }
  } else if (isSingleLine) {
    targetPositions = handleSingleLine(selection, editor);
  } else {
    targetPositions = handleMultiLine(document, selection, editor, tabSize);
  }

  await editor.apply();
  const [startTag, endTag] = targetPositions;
  textEditor.selections = [
    new vscode.Selection(startTag.translate(0, -tagName.length), startTag),
    new vscode.Selection(endTag.translate(0, -tagName.length), endTag),
  ];
}
