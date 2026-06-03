import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import * as vscode from 'vscode';
import { Configuration } from './configuration';

export function formatDate(dateInput: number | string | Date = Date.now()): string {
  const date = new Date(dateInput);

  const formatted = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);

  // 规范化输出为 YYYY-MM-DD HH:mm:ss 格式
  return formatted.replace(/\//g, '-');
}

export function formatSize(size: number, maxFloatLength = 2, ignoreExtension = false, addSpace = true): string {
  const extensions = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  if (size === 0) return `0${ignoreExtension ? '' : `${addSpace ? ' ' : ''}B`}`;

  const i = Math.floor(Math.log(size) / Math.log(1024));
  const convertedSize = parseFloat((size / Math.pow(1024, i)).toFixed(maxFloatLength));

  return `${convertedSize}${ignoreExtension ? '' : `${addSpace ? ' ' : ''}${extensions[i]}`}`;
}

export function toNormalizePath(uri: vscode.Uri | string): string {
  const fsPath = uri instanceof vscode.Uri ? uri.fsPath : uri;
  const normalized = normalize(fsPath);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function findRootUri(uri = vscode.window.activeTextEditor?.document.uri): vscode.Uri | undefined {
  if (!uri) return undefined;

  let currentPath = uri.fsPath;
  while (currentPath !== dirname(currentPath)) {
    if (existsSync(join(currentPath, 'package.json'))) {
      return vscode.Uri.file(currentPath);
    }
    currentPath = dirname(currentPath);
  }

  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return folder ? folder.uri : undefined;
}

export function exist(uri: vscode.Uri): boolean {
  return !!uri && existsSync(uri.fsPath);
}

/**
 * 并发优化：同时探测所有可能的后缀名路径
 */
export async function addExtension(uri: vscode.Uri, additionalExtension: string[] = []): Promise<vscode.Uri[]> {
  const extensions = [...Configuration.EXTS, ...additionalExtension];

  // 生成所有候选路径
  const candidates = extensions.flatMap(extension => [
    vscode.Uri.file(`${uri.fsPath}${extension}`),
    vscode.Uri.file(`${uri.fsPath}/index${extension}`),
  ]);

  // 并发派发 I/O 请求
  const results = await Promise.all(
    candidates.map(async candidate => {
      if (!exist(candidate)) return null;
      try {
        const stat = await vscode.workspace.fs.stat(candidate);
        return stat.type === vscode.FileType.File ? candidate : null;
      } catch {
        return null;
      }
    })
  );

  // 过滤掉所有未命中的空值
  return results.filter(Boolean) as vscode.Uri[];
}

export async function findTargetFile(uri: vscode.Uri, ...paths: string[]): Promise<vscode.Uri[]> {
  const fileUri = paths.length > 0 ? vscode.Uri.joinPath(uri, ...paths) : uri;
  if (!exist(fileUri)) return addExtension(fileUri);

  try {
    const stat = await vscode.workspace.fs.stat(fileUri);
    return stat.type === vscode.FileType.File ? [fileUri] : addExtension(fileUri);
  } catch {
    return addExtension(fileUri);
  }
}

export async function request<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json() as Promise<T>;
  }

  return response.text() as unknown as T;
}

/**
 * 极简零依赖防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(fn: T, delay = 500) {
  let timer: NodeJS.Timeout | null = null;
  return function (this: any, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
