import { indentUnit, leadingIndent } from '@/utils/edits';
import * as vscode from 'vscode';

/** 把选区扩展到整行：起点取行首，终点若恰好在下行行首则钳回上一行行尾 */
function expandToFullLines(document: vscode.TextDocument, range: vscode.Range): vscode.Range {
  const startLine = document.lineAt(range.start.line);
  // 如果选区刚好结束于下一行的行首，将其钳制回上一行
  const endLineNum =
    range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
  const endLine = document.lineAt(endLineNum);
  return new vscode.Range(startLine.range.start, endLine.range.end);
}

/** 给每行（空行除外）加统一缩进；行尾按原文的 \r\n / \n 保持，避免 CRLF 文件被改写 */
function indentBody(text: string, unit: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return text
    .split(/\r?\n/)
    .map(line => (line.trim().length === 0 ? line : unit + line))
    .join(eol);
}

/** 转义 Snippet 语法保留字符（$、}、\），防止原代码内容被 Snippet 引擎误解析 */
function escapeSnippetText(text: string): string {
  return text.replace(/[$}\\]/g, '\\$&');
}

/**
 * 收集要包裹的选区：非空选区直接用；空选区取整行；存在非空选区时空光标跳过。
 * 按起点排序并合并重叠区间（多光标跨行时避免重复包裹同一段）。
 */
function getTargetRanges(textEditor: vscode.TextEditor, expandFull: boolean): vscode.Range[] {
  const { selections, document } = textEditor;
  const rawRanges: vscode.Range[] = [];
  const hasNonEmpty = selections.some(s => !s.isEmpty);

  for (const sel of selections) {
    if (hasNonEmpty && sel.isEmpty) continue;
    let range: vscode.Range | undefined;
    if (!sel.isEmpty) {
      range = sel;
    } else {
      const line = document.lineAt(sel.active.line);
      if (!line.range.isEmpty) {
        range = line.range;
      }
    }
    if (range) {
      rawRanges.push(expandFull ? expandToFullLines(document, range) : range);
    }
  }

  if (rawRanges.length === 0) return [];

  rawRanges.sort((a, b) => a.start.compareTo(b.start));
  const merged: vscode.Range[] = [rawRanges[0]];

  for (let i = 1; i < rawRanges.length; i++) {
    const current = rawRanges[i];
    const last = merged[merged.length - 1];
    if (current.start.compareTo(last.end) <= 0) {
      if (current.end.compareTo(last.end) > 0) {
        merged[merged.length - 1] = new vscode.Range(last.start, current.end);
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * 包裹 console.log：每个选区生成 `console.log(<内容>$N)`，N 为 Tabstop 序号（多选区连续 Tab 导航）。
 * 选区文本去掉首尾空白与多余分号，光标落在右括号前。
 */
export async function wrapWithConsole(textEditor: vscode.TextEditor): Promise<void> {
  const { document } = textEditor;
  const ranges = getTargetRanges(textEditor, false);
  if (ranges.length === 0) return;

  let snippetText = '';
  let lastPos = ranges[0].start;

  ranges.forEach((range, index) => {
    if (range.start.compareTo(lastPos) > 0) {
      const gapText = document.getText(new vscode.Range(lastPos, range.start));
      snippetText += escapeSnippetText(gapText);
    }

    const baseIndent = range.start.character === 0 ? leadingIndent(document.lineAt(range.start.line).text) : '';
    const rawText = document.getText(range);
    const text = rawText.trim().replace(/;+$/, '');
    const tabIndex = index + 1;

    snippetText += `${baseIndent}console.log(${escapeSnippetText(text)}\$${tabIndex})`;
    lastPos = range.end;
  });

  const spanRange = new vscode.Range(ranges[0].start, ranges[ranges.length - 1].end);
  await textEditor.insertSnippet(new vscode.SnippetString(snippetText), spanRange);
}

/**
 * 包裹 try/catch：整行展开，body 统一缩进一级；Tabstop 依次为 error 名、body 内容。
 * 保持原文行尾（CRLF 安全）。
 */
export async function wrapWithTryCatch(textEditor: vscode.TextEditor): Promise<void> {
  const { document, options } = textEditor;
  const ranges = getTargetRanges(textEditor, true);
  if (ranges.length === 0) return;

  const unit = indentUnit(options);
  let snippetText = '';
  let lastPos = ranges[0].start;

  ranges.forEach((range, index) => {
    if (range.start.compareTo(lastPos) > 0) {
      const gapText = document.getText(new vscode.Range(lastPos, range.start));
      snippetText += escapeSnippetText(gapText);
    }

    const baseIndent = leadingIndent(document.lineAt(range.start.line).text);
    const body = indentBody(document.getText(range), unit);
    const tabError = index * 2 + 1;
    const tabBody = index * 2 + 2;

    snippetText += `${baseIndent}try {\n${escapeSnippetText(body)}\n${baseIndent}} catch (\${${tabError}:error}) {\n${baseIndent}${unit}\$${tabBody}\n${baseIndent}}`;
    lastPos = range.end;
  });

  const spanRange = new vscode.Range(ranges[0].start, ranges[ranges.length - 1].end);
  await textEditor.insertSnippet(new vscode.SnippetString(snippetText), spanRange);
}

/**
 * 包裹 if：整行展开，body 统一缩进；Tabstop 依次为条件（默认 true）、body 内容。
 */
export async function wrapWithIf(textEditor: vscode.TextEditor): Promise<void> {
  const { document, options } = textEditor;
  const ranges = getTargetRanges(textEditor, true);
  if (ranges.length === 0) return;

  const unit = indentUnit(options);
  let snippetText = '';
  let lastPos = ranges[0].start;

  ranges.forEach((range, index) => {
    if (range.start.compareTo(lastPos) > 0) {
      const gapText = document.getText(new vscode.Range(lastPos, range.start));
      snippetText += escapeSnippetText(gapText);
    }

    const baseIndent = leadingIndent(document.lineAt(range.start.line).text);
    const body = indentBody(document.getText(range), unit);
    const tabIndex = index + 1;

    snippetText += `${baseIndent}if (\${${tabIndex}:true}) {\n${escapeSnippetText(body)}\n${baseIndent}}`;
    lastPos = range.end;
  });

  const spanRange = new vscode.Range(ranges[0].start, ranges[ranges.length - 1].end);
  await textEditor.insertSnippet(new vscode.SnippetString(snippetText), spanRange);
}
