/**
 * 终端相关命令：在终端中运行（runInTerminal，供资源导航/脚本使用）与状态栏终端切换（toggleTerminal）。
 */
import { dirname, isFile } from '@/core/fs';
import * as vscode from 'vscode';

/** runInTerminal 的参数：目录/命令/名称/展示与「同名即重启」开关 */
export interface RunInTerminalOptions {
  /** 终端的工作目录；若指向文件则自动取其所在目录 */
  cwd?: vscode.Uri;
  /** 依次发送并执行的命令 */
  commands?: string[];
  /** 终端名称 */
  name?: string;
  /** 创建后是否立即展示终端 */
  show?: boolean;
  /** 为 true 时先销毁同名终端再新建，保证“点一下重启”的直觉 */
  disposeSame?: boolean;
}

/** 由本扩展创建并登记的终端：按创建时名称追踪实例引用，用户在终端内重命名后仍可精确销毁 */
const managedTerminals = new Map<string, vscode.Terminal>();

/** 在指定目录创建终端并依次发送命令；cwd 指向文件时自动取其所在目录 */
export async function runInTerminal({
  cwd,
  commands = [],
  name,
  show = true,
  disposeSame = false,
}: RunInTerminalOptions): Promise<vscode.Terminal> {
  let workingDir = cwd;
  if (cwd && (await isFile(cwd))) {
    workingDir = dirname(cwd);
  }

  if (disposeSame && name) {
    // 1. 精确销毁：Map 里登记过的同名实例（含用户重命名后 name 已变化的那个）
    const existing = managedTerminals.get(name);
    if (existing && vscode.window.terminals.includes(existing)) {
      existing.dispose();
    }
    managedTerminals.delete(name);

    // 2. 兜底：仍有同名终端（非本扩展创建或历史残留）时按 name 全部销毁
    for (const terminal of vscode.window.terminals) {
      if (terminal.name === name) terminal.dispose();
    }
  }

  const terminal = vscode.window.createTerminal({ cwd: workingDir, name });
  if (name) {
    managedTerminals.set(name, terminal);
  }

  if (show) terminal.show();

  for (const command of commands) {
    terminal.sendText(command);
  }

  return terminal;
}

/**
 * 状态栏终端切换：面板可见则收起，不可见则弹出，纯二值、不依赖焦点状态。
 *
 * 核心是 workbench.action.togglePanel（Ctrl+J 同款命令）：它对底部面板做无状态切换，
 * 面板重新弹出时会恢复上次的视图（即终端），因此不需要探测面板当前是否可见——
 * activeTerminal/closePanel 方案的问题在于终端实例在面板隐藏后仍被保留，
 * 无法作为可见性信号。仅当工作区还没有任何终端实例时改用 toggleTerminal
 * 负责创建并聚焦第一个终端。
 */
export async function toggleTerminal(): Promise<void> {
  const hasTerminal = vscode.window.terminals.length > 0;

  await vscode.commands.executeCommand(
    hasTerminal ? 'workbench.action.togglePanel' : 'workbench.action.terminal.toggleTerminal'
  );
}
