import { Configuration } from '@/core/configuration';
import { wordTransformers } from '@/utils/case';
import * as vscode from 'vscode';
import { applyTransformerToSelections, buildCustomTransformers } from './change-case';

export default async function cycleCase(textEditor: vscode.TextEditor, _edit: vscode.TextEditorEdit): Promise<void> {
  const { selections, document } = textEditor;
  if (selections.length === 0) return;

  const hasNonEmpty = selections.some(s => !s.isEmpty);
  const targetSelections = hasNonEmpty ? selections.filter(s => !s.isEmpty) : selections;

  const first = targetSelections[0];
  const sampleRange = first.isEmpty ? document.getWordRangeAtPosition(first.active) : first;
  if (!sampleRange) return;

  const sample = document.getText(sampleRange);
  if (!sample.trim()) return;

  const transformers: Record<string, (text: string) => string> = { ...wordTransformers, ...buildCustomTransformers() };
  const cycleOrder = Configuration.CASE_CYCLE_ORDER.filter(name => transformers[name]);
  if (cycleOrder.length === 0) return;

  const currentIndex = cycleOrder.findIndex(name => transformers[name](sample) === sample);
  // 从下一个格式起找第一个能产生实际变化的格式；单字符/纯数字等在全部格式下都相同，
  // 循环一圈仍无变化则放弃，避免"按键无反应但选区被重映射"的假死行为
  let nextIndex = (currentIndex + 1 + cycleOrder.length) % cycleOrder.length;
  const loopStart = nextIndex;
  while (transformers[cycleOrder[nextIndex]](sample) === sample) {
    nextIndex = (nextIndex + 1) % cycleOrder.length;
    if (nextIndex === loopStart) return;
  }
  const nextName = cycleOrder[nextIndex];

  await applyTransformerToSelections(textEditor, transformers[nextName], true);
}
