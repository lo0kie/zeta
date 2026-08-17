import Editor from '@/core/editor';
import {
  convertConcatToTemplate,
  findConcatenationChain,
  getNextQuote,
  scanStringTokens,
  transformAttrQuotes,
  transformQuotes,
} from '@/utils/quote';
import * as vscode from 'vscode';

export default async function cycleQuotes(textEditor: vscode.TextEditor): Promise<void> {
  const { document, selections } = textEditor;
  const text = document.getText();
  const tokens = scanStringTokens(text);
  if (tokens.length === 0) return;

  const editor = new Editor(document.uri);
  const processedRanges: { start: number; end: number }[] = [];
  let hasChanges = false;
  const hasNonEmpty = selections.some(s => !s.isEmpty);

  for (const selection of selections) {
    if (hasNonEmpty && selection.isEmpty) continue;

    const selStart = document.offsetAt(selection.start);
    const selEnd = document.offsetAt(selection.end);

    const matched = tokens
      .filter(t =>
        selection.isEmpty
          ? t.start <= selStart && t.end >= selEnd
          : (t.start <= selStart && t.end >= selEnd) || (selStart <= t.start && selEnd >= t.end)
      )
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];

    if (!matched) continue;
    if (processedRanges.some(r => matched.start >= r.start && matched.end <= r.end)) continue;

    const line = document.lineAt(document.positionAt(matched.start).line);
    const lineStartOffset = document.offsetAt(line.range.start);
    const concatChain = findConcatenationChain(line.text, lineStartOffset, matched);

    let replaceStart = matched.start;
    let replaceEnd = matched.end;
    let newText = '';

    const nextQuote = getNextQuote(matched.quote, matched.enclosingQuote, matched.isAttrQuote, matched.isObjectKey);
    if (!nextQuote || nextQuote === matched.quote) continue;

    const rawText = text.slice(matched.start, matched.end);

    if (matched.isAttrQuote) {
      newText = transformAttrQuotes(rawText, matched.quote, nextQuote);
    } else if (concatChain && nextQuote === '`') {
      replaceStart = concatChain.start;
      replaceEnd = concatChain.end;
      newText = convertConcatToTemplate(concatChain.raw);
    } else {
      newText = transformQuotes(rawText, matched.quote, nextQuote);
    }

    processedRanges.push({ start: replaceStart, end: replaceEnd });
    editor.replace(new vscode.Range(document.positionAt(replaceStart), document.positionAt(replaceEnd)), newText);
    hasChanges = true;
  }

  if (hasChanges) await editor.apply();
}
