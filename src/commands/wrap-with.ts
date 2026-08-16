import Editor from '@/core/editor';
import * as vscode from 'vscode';

// 取选区；空选区时回落为当前整行（空行放弃）
function resolveTargetRange(textEditor: vscode.TextEditor): vscode.Range | undefined {
  const { selections, document } = textEditor;
  const selection = selections[0];
  if (!selection) return undefined;
  if (!selection.isEmpty) return selection;

  const line = document.lineAt(selection.active.line);
  return line.range.isEmpty ? undefined : line.range;
}

/** 把选区扩展为覆盖首末行整行：非整行选区（起始列 > 0）自带行首缩进，
 *  直接替换会让模板首行的 baseIndent 与行首缩进叠加导致排版错位 */
function expandToFullLines(document: vscode.TextDocument, range: vscode.Range): vscode.Range {
  const startLine = document.lineAt(range.start.line);
  const endLine = document.lineAt(range.end.line);
  return new vscode.Range(startLine.range.start, endLine.range.end);
}

function indentUnit(options: vscode.TextEditorOptions): string {
  return options.insertSpaces ? ' '.repeat(Number(options.tabSize)) : '\t';
}

function leadingIndent(text: string): string {
  return text.match(/^[\t ]*/)?.[0] ?? '';
}

/** 整体替换选区并把光标/选区定位到新文本的指定锚点 */
async function replaceAndSelect(
  textEditor: vscode.TextEditor,
  range: vscode.Range,
  newText: string,
  anchor?: vscode.Position | vscode.Range
): Promise<void> {
  const editor = new Editor(textEditor.document.uri);
  editor.replace(range, newText);
  if (!(await editor.apply())) return;

  if (anchor) {
    const selection =
      anchor instanceof vscode.Position
        ? new vscode.Selection(anchor, anchor)
        : new vscode.Selection(anchor.start, anchor.end);
    textEditor.selections = [selection];
    textEditor.revealRange(selection);
  }
}

/** 选区整体加深一级缩进：每行在自身缩进基础上加一级（首行缩进已含在 range 文本里，不再额外叠加） */
function indentBody(text: string, unit: string): string {
  return text
    .split('\n')
    .map(line => (line.trim().length === 0 ? line : unit + line))
    .join('\n');
}

/** 包裹为 console.log(...)，光标落在左括号后 */
export async function wrapWithConsole(textEditor: vscode.TextEditor): Promise<void> {
  const range = resolveTargetRange(textEditor);
  if (!range) return;

  const text = textEditor.document.getText(range);
  const cursor = range.start.translate(0, 'console.log('.length);
  await replaceAndSelect(textEditor, range, `console.log(${text})`, cursor);
}

/** 包裹为 try/catch，光标落在 catch 块内等待输入处理逻辑 */
export async function wrapWithTryCatch(textEditor: vscode.TextEditor): Promise<void> {
  const rawRange = resolveTargetRange(textEditor);
  if (!rawRange) return;

  const { document, options } = textEditor;
  // 非整行选区先扩展为整行，避免模板首行 baseIndent 与行首缩进叠加
  const range = expandToFullLines(document, rawRange);
  const unit = indentUnit(options);
  const baseIndent = leadingIndent(document.lineAt(range.start.line).text);
  // body 每行只加一级缩进：首行已含自身 baseIndent（整行 range），wrapped 首行补 baseIndent
  const body = indentBody(document.getText(range), unit);

  const wrapped = `${baseIndent}try {\n${body}\n${baseIndent}} catch (error) {\n${baseIndent}${unit}\n${baseIndent}}`;
  // wrapped 结构：try 头(1) + body(n) + catch 头(1)，光标落在 catch 块的占位行
  const bodyLineCount = body.split('\n').length;
  const cursor = new vscode.Position(range.start.line + bodyLineCount + 2, (baseIndent + unit).length);

  await replaceAndSelect(textEditor, range, wrapped, cursor);
}

/** 包裹为 if 语句，自动选中条件占位符 true 便于直接输入 */
export async function wrapWithIf(textEditor: vscode.TextEditor): Promise<void> {
  const rawRange = resolveTargetRange(textEditor);
  if (!rawRange) return;

  const { document, options } = textEditor;
  // 非整行选区先扩展为整行，避免模板首行 baseIndent 与行首缩进叠加
  const range = expandToFullLines(document, rawRange);
  const unit = indentUnit(options);
  const baseIndent = leadingIndent(document.lineAt(range.start.line).text);
  const body = indentBody(document.getText(range), unit);

  const wrapped = `${baseIndent}if (true) {\n${body}\n${baseIndent}}`;
  // "if (" 占 4 列，true 为 baseIndent 之后 4~8 列（替换后行首被 baseIndent 顶开）
  const condition = new vscode.Range(
    range.start.translate(0, baseIndent.length + 4),
    range.start.translate(0, baseIndent.length + 8)
  );

  await replaceAndSelect(textEditor, range, wrapped, condition);
}
