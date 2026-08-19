import { Configuration } from '@/core/configuration';
import { wordTransformers } from '@/utils/case';
import * as vscode from 'vscode';
import { applySelections, buildCustomTransformers } from './change-case';

/**
 * 循环状态：以「一轮切换」为单位去重。
 * 某些词在多个格式下结果相同（variant 同时是 Camel/Kebab/Snake 的恒等结果），
 * 若按「格式索引」推进，variant 会在本轮中反复出现（Camel 一次、Snake 再一次），
 * 造成循环里同一文本重复。因此状态跟踪「本轮已出现的文本集合」，每按一次只前进到
 * 产生「新文本」的格式；一圈找不到新文本时，回到最初文本（本轮起点）并重置本轮。
 * 一轮去重后：VARIANT → variant(Camel) → Variant(Pascal) → VARIANT(Constant) → ...（variant 只一次）
 * key 用「文档 uri + 选区锚点（行:字符）」；光标移动后 key 失效，自动重新定位。
 */
interface CycleState {
  /** 本轮起点文本（最初文本） */
  start: string;
  /** 本轮已出现的文本（含 start），用于去重 */
  texts: string[];
  /** 上次切换到的 cycleOrder 格式索引 */
  lastIndex: number;
}

const cycleState = new Map<string, CycleState>();

/** 选区循环状态的 key：uri + 锚点位置 */
function cycleKey(uri: vscode.Uri, anchor: vscode.Position): string {
  return `${uri.toString()}:${anchor.line}:${anchor.character}`;
}

/**
 * 循环切换单词格式：按 zeta.case.cycleOrder 顺序逐格式前进，以一轮为单位去重。
 * 每个选区独立；下个格式产生与当前相同（或本轮已出现）的文本时跳过；
 * 一轮（遍历全部格式、找不到新文本）结束，下一次切换精确回到最初文本
 * （直接返回记录的 start，不经过任何格式重算）。
 */
export default async function cycleCase(textEditor: vscode.TextEditor, _edit: vscode.TextEditorEdit): Promise<void> {
  const { selections, document } = textEditor;
  if (selections.length === 0) return;

  const transformers: Record<string, (text: string) => string> = { ...wordTransformers, ...buildCustomTransformers() };
  const cycleOrder = Configuration.CASE_CYCLE_ORDER.filter(name => transformers[name]);
  if (cycleOrder.length === 0) return;
  const len = cycleOrder.length;

  await applySelections(
    textEditor,
    (selection, _range, sample) => {
      if (!sample.trim()) return undefined;

      const key = cycleKey(document.uri, selection.anchor);
      let state = cycleState.get(key);

      // 首次/光标移动后：初始化本轮（起点 = 当前文本），从当前格式的下一个开始
      if (!state) {
        state = { start: sample, texts: [sample], lastIndex: -1 };
        cycleState.set(key, state);
      }

      // 从「上次格式 + 1」起找第一个产生「不在本轮已出现文本集合中」文本的格式；
      // 首次（lastIndex=-1）时从当前文本匹配格式的下一格开始
      let startIndex: number;
      if (state.lastIndex !== -1) {
        startIndex = (state.lastIndex + 1) % len;
      } else {
        const currentIndex = cycleOrder.findIndex(name => transformers[name](sample) === sample);
        if (currentIndex === -1) {
          // 非任何已知格式：从第 1 个起找第一个产生新文本的格式；全无则放弃
          for (let i = 0; i < len; i++) {
            const text = transformers[cycleOrder[i]](sample);
            if (text !== sample && !state.texts.includes(text)) {
              state.lastIndex = i;
              state.texts.push(text);
              return transformers[cycleOrder[i]];
            }
          }
          cycleState.delete(key);
          return undefined;
        }
        startIndex = (currentIndex + 1) % len;
      }

      for (let step = 0; step < len; step++) {
        const idx = (startIndex + step) % len;
        const text = transformers[cycleOrder[idx]](sample);
        if (text !== sample && !state.texts.includes(text)) {
          state.lastIndex = idx;
          state.texts.push(text);
          return transformers[cycleOrder[idx]];
        }
      }

      // 一圈找不到新文本（本轮遍历完所有不同结果）：精确回到最初文本并重置本轮。
      // 「精确」指直接返回记录的 start 文本本身，而非用某格式的 transformer 对当前
      // 样本重新计算——后者在 start 非任何格式的规范输出时（如 start='variant'，而
      // Constant 规范输出为 'VARIANT'）会失真，无法回到原始大小写/分隔。
      cycleState.delete(key);
      return () => state.start;
    },
    true
  );
}
