import * as vscode from 'vscode';

export interface MatchedTagPair {
  openTagRange: vscode.Range;
  closeTagRange: vscode.Range;
  isMultiLine: boolean;
}

export function findEnclosingTags(
  document: vscode.TextDocument,
  position: vscode.Position
): MatchedTagPair | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const tagRegex = /<\/?([a-zA-Z0-9_-]+)(?:\s+[^>]*)?\/?>/g;
  const stack: { name: string; start: number; end: number }[] = [];
  const pairs: { open: { name: string; start: number; end: number }; close: { start: number; end: number } }[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const tagText = match[0];
    const tagName = match[1];
    const start = match.index;
    const end = start + tagText.length;
    if (tagText.endsWith('/>')) continue;
    if (tagText.startsWith('</')) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name.toLowerCase() === tagName.toLowerCase()) {
          const matchedOpen = stack[i];
          stack.splice(i, 1);
          pairs.push({ open: matchedOpen, close: { start, end } });
          break;
        }
      }
    } else {
      stack.push({ name: tagName, start, end });
    }
  }
  const enclosing = pairs
    .filter(p => p.open.start <= offset && p.close.end >= offset)
    .sort((a, b) => b.open.start - a.open.start || a.close.end - b.close.end)[0];
  if (!enclosing) return undefined;
  const openTagRange = new vscode.Range(
    document.positionAt(enclosing.open.start),
    document.positionAt(enclosing.open.end)
  );
  const closeTagRange = new vscode.Range(
    document.positionAt(enclosing.close.start),
    document.positionAt(enclosing.close.end)
  );
  return {
    openTagRange,
    closeTagRange,
    isMultiLine: openTagRange.start.line !== closeTagRange.end.line,
  };
}
