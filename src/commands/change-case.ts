import { Configuration } from '@/core/configuration';
import Editor from '@/core/editor';
import { wordTransformers } from '@/utils/case';
import { buildFinalText, positionAt, remapOffset, TextEdit } from '@/utils/edits';
import * as vscode from 'vscode';

interface TransformStep {
  pattern: string;
  replacement: string;
  flags?: string;
}

export function buildCustomTransformers(): Record<string, (text: string) => string> {
  const transformers: Record<string, (text: string) => string> = {};

  for (const [name, steps] of Object.entries(Configuration.CASE_CUSTOM)) {
    if (!name || !Array.isArray(steps)) continue;

    const rules = steps.filter(
      (step): step is TransformStep =>
        !!step && typeof step.pattern === 'string' && typeof step.replacement === 'string'
    );
    if (rules.length === 0) continue;

    try {
      const compiled = rules.map(step => ({
        regExp: new RegExp(step.pattern, step.flags ?? 'g'),
        replacement: step.replacement,
      }));
      transformers[name] = text =>
        compiled.reduce((acc, { regExp, replacement }) => acc.replace(regExp, replacement), text);
    } catch (error) {
      console.warn(`[zeta] 自定义格式「${name}」的正则无效，已跳过:`, error);
    }
  }
  return transformers;
}

function getSampleText(textEditor: vscode.TextEditor): string {
  const { selections, document } = textEditor;
  const hasNonEmpty = selections.some(s => !s.isEmpty);
  const activeSelections = hasNonEmpty ? selections.filter(s => !s.isEmpty) : selections;
  if (activeSelections.length > 1) return '';
  const selection = activeSelections[0];
  if (!selection) return '';

  const range = selection.isEmpty ? document.getWordRangeAtPosition(selection.active) : selection;
  return range ? document.getText(range) : '';
}

interface CaseQuickPickItem extends vscode.QuickPickItem {
  name: string;
}

interface SelectionRecord {
  start: number;
  end: number;
  isEmpty: boolean;
  relativeOffset?: number;
  wordRangeStart?: number;
  wordRangeEnd?: number;
}

export async function applyTransformerToSelections(
  textEditor: vscode.TextEditor,
  transformer: (text: string) => string,
  selectTransformed = false
): Promise<void> {
  const { selections, document } = textEditor;
  const editorEdit = new Editor(document.uri);
  const originalText = document.getText();
  const processedKeys = new Set<string>();
  const edits: TextEdit[] = [];
  const records: SelectionRecord[] = [];
  let hasChanges = false;

  const hasNonEmpty = selections.some(s => !s.isEmpty);

  for (const selection of selections) {
    if (hasNonEmpty && selection.isEmpty) {
      const offset = document.offsetAt(selection.active);
      records.push({ start: offset, end: offset, isEmpty: true });
      continue;
    }

    const range = selection.isEmpty ? document.getWordRangeAtPosition(selection.active) : selection;
    if (!range) {
      if (selection.isEmpty) {
        const offset = document.offsetAt(selection.active);
        records.push({ start: offset, end: offset, isEmpty: true });
      }
      continue;
    }

    const start = document.offsetAt(range.start);
    const end = document.offsetAt(range.end);
    const uniqueKey = `${range.start.line}-${range.start.character}-${range.end.line}-${range.end.character}`;

    if (processedKeys.has(uniqueKey)) {
      if (selection.isEmpty) {
        const activeOffset = document.offsetAt(selection.active);
        records.push({
          start: activeOffset,
          end: activeOffset,
          isEmpty: true,
          relativeOffset: activeOffset - start,
          wordRangeStart: start,
          wordRangeEnd: end,
        });
      }
      continue;
    }
    processedKeys.add(uniqueKey);

    const originalTextInRange = document.getText(range);
    const transformedText = transformer(originalTextInRange);

    if (originalTextInRange !== transformedText) {
      edits.push({ start, end, text: transformedText });
      hasChanges = true;
    }

    if (selection.isEmpty) {
      const activeOffset = document.offsetAt(selection.active);
      records.push({
        start: activeOffset,
        end: activeOffset,
        isEmpty: true,
        relativeOffset: activeOffset - start,
        wordRangeStart: start,
        wordRangeEnd: end,
      });
    } else {
      records.push({ start, end, isEmpty: false });
    }
  }

  if (hasChanges) {
    for (const edit of edits) {
      editorEdit.replace(new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text);
    }
    const applied = await editorEdit.apply();
    if (applied && selectTransformed) {
      textEditor.selections = remapSelections(document, originalText, edits, records);
    }
  } else if (selectTransformed && records.length > 0) {
    textEditor.selections = remapSelections(document, originalText, edits, records);
  }
}

function remapSelections(
  document: vscode.TextDocument,
  originalText: string,
  edits: TextEdit[],
  records: SelectionRecord[]
): vscode.Selection[] {
  const finalText = buildFinalText(originalText, edits);
  return records.map(record => {
    if (record.isEmpty) {
      if (record.relativeOffset !== undefined && record.wordRangeStart !== undefined) {
        const matchedEdit = edits.find(e => e.start === record.wordRangeStart);
        const mappedWordStart = remapOffset(record.wordRangeStart, edits);
        const newWordLength = matchedEdit ? matchedEdit.text.length : record.wordRangeEnd! - record.wordRangeStart;
        const newOffset = mappedWordStart + Math.min(record.relativeOffset, newWordLength);
        const pos = positionAt(finalText, newOffset);
        return new vscode.Selection(pos, pos);
      }
      const endPos = positionAt(finalText, remapOffset(record.end, edits));
      return new vscode.Selection(endPos, endPos);
    }
    const startPos = positionAt(finalText, remapOffset(record.start, edits));
    const endPos = positionAt(finalText, remapOffset(record.end, edits));
    return new vscode.Selection(startPos, endPos);
  });
}

export default async function changeCase(
  textEditor: vscode.TextEditor,
  _edit: vscode.TextEditorEdit,
  caseFromConfig?: string
) {
  const sampleText = getSampleText(textEditor);
  const transformers: Record<string, (text: string) => string> = { ...wordTransformers, ...buildCustomTransformers() };

  const transformerKey =
    caseFromConfig ??
    (await vscode.window
      .showQuickPick<CaseQuickPickItem>(
        Object.entries(transformers).map(([name, transform]) => {
          const preview = sampleText ? transform(sampleText) : '';
          return {
            label: preview.length > 0 ? preview : name,
            detail: preview.length > 0 ? name : undefined,
            name,
          };
        }),
        { placeHolder: sampleText ? `转换预览（基于「${sampleText}」）` : '选择单词转换格式' }
      )
      ?.then(picked => picked?.name));

  if (!transformerKey || !transformers[transformerKey]) return;
  await applyTransformerToSelections(textEditor, transformers[transformerKey], true);
}
