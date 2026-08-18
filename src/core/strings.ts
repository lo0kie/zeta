/**
 * 字符串小工具：escapeRegExp 等。
 */
import { normalize } from 'node:path';
import * as vscode from 'vscode';

/**
 * 转义用户配置中的正则元字符，避免拼接 RegExp 时误匹配或直接抛 SyntaxError
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 规范化路径并统一首字母大写（Windows 盘符小写时便于展示）
 */
export function toNormalizePath(uri: vscode.Uri | string): string {
  const fsPath = uri instanceof vscode.Uri ? uri.fsPath : uri;
  const normalized = normalize(fsPath);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
