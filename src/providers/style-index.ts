/**
 * 共享样式索引层：文件级解析结果（符号 + 类/ID 定义位置 + 规则块）统一来自 style-parser，
 * 本模块只做「读文件 + 缓存 + 惰性规则块」的组合，供 hover（类悬浮）与 definition（类/ID 跳转）消费。
 *
 * 一个样式文件在 style-parser 的缓存里只有一份 ParsedStyleFile：
 * - collectImportedSymbols（补全/变量悬浮/变量跳转）取 .symbols；
 * - getFileIndex（类悬浮/类跳转）取 .selectorDefs 与 .ruleBlocks（惰性填充）。
 * 消除 parseStyleContent 与 extractSelectorDefs 各自独立扫描同一文本的重复。
 */
import { readFileTextCached } from '@/providers/style-completion';
import type { ParsedStyleFile } from '@/providers/style-parser';
import { clearAllParsedFiles, clearParsedFile, findSelectorBlocks, getParsedFile } from '@/providers/style-parser';
import * as vscode from 'vscode';

// 转发导出（供测试与 style-hover 使用，行为与实现均来自 style-parser）
export { clearParsedFile, extractSelectorDefs, findSelectorBlocks, getParsedFile } from '@/providers/style-parser';

/** 取文件的统一解析结果（共享缓存；文件保存/关闭时经 clearStyleIndex 失效） */
export async function getFileIndex(uri: vscode.Uri): Promise<ParsedStyleFile> {
  return getParsedFile(uri, readFileTextCached);
}

/**
 * 取某个选择器的规则块列表（hover 展示用）：首次计算并写入共享解析结果，之后 O(1) 命中。
 * 与 style-hover 原 findSelectorBlocks 行为一致（字符串影子副本 + 嵌套花括号配对 + 公共缩进归一）。
 */
export async function getSelectorRuleBlocks(uri: vscode.Uri, selector: string): Promise<string[]> {
  const parsed = await getFileIndex(uri);
  const cached = parsed.ruleBlocks.get(selector);
  if (cached) return cached;

  const blocks = findSelectorBlocks(parsed.text, selector);
  parsed.ruleBlocks.set(selector, blocks);
  return blocks;
}

/** 清空文件解析缓存（保存/关闭文档时调用，与 clearStyleFileCache 同步） */
export function clearStyleIndex(uri: vscode.Uri): void {
  clearParsedFile(uri);
}

/** 清空全部索引（测试用） */
export function clearAllStyleIndex(): void {
  clearAllParsedFiles();
}
