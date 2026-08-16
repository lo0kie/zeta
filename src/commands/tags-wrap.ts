import { Configuration } from '@/core/configuration';
import Editor from '@/core/editor';
import * as vscode from 'vscode';

/** 两个光标锚点：开/闭标签名的末尾位置，调用方前移 tagName.length 即得完整选区 */
type TagCursors = [openTagNameEnd: vscode.Position, closeTagNameEnd: vscode.Position];

/**
 * 已知开/闭标签 `<` 的起始列，计算两个标签名末尾锚点：
 * `<div|>` 名字末尾在 `<` 后第 1+n 列；`</div|>` 因多一个 `/`，在 `<` 后第 2+n 列。
 */
function tagNameCursors(openTagStart: vscode.Position, closeTagStart: vscode.Position, tagName: string): TagCursors {
  return [openTagStart.translate(0, 1 + tagName.length), closeTagStart.translate(0, 2 + tagName.length)];
}

/** 空选区且光标不在行尾：在光标处直接插入空标签对 */
function handleEmptyLine(selection: vscode.Selection, editor: Editor, tagName: string): TagCursors {
  const { start } = selection;

  // 单次原子插入整个标签对：不再依赖同位置多次 insert 的顺序保证
  editor.insert(start, `<${tagName}></${tagName}>`);

  // 锚点按单串索引计算：<div></div> 中开标签名末尾在 1+L，
  // 闭标签名从 4+L 开始（> < / 各占一列）、末尾在 4+2L
  return [
    start.translate(0, 1 + tagName.length),
    start.translate(0, 4 + tagName.length * 2),
  ];
}

/** 空选区且光标停在非空行行尾：整行内容下沉一级缩进并被包裹 */
function handleLastCharacter(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  editor: Editor,
  tabSize: string,
  tagName: string
): TagCursors {
  const { start, end } = selection;
  const { text } = document.lineAt(start.line);

  const [_, space = ''] = text.match(/^(\s*)\S/) || [];
  editor.insert(start.translate(0, -start.character), `${space}<${tagName}>\n${tabSize}`);
  editor.insert(end, `\n${space}</${tagName}>`);

  // 行首插入 space<tag>，开标签 `<` 在第 space.length 列；闭标签落在两行后的同等缩进处
  return tagNameCursors(
    new vscode.Position(start.line, space.length),
    new vscode.Position(start.line + 2, space.length),
    tagName
  );
}

/** 单行非空选区：左右直接包上标签 */
function handleSingleLine(selection: vscode.Selection, editor: Editor, tagName: string): TagCursors {
  const { start, end } = selection;

  editor.insert(start, `<${tagName}>`);
  editor.insert(end, `</${tagName}>`);

  // 闭标签插在原 end 处，因开标签插入整体右移 tagName.length + 2 列
  return tagNameCursors(start, end.translate(0, tagName.length + 2), tagName);
}

/** 多行选区：首尾包裹并把中间各行整体加深一级缩进 */
function handleMultiLine(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  editor: Editor,
  tabSize: string,
  tagName: string
): TagCursors {
  const { start, end } = selection;
  const { text } = document.lineAt(start.line);

  const [_, fullLineSpace = ''] = text.match(/^(\s*)\S/) || [];
  const frontSpace = fullLineSpace.slice(0, start.character);
  const behindSpace = fullLineSpace.slice(start.character);

  editor.insert(start, `${behindSpace}<${tagName}>\n${frontSpace}${tabSize}`);
  editor.insert(end, `\n${fullLineSpace}</${tagName}>`);

  // 空行不需要补缩进
  for (let line = start.line + 1; line <= end.line; line++) {
    if (!document.lineAt(line).range.isEmpty) {
      editor.insert(line, 0, tabSize);
    }
  }

  return tagNameCursors(
    start.translate(0, behindSpace.length),
    new vscode.Position(end.line + 2, fullLineSpace.length),
    tagName
  );
}

export default async function tagsWrap(textEditor: vscode.TextEditor) {
  const { document, selections, options } = textEditor;
  if (selections.length > 1) return;

  const selection = selections[0];
  const tagName = Configuration.TAG;
  const tabSize = options.insertSpaces ? ' '.repeat(Number(options.tabSize)) : '\t';
  const editor = new Editor(document.uri);

  const { start, isEmpty, isSingleLine } = selection;
  const { text, range } = document.lineAt(start.line);

  const cursors: TagCursors = isEmpty
    ? start.character === range.end.character && text.trim().length > 0
      ? handleLastCharacter(document, selection, editor, tabSize, tagName)
      : handleEmptyLine(selection, editor, tagName)
    : isSingleLine
      ? handleSingleLine(selection, editor, tagName)
      : handleMultiLine(document, selection, editor, tabSize, tagName);

  // 应用失败（文档并发变更等）时保持原选区，不强行挪动光标
  if (!(await editor.apply())) return;

  const [openTagNameEnd, closeTagNameEnd] = cursors;
  textEditor.selections = [
    new vscode.Selection(openTagNameEnd.translate(0, -tagName.length), openTagNameEnd),
    new vscode.Selection(closeTagNameEnd.translate(0, -tagName.length), closeTagNameEnd),
  ];
}
