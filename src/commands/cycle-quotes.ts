import Editor from '@/core/editor';
import {
  QUOTE_ORDER,
  convertConcatToTemplate,
  findConcatenationChain,
  scanStringTokens,
  transformQuotes,
} from '@/utils/quote';
import * as vscode from 'vscode';

export default async function cycleQuotes(textEditor: vscode.TextEditor): Promise<void> {
  const { document, selections } = textEditor;
  const text = document.getText();
  const tokens = scanStringTokens(text);
  if (tokens.length === 0) return;

  const editor = new Editor(document.uri);
  const processedOffsets = new Set<number>();
  let hasChanges = false;

  for (const selection of selections) {
    const selStart = document.offsetAt(selection.start);
    const selEnd = document.offsetAt(selection.end);

    const matched = tokens
      .filter(t =>
        selection.isEmpty
          ? t.start <= selStart && t.end >= selEnd
          : (t.start <= selStart && t.end >= selEnd) || (selStart <= t.start && selEnd >= t.end)
      )
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];

    if (!matched || processedOffsets.has(matched.start)) continue;

    const line = document.lineAt(document.positionAt(matched.start).line);
    const lineStartOffset = document.offsetAt(line.range.start);
    const concatChain = findConcatenationChain(line.text, lineStartOffset, matched);

    let replaceStart = matched.start;
    let replaceEnd = matched.end;
    let newText = '';

    const currentIndex = QUOTE_ORDER.indexOf(matched.quote as (typeof QUOTE_ORDER)[number]);
    if (currentIndex === -1) continue;

    const nextQuote = QUOTE_ORDER[(currentIndex + 1) % QUOTE_ORDER.length];

    if (concatChain && nextQuote === '`') {
      replaceStart = concatChain.start;
      replaceEnd = concatChain.end;
      newText = convertConcatToTemplate(concatChain.raw);
    } else {
      const rawText = text.slice(matched.start, matched.end);
      newText = transformQuotes(rawText, matched.quote, nextQuote);
    }

    processedOffsets.add(replaceStart);
    editor.replace(new vscode.Range(document.positionAt(replaceStart), document.positionAt(replaceEnd)), newText);
    hasChanges = true;
  }

  if (hasChanges) await editor.apply();
}
