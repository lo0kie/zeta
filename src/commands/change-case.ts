import { Configuration } from '@/core/configuration';
import Editor from '@/core/editor';
import * as vscode from 'vscode';

interface TransformStep {
  pattern: string;
  replacement: string;
  flags?: string;
}

// 零依赖正则转换引擎（按使用频率排序，Upper/Lower 优先）
const wordTransformers: Record<string, (text: string) => string> = {
  'Upper Case': s => s.replace(/[-_\s]+/g, '').toUpperCase(),
  'Lower Case': s => s.replace(/[-_\s]+/g, '').toLowerCase(),
  'Camel Case': s =>
    s.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, c => c.toLowerCase()),
  'Pascal Case': s =>
    s.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, c => c.toUpperCase()),
  'Snake Case': s =>
    s
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[\s\-]+/g, '_')
      .toLowerCase(),
  'Constant Case': s =>
    s
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[\s\-]+/g, '_')
      .toUpperCase(),
  'Kebab Case': s =>
    s
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase(),
  'Header Case': s =>
    s
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[-_\s]+/g, '-')
      .replace(/(^|-)([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase()),
  'Title Case': s =>
    s.replace(/[-_\s]+(.)?/g, (_, c) => (c ? ' ' + c.toUpperCase() : '')).replace(/^./, c => c.toUpperCase()),
  'Sentence Case': s => {
    const normalized = s
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_\s]+/g, ' ')
      .trim()
      .toLowerCase();
    return normalized.replace(/^./, c => c.toUpperCase());
  },
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

/**
 * 从 zeta.case.custom 配置构建自定义转换器；
 * 结构非法或正则编译失败的条目跳过并告警，不影响其余格式。
 */
function buildCustomTransformers(): Record<string, (text: string) => string> {
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

export default async function changeCase(
  textEditor: vscode.TextEditor,
  _edit: vscode.TextEditorEdit,
  caseFromConfig?: string
) {
  const { selections, document } = textEditor;
  const sampleText = getSampleText(textEditor);
  const transformers = { ...wordTransformers, ...buildCustomTransformers() };

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
  const transformer = transformers[transformerKey];

  const editorEdit = new Editor(document.uri);
  const processedKeys = new Set<string>();
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
  }

  // 所有选区都无需转换时跳过空提交
  if (hasChanges) await editorEdit.apply();
}
