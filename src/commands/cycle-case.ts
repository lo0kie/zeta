import * as vscode from 'vscode';
import { applyTransformerToSelections } from './change-case';
import { BuiltinCaseName, splitWords, wordTransformers } from '@/utils/case';

const CYCLE_ORDER: readonly BuiltinCaseName[] = [
  'Camel Case',
  'Kebab Case',
  'Pascal Case',
  'Snake Case',
  'Constant Case',
];

export default async function cycleCase(textEditor: vscode.TextEditor, _edit: vscode.TextEditorEdit): Promise<void> {
  const selection = textEditor.selections[0];
  if (!selection || selection.isEmpty) return;

  const sample = textEditor.document.getText(selection);
  if (!sample.trim()) return;

  const words = splitWords(sample);

  if (words.length <= 1) {
    let nextTransformer: (text: string) => string;
    if (sample === sample.toLowerCase()) {
      nextTransformer = wordTransformers['Pascal Case'];
    } else if (sample === sample.toUpperCase()) {
      nextTransformer = wordTransformers['Lower Case'];
    } else {
      nextTransformer = wordTransformers['Constant Case'];
    }
    await applyTransformerToSelections(textEditor, nextTransformer, true);
    return;
  }

  const currentIndex = CYCLE_ORDER.findIndex(name => wordTransformers[name](sample) === sample);
  const nextName = CYCLE_ORDER[(currentIndex + 1 + CYCLE_ORDER.length) % CYCLE_ORDER.length];

  await applyTransformerToSelections(textEditor, wordTransformers[nextName], true);
}
