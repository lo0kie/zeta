import { Configuration } from '@/core/configuration';
import * as vscode from 'vscode';
import { applyTransformerToSelections, buildCustomTransformers } from './change-case';
import { BuiltinCaseName, splitWords, wordTransformers } from '@/utils/case';

const DEFAULT_CYCLE_ORDER: readonly BuiltinCaseName[] = [
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

  // 内置格式 + zeta.case.custom 自定义格式合并，循环顺序由 zeta.case.cycleOrder 配置
  // （默认即内置 5 项）；配置里不存在的格式名被过滤掉
  const transformers: Record<string, (text: string) => string> = { ...wordTransformers, ...buildCustomTransformers() };
  const cycleOrder = Configuration.CASE_CYCLE_ORDER.filter(name => transformers[name]);
  if (cycleOrder.length === 0) return;

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

  const currentIndex = cycleOrder.findIndex(name => transformers[name](sample) === sample);
  const nextName = cycleOrder[(currentIndex + 1 + cycleOrder.length) % cycleOrder.length];

  await applyTransformerToSelections(textEditor, transformers[nextName], true);
}
