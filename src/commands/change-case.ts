import { Configuration } from '@/core/configuration';
import Editor from '@/core/editor';
import { wordTransformers } from '@/utils/case';
import { SelectionRecord, TextEdit, remapSelections } from '@/utils/edits';
import * as vscode from 'vscode';

/** 自定义转换的一步：pattern(正则) → replacement(替换串)，可选 flags（默认 g） */
interface TransformStep {
  pattern: string;
  replacement: string;
  flags?: string;
}

/**
 * 把配置 `zeta.case.custom` 编译成可用的转换函数表。
 * 非法正则会跳过并警告，不打断其余格式。
 */
export function buildCustomTransformers(): Record<string, (text: string) => string> {
  const transformers: Record<string, (text: string) => string> = {};

  for (const [name, steps] of Object.entries(Configuration.CASE_CUSTOM)) {
    if (!name || !Array.isArray(steps)) continue;

    // 只保留字段完整（pattern + replacement 均为字符串）的步骤
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
      // 步骤按配置顺序依次作用于文本
      transformers[name] = text =>
        compiled.reduce((acc, { regExp, replacement }) => acc.replace(regExp, replacement), text);
    } catch (error) {
      console.warn(`[zeta] 自定义格式「${name}」的正则无效，已跳过:`, error);
    }
  }
  return transformers;
}

/** 取用于 QuickPick 预览的样本：单选区（空选区取光标所在单词）才返回文本，多选区或跨行选区不预览 */
function getSampleText(textEditor: vscode.TextEditor): string {
  const { selections, document } = textEditor;
  const hasNonEmpty = selections.some(s => !s.isEmpty);
  const activeSelections = hasNonEmpty ? selections.filter(s => !s.isEmpty) : selections;
  if (activeSelections.length > 1) return '';
  const selection = activeSelections[0];
  if (!selection) return '';

  const range = selection.isEmpty ? document.getWordRangeAtPosition(selection.active) : selection;
  // 跨行选区不提供预览样本：与跨行不转换的语义一致
  if (!range || (!selection.isEmpty && range.start.line !== range.end.line)) return '';
  return document.getText(range);
}

interface CaseQuickPickItem extends vscode.QuickPickItem {
  name: string;
}

/**
 * 对全部选区应用统一的转换函数。
 * 见 applySelections 的说明；这是「所有选区共用同一转换器」的便捷包装。
 */
export async function applyTransformerToSelections(
  textEditor: vscode.TextEditor,
  transformer: (text: string) => string,
  selectTransformed = false
): Promise<void> {
  await applySelections(textEditor, () => transformer, selectTransformed);
}

/**
 * 对全部选区应用「逐选区解析出的转换函数」。
 * - 空光标选区：取光标所在单词转换，保持单点光标（不扩选）；
 * - 非空选区与空光标共存时，只转换非空选区，空光标仅保留位置；
 * - 同行多选区：前一个替换变长/变短后，后一个选区按最终文本重算偏移；
 * - 相同范围的重复选区只处理一次；
 * - resolveTransformer 对每个选区独立调用：返回 undefined 表示该选区不转换（仅记录位置）。
 *   多光标循环格式（cycleCase）依赖此能力——每个选区按自身文本计算循环步进，互不干扰。
 */
export async function applySelections(
  textEditor: vscode.TextEditor,
  resolveTransformer: (
    selection: vscode.Selection,
    range: vscode.Range,
    text: string
  ) => ((text: string) => string) | undefined,
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
    // 空光标选区在存在非空选区时不参与转换，只记录位置供后续重算
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

    // 非空选区跨行（起点与终点不在同一行）不转换，仅记录位置：跨行选区的语义是整段
    // 多行文本，对其套用单词格式转换会改动换行与空白、结果不可预期。空光标选区经
    // getWordRangeAtPosition 取词天然不跨行，无需处理。
    if (!selection.isEmpty && range.start.line !== range.end.line) {
      records.push({ start, end, isEmpty: false, reversed: selection.isReversed });
      continue;
    }

    const uniqueKey = `${range.start.line}-${range.start.character}-${range.end.line}-${range.end.character}`;

    // 同一范围的重复选区（多光标落在同一单词）只转换一次，但空光标位置照常记录
    if (processedKeys.has(uniqueKey)) {
      if (selection.isEmpty) {
        const activeOffset = document.offsetAt(selection.active);
        records.push({
          start: activeOffset,
          end: activeOffset,
          isEmpty: true,
          relativeOffset: activeOffset - start,
          replaceStart: start,
          replaceLength: end - start,
        });
      }
      continue;
    }
    processedKeys.add(uniqueKey);

    const originalTextInRange = document.getText(range);
    const transformer = resolveTransformer(selection, range, originalTextInRange);

    // 无可用转换（如循环一圈无变化）的选区：仅记录位置，不产生编辑
    if (!transformer) {
      if (selection.isEmpty) {
        const activeOffset = document.offsetAt(selection.active);
        records.push({ start: activeOffset, end: activeOffset, isEmpty: true });
      } else {
        records.push({ start, end, isEmpty: false, reversed: selection.isReversed });
      }
      continue;
    }

    const transformedText = transformer(originalTextInRange);

    // 无变化的选区不产生编辑
    if (originalTextInRange !== transformedText) {
      edits.push({ start, end, text: transformedText });
      hasChanges = true;
    }

    if (selection.isEmpty) {
      // 空光标：记录相对单词起点的偏移，编辑后映射回新位置（夹在单词长度内）
      const activeOffset = document.offsetAt(selection.active);
      records.push({
        start: activeOffset,
        end: activeOffset,
        isEmpty: true,
        relativeOffset: activeOffset - start,
        replaceStart: start,
        replaceLength: end - start,
      });
    } else {
      records.push({ start, end, isEmpty: false, reversed: selection.isReversed });
    }
  }

  if (hasChanges) {
    for (const edit of edits) {
      editorEdit.replace(new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text);
    }
    const applied = await editorEdit.apply();
    if (applied && selectTransformed) {
      textEditor.selections = remapSelections(originalText, edits, records);
    }
  } else if (selectTransformed && records.length > 0) {
    // 全部无变化（如已处于目标格式）：仍按记录重放选区
    textEditor.selections = remapSelections(originalText, edits, records);
  }
}

/**
 * 修改单词格式命令：无参数时弹 QuickPick 预览并选择格式，有参数（如循环命令传入）直接应用。
 * 应用后自动重选转换结果，方便连续操作。
 */
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
