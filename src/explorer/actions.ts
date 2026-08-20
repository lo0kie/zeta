/**
 * 资源导航的常规文件树操作：新建文件/文件夹、重命名、删除、复制路径（绝对/相对）。
 * 均基于 vscode.workspace.fs（不依赖 node fs），兼容 remote/虚拟文件系统。
 */
import { basename, dirname, isDirectory, resolveUriArgument, statSafe } from '@/core/fs';
import * as vscode from 'vscode';

/** 新建文件：在选中目录（或父目录）下创建，成功后自动打开 */
export async function createFile(arg: unknown): Promise<void> {
  const parent = await targetParent(arg);
  if (!parent) return;

  const name = await vscode.window.showInputBox({
    prompt: '新文件名',
    placeHolder: '如 a.ts、src/index.ts（可用 / 指定子目录，自动创建父目录）',
    validateInput: validateNewName,
  });
  if (!name) return;

  const target = vscode.Uri.joinPath(parent, name);
  if (await exists(target)) {
    vscode.window.showWarningMessage(`「${name}」已存在`);
    return;
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..')); // 保证父目录存在（含多级）
  await vscode.workspace.fs.writeFile(target, new Uint8Array());
  await vscode.window.showTextDocument(target);
}

/** 新建文件夹：在选中目录（或父目录）下创建 */
export async function createFolder(arg: unknown): Promise<void> {
  const parent = await targetParent(arg);
  if (!parent) return;

  const name = await vscode.window.showInputBox({
    prompt: '新文件夹名',
    validateInput: validateNewName,
  });
  if (!name) return;

  const target = vscode.Uri.joinPath(parent, name);
  if (await exists(target)) {
    vscode.window.showWarningMessage(`「${name}」已存在`);
    return;
  }
  await vscode.workspace.fs.createDirectory(target);
}

/** 重命名：对选中节点（文件/目录/根目录）改名 */
export async function renameEntry(arg: unknown): Promise<void> {
  const uri = resolveUriArgument(arg);
  if (!uri) return;

  const oldName = uri.path.split('/').filter(Boolean).pop() ?? '';
  const newName = await vscode.window.showInputBox({
    prompt: '新名称',
    value: oldName,
    validateInput: name => validateNewName(name, oldName),
  });
  if (!newName || newName === oldName) return;

  const target = vscode.Uri.joinPath(dirname(uri), newName);
  if (await exists(target)) {
    vscode.window.showWarningMessage(`「${newName}」已存在`);
    return;
  }
  await vscode.workspace.fs.rename(uri, target);
}

/** 删除：确认后删除选中节点 */
export async function deleteEntry(arg: unknown): Promise<void> {
  const uri = resolveUriArgument(arg);
  if (!uri) return;

  const stat = await statSafe(uri);
  const isDir = stat?.type === vscode.FileType.Directory;
  const confirm = await vscode.window.showWarningMessage(
    `确定删除「${basename(uri)}」？`,
    { modal: true, detail: isDir ? '将递归删除该目录及其全部内容，不可撤销。' : '此操作不可撤销。' },
    '删除'
  );
  if (confirm !== '删除') return;

  await vscode.workspace.fs.delete(uri, { recursive: isDir });
}

/** 复制绝对路径到剪贴板 */
export async function copyAbsolutePath(arg: unknown): Promise<void> {
  const uri = resolveUriArgument(arg);
  if (!uri) return;
  await vscode.env.clipboard.writeText(uri.fsPath);
}

/** 复制相对路径（相对第一个工作区根目录）到剪贴板 */
export async function copyRelativePath(arg: unknown): Promise<void> {
  const uri = resolveUriArgument(arg);
  if (!uri) return;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const rel = root ? relativePath(root, uri) : uri.fsPath;
  await vscode.env.clipboard.writeText(rel);
}

/** 取新建操作的父目录：选中目录用它本身，选中文件用其父目录，未选中回落到第一个根目录 */
async function targetParent(arg: unknown): Promise<vscode.Uri | undefined> {
  const uri = resolveUriArgument(arg);
  if (uri) {
    return (await isDirectory(uri)) ? uri : dirname(uri);
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** 名称校验：不允许空、斜杠（新建时允许 / 分段，单独校验）、非法字符 */
function validateNewName(name: string, original?: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return '名称不能为空';
  if (trimmed.includes('/') && trimmed.split('/').some(seg => !seg.trim())) return '路径段不能为空';
  // 全平台禁用的字符（Windows 保留字符）
  if (/[<>:"|?*\u0000-\u001f]/.test(trimmed.replace(/\//g, ''))) return '包含非法字符';
  return undefined;
}

/** 判断 uri 是否已存在 */
async function exists(uri: vscode.Uri): Promise<boolean> {
  return (await statSafe(uri)) !== undefined;
}

/** 计算 root 到 uri 的相对路径（简单实现：基于 fsPath 的路径差） */
function relativePath(root: vscode.Uri, uri: vscode.Uri): string {
  const rootPath = root.fsPath.replace(/[\\/]$/, '');
  const uriPath = uri.fsPath;
  if (uriPath === rootPath) return '.';
  if (uriPath.startsWith(rootPath + '/') || uriPath.startsWith(rootPath + '\\')) {
    return uriPath.slice(rootPath.length + 1);
  }
  return uriPath; // 不在根下：回落绝对路径
}
