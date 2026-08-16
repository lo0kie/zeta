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

/** 选区整体加深一级缩进：首行补基础缩进，其余行保留自身缩进再加一级 */
function indentBody(text: string, baseIndent: string, unit: string): string {
  return text
    .split('\n')
    .map((line, index) => (line.trim().length === 0 ? line : (index === 0 ? baseIndent : '') + unit + line))
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
  const range = resolveTargetRange(textEditor);
  if (!range) return;

  const { document, options } = textEditor;
  const unit = indentUnit(options);
  const baseIndent = leadingIndent(document.lineAt(range.start.line).text);
  const body = indentBody(document.getText(range), baseIndent, unit);

  const wrapped = `try {\n${body}\n${baseIndent}} catch (error) {\n${baseIndent}${unit}\n${baseIndent}}`;
  // wrapped 结构：try 头(1) + body(n) + catch 头(1)，光标落在 catch 块的占位行
  const bodyLineCount = body.split('\n').length;
  const cursor = new vscode.Position(range.start.line + bodyLineCount + 2, (baseIndent + unit).length);

  await replaceAndSelect(textEditor, range, wrapped, cursor);
}

/** 包裹为 if 语句，自动选中条件占位符 true 便于直接输入 */
export async function wrapWithIf(textEditor: vscode.TextEditor): Promise<void> {
  const range = resolveTargetRange(textEditor);
  if (!range) return;

  const { document, options } = textEditor;
  const unit = indentUnit(options);
  const baseIndent = leadingIndent(document.lineAt(range.start.line).text);
  const body = indentBody(document.getText(range), baseIndent, unit);

  const wrapped = `if (true) {\n${body}\n${baseIndent}}`;
  // "if (" 占 4 列，true 为 4~8 列
  const condition = new vscode.Range(range.start.translate(0, 4), range.start.translate(0, 8));

  await replaceAndSelect(textEditor, range, wrapped, condition);
}
