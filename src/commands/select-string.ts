import { scanStringTokens } from '@/utils/quote';
import * as vscode from 'vscode';

/**
 * 光标位于字符串字面量内时，选中字符串内容（不含引号）；不在字符串内时保持原选区。
 * 支持多光标：每个光标独立找所在字符串；多个光标命中同一字符串时去重。
 * 复用 scanStringTokens 的注释/正则/模板感知扫描，避免误选注释或正则里的内容。
 */
export default function selectString(textEditor: vscode.TextEditor): void {
  const { document, selections } = textEditor;
  const text = document.getText();
  const tokens = scanStringTokens(text);

  const seen = new Set<string>();
  const nextSelections = selections.flatMap(selection => {
    const offset = document.offsetAt(selection.active);
    const token = tokens.find(t => offset >= t.start && offset <= t.end);
    if (!token) return [selection]; // 不在字符串内：保持原选区不动

    // 只选引号内的内容（token.start 是开引号，token.end 是闭引号后）
    const start = document.positionAt(token.start + 1);
    const end = document.positionAt(token.end - 1);
    const key = `${start.line}:${start.character}-${end.line}:${end.character}`;
    if (seen.has(key)) return []; // 多个光标命中同一字符串：只保留一个
    seen.add(key);
    return [new vscode.Selection(start, end)];
  });

  textEditor.selections = nextSelections;
}
