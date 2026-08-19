import { Configuration } from '@/core/configuration';
import { TextEdit } from '@/utils/edits';
import * as vscode from 'vscode';

type OrderedEdit = TextEdit & { order: number };

/** 转义 Snippet 保留字符，防止标签名/属性/原文中的 $、}、\ 破坏 Snippet 模板 */
function escapeSnippetText(text: string): string {
  return text.replace(/[$}\\]/g, '\\$&');
}

/** 按出现顺序记录一次插入（order 用于同偏移量下的稳定排序） */
function pushInsert(edits: OrderedEdit[], offset: number, text: string): void {
  edits.push({ start: offset, end: offset, text, order: edits.length });
}

/** 空行/光标在行首：直接在光标处插入一对空标签 */
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

/** 光标在行尾（行尾非空）：标签换行包裹——开标签+缩进插到行首，闭标签插到行尾 */
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

/** 单选区内包裹：开头插开标签、结尾插闭标签 */
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

/** 多行选区：开标签独立成行并按选区起点对齐缩进，闭标签挂在最后一行，中间各行整体加一级缩进 */
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

  // 开标签从 start 行行首开始插入，snippet 显式带完整前导缩进。
  // 关键：spanRange 起点必须落在行首（而非 start 处）——VS Code 多行 snippet 会
  // 把「插入位置之前所在行的空白」作为基准追加到 snippet 每一行（首行除外），
  // 若起点在行中（如 < 前），原行前导会被二次叠加，导致整体缩进多出一级。
  const lineStartOffset = offsetOf(new vscode.Position(start.line, 0));
  pushInsert(edits, lineStartOffset, `${fullLineSpace}${openTag}\n${tabSize}`);

  const endOffset = offsetOf(end);
  pushInsert(edits, endOffset, `\n${fullLineSpace}${closeTag}`);

  // 给选区内其余行（空行除外）加一级缩进
  const lastLineToIndent = end.character > 0 ? end.line : end.line - 1;
  for (let line = start.line + 1; line <= lastLineToIndent; line++) {
    if (!document.lineAt(line).range.isEmpty) {
      pushInsert(edits, offsetOf(new vscode.Position(line, 0)), tabSize);
    }
  }
}

/**
 * 插入标签：用配置的标签（默认 div）包裹所有选区。
 * 空选区在行首插空标签、在行尾换行包裹整行；多选区 Tabstop 序号连续，支持 Tab 依次改名。
 * 标签名与属性做 Snippet 转义，空白配置回退 div。
 */
export default async function tagsWrap(textEditor: vscode.TextEditor): Promise<void> {
  const { document, selections, options } = textEditor;
  if (selections.length === 0) return;

  const tagName = Configuration.TAG;
  const cleanedName = tagName.trim();
  // 空/纯空白配置回退到 div；标签名与属性均做 snippet 转义，防止 $、}、\ 破坏 Snippet 模板
  const openName = cleanedName.split(/\s+/)[0] || 'div';
  // openName 不在原配置中（空白回退场景）时属性为空，避免 indexOf 返回 -1 后 slice 截出尾部残留
  const tagStart = tagName.indexOf(openName);
  // 属性部分：保留开标签名后的内容（含属性分隔用的前导空格，如 ' class="card"'）；
  // 去掉尾部空白——配置若带尾随空格（如 "div "），snippet 里标签名后会多出空格，
  // 选中标签名按 Tab 时会停在空格位置，干扰改名
  const restAttrs = tagStart >= 0 ? tagName.slice(tagStart + openName.length).replace(/\s+$/, '') : '';
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
    // 每个选区占三个 Tabstop：标签名（可改名，闭标签同步）→ 属性输入位（标签名后空格处）→ 开标签 > 右侧内容位。
    // Tab 顺序：$1 标签名 → $2 属性位 → $3 内容位 → $4 标签名 → $5 属性位 → $6 内容位 ……
    const nameTab = index * 3 + 1;
    const attrTab = index * 3 + 2;
    const contentTab = index * 3 + 3;
    const openTag = `<\${${nameTab}:${escapeSnippetText(openName)}}${escapeSnippetText(restAttrs)} \${${attrTab}}>\${${contentTab}}`;
    const closeTag = `</\$${nameTab}>`;

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
