import Editor from '@/classes/Editor';
import * as vscode from 'vscode';

// 零依赖正则转换引擎
const wordTransformers: Record<string, (text: string) => string> = {
  'Camel Case': s =>
    s.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, c => c.toLowerCase()),
  'Pascal Case': s =>
    s.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, c => c.toUpperCase()),
  'Kebab Case': s =>
    s
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase(),
  'Snake Case': s =>
    s
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[\s\-]+/g, '_')
      .toLowerCase(),
  'Upper Case': s => s.replace(/[-_\s]+/g, '').toUpperCase(),
  'Lower Case': s => s.replace(/[-_\s]+/g, '').toLowerCase(),
  'Title Case': s =>
    s.replace(/[-_\s]+(.)?/g, (_, c) => (c ? ' ' + c.toUpperCase() : '')).replace(/^./, c => c.toUpperCase()),
  'Dot Case': s =>
    s
      .replace(/([a-z])([A-Z])/g, '$1.$2')
      .replace(/[\s_-]+/g, '.')
      .toLowerCase(),
  'Path Case': s =>
    s
      .replace(/([a-z])([A-Z])/g, '$1/$2')
      .replace(/[\s_-]+/g, '/')
      .toLowerCase(),
};

export default async function changeCase(
  textEditor: vscode.TextEditor,
  _edit: vscode.TextEditorEdit,
  caseFromConfig?: string
) {
  const { selections, document } = textEditor;
  const transformerKey =
    caseFromConfig ??
    (await vscode.window.showQuickPick(Object.keys(wordTransformers), { placeHolder: '选择单词转换格式' }));

  if (!transformerKey || !wordTransformers[transformerKey]) return;
  const transformer = wordTransformers[transformerKey];

  const editorEdit = new Editor(document.uri);
  const processedKeys = new Set<string>();

  for (const selection of selections) {
    const range = selection.isEmpty ? document.getWordRangeAtPosition(selection.active) : selection;
    if (!range) continue;

    const uniqueKey = `${range.start.line}-${range.start.character}-${range.end.line}-${range.end.character}`;
    if (processedKeys.has(uniqueKey)) continue;
    processedKeys.add(uniqueKey);

    const originalText = document.getText(range);
    const transformedText = transformer(originalText);

    if (originalText !== transformedText) {
      editorEdit.replace(range, transformedText);
    }
  }

  await editorEdit.apply();
}
