import { Configuration } from '@/core/configuration';
import Editor from '@/core/editor';
import { wordTransformers } from '@/utils/case';
import { buildFinalText, positionAt, remapOffset, TextEdit } from '@/utils/edits';
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

/** 取用于 QuickPick 预览的样本：单选区（空选区取光标所在单词）才返回文本，多选区不预览 */
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

/** 选区处理记录：用于编辑后按最终文本重算选区位置 */
interface SelectionRecord {
  start: number;
  end: number;
  isEmpty: boolean;
  relativeOffset?: number;
  wordRangeStart?: number;
  wordRangeEnd?: number;
}

/**
 * 对全部选区应用转换函数。
 * - 空光标选区：取光标所在单词转换，保持单点光标（不扩选）；
 * - 非空选区与空光标共存时，只转换非空选区，空光标仅保留位置；
 * - 同行多选区：前一个替换变长/变短后，后一个选区按最终文本重算偏移；
 * - 相同范围的重复选区只处理一次。
 */
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
          wordRangeStart: start,
          wordRangeEnd: end,
        });
      }
      continue;
    }
    processedKeys.add(uniqueKey);

    const originalTextInRange = document.getText(range);
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
    // 全部无变化（如已处于目标格式）：仍按记录重放选区
    textEditor.selections = remapSelections(document, originalText, edits, records);
  }
}

/** 按「编辑前文本 + 编辑列表」重算所有选区在最终文本中的位置 */
function remapSelections(
  document: vscode.TextDocument,
  originalText: string,
  edits: TextEdit[],
  records: SelectionRecord[]
): vscode.Selection[] {
  const finalText = buildFinalText(originalText, edits);
  return records.map(record => {
    if (record.isEmpty) {
      // 空光标：若记录了单词上下文，把相对偏移映射到新单词（夹在长度内），否则映射 end
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
