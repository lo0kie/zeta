import { Configuration } from '@/core/configuration';
import Editor from '@/core/editor';
import { wordTransformers } from '@/utils/case';
import * as vscode from 'vscode';

interface TransformStep {
  pattern: string;
  replacement: string;
  flags?: string;
}

/**
 * 从 zeta.case.custom 配置构建自定义转换器；
 * 结构非法或正则编译失败的条目跳过并告警，不影响其余格式。
 * 导出供 cycleCase 复用同一套自定义格式。
 */
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

// 取主选区（或光标所在单词）的文本，作为 QuickPick 预览的样本
function getSampleText(textEditor: vscode.TextEditor): string {
  const { selections, document } = textEditor;
  const selection = selections[0];
  if (!selection) return '';

  const range = selection.isEmpty ? document.getWordRangeAtPosition(selection.active) : selection;
  return range ? document.getText(range) : '';
}

interface CaseQuickPickItem extends vscode.QuickPickItem {
  name: string;
}

/** 把转换器应用到全部选区（空选区取光标所在单词，多光标去重） */
export async function applyTransformerToSelections(
  textEditor: vscode.TextEditor,
  transformer: (text: string) => string,
  selectTransformed = false
): Promise<void> {
  const { selections, document } = textEditor;
  const editorEdit = new Editor(document.uri);
  const processedKeys = new Set<string>();
  const updatedSelections: vscode.Selection[] = [];
  let hasChanges = false;
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
      hasChanges = true;
    }
    const endPosition =
      range.start.line === range.end.line ? range.start.translate(0, transformedText.length) : range.end;
    updatedSelections.push(new vscode.Selection(range.start, endPosition));
  }
  if (hasChanges) {
    const applied = await editorEdit.apply();
    if (applied && selectTransformed && updatedSelections.length > 0) {
      textEditor.selections = updatedSelections;
    }
  } else if (selectTransformed && updatedSelections.length > 0) {
    textEditor.selections = updatedSelections;
  }
}

export default async function changeCase(
  textEditor: vscode.TextEditor,
  _edit: vscode.TextEditorEdit,
  caseFromConfig?: string
) {
  const sampleText = getSampleText(textEditor);
  const transformers: Record<string, (text: string) => string> = { ...wordTransformers, ...buildCustomTransformers() };

  // 主标题展示转换结果，副标题展示格式名；按格式名回查转换器
  const transformerKey =
    caseFromConfig ??
    (await vscode.window
      .showQuickPick<CaseQuickPickItem>(
        Object.entries(transformers).map(([name, transform]) => {
          const preview = transform(sampleText);
          return { label: preview.length > 0 ? preview : name, detail: name, name };
        }),
        { placeHolder: sampleText ? `转换预览（基于「${sampleText}」）` : '选择单词转换格式' }
      )
      ?.then(picked => picked?.name));

  if (!transformerKey || !transformers[transformerKey]) return;
  await applyTransformerToSelections(textEditor, transformers[transformerKey], true);
}
