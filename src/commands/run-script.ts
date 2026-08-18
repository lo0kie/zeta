/**
 * 查找脚本运行：定位 package.json，探测包管理器，在终端执行所选脚本（可选询问追加参数）。
 */
import { Configuration } from '@/core/configuration';
import { basename, dirname, findRootUri, isFile, isSameUri, resolveUriArgument } from '@/core/fs';
import { toNormalizePath } from '@/core/strings';
import * as vscode from 'vscode';
import { runInTerminal } from './terminal';

const MISSING_PACKAGE_JSON = '未能在当前上下文中找到 package.json 文件';

const KNOWN_PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

const LOCK_FILE_MANAGERS: Record<string, string> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
  'package-lock.json': 'npm',
};

/**
 * 智能包管理器探测：优先读 package.json 的 packageManager 字段
 * （corepack 格式如 "pnpm@9.1.0"，取 @ 前的名字），
 * 未声明时嗅探同目录锁文件，最终回落 npm。
 */
async function detectPackageManager(packageJsonUri: vscode.Uri, packageManagerField?: string): Promise<string> {
  const declared = packageManagerField?.split('@')[0];
  if (declared && KNOWN_PACKAGE_MANAGERS.has(declared)) return declared;

  const workspaceRoot = vscode.workspace.getWorkspaceFolder(packageJsonUri)?.uri;
  let current = dirname(packageJsonUri);

  while (true) {
    try {
      const entries = await vscode.workspace.fs.readDirectory(current);
      const fileNames = new Set(entries.map(([name]) => name));
      for (const [lockFile, manager] of Object.entries(LOCK_FILE_MANAGERS)) {
        if (fileNames.has(lockFile)) return manager;
      }
    } catch {}

    if (workspaceRoot && isSameUri(current, workspaceRoot)) break;
    const parent = dirname(current);
    if (isSameUri(parent, current)) break;
    current = parent;
  }

  return 'npm';
}

/** 运行 package.json 脚本：解析上下文目录 → 过滤非字符串 scripts → QuickPick 选择 → 探测包管理器并在终端执行 */
export default async function runScript(arg?: unknown): Promise<void> {
  let targetUri = resolveUriArgument(arg);

  if (!targetUri) {
    const folder =
      vscode.workspace.workspaceFolders?.length === 1
        ? vscode.workspace.workspaceFolders[0]
        : await vscode.window.showWorkspaceFolderPick();
    targetUri = folder?.uri;
  }
  if (!targetUri) return;

  if (await isFile(targetUri)) {
    // 上下文是文件：本身就是 package.json 则直接用，否则向上找最近的包根
    if (basename(targetUri) !== 'package.json') {
      const rootUri = await findRootUri(targetUri);
      if (!rootUri) {
        await vscode.window.showWarningMessage(MISSING_PACKAGE_JSON);
        return;
      }
      targetUri = vscode.Uri.joinPath(rootUri, 'package.json');
    }
  } else {
    // 上下文是目录：直接在该目录下找 package.json
    targetUri = vscode.Uri.joinPath(targetUri, 'package.json');
  }

  if (!(await isFile(targetUri))) {
    await vscode.window.showWarningMessage(MISSING_PACKAGE_JSON);
    return;
  }

  let scripts: Record<string, string> | undefined;
  let packageManager: string | undefined;
  try {
    const rawContent = await vscode.workspace.fs.readFile(targetUri);
    const text = new TextDecoder().decode(rawContent).replace(/^\uFEFF/, '');
    ({ scripts, packageManager } = JSON.parse(text) ?? {});
  } catch {
    await vscode.window.showErrorMessage('无法正确解析该 package.json 文件');
    return;
  }

  const scriptNames = Object.keys(scripts ?? {}).filter(key => typeof scripts?.[key] === 'string');

  if (scriptNames.length === 0) {
    await vscode.window.showWarningMessage('package.json 中未配置任何 scripts 脚本');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    scriptNames.map(label => ({ label, detail: scripts![label] })),
    { placeHolder: toNormalizePath(targetUri) }
  );

  if (!picked) return;

  // zeta.runScript.askArguments 关闭时跳过询问，选中脚本直接运行
  let extraArgs: string | undefined;
  if (Configuration.RUN_SCRIPT_ASK_ARGUMENTS) {
    extraArgs = await vscode.window.showInputBox({
      prompt: `追加参数（可选，直接回车跳过）`,
      placeHolder: `例如: --watch`,
    });
    if (extraArgs === undefined) return;
  }

  const workingDir = dirname(targetUri);
  const manager = await detectPackageManager(targetUri, packageManager);

  const scriptName = picked.label.includes(' ') ? `"${picked.label.replace(/"/g, '\\"')}"` : picked.label;
  const runCmd = extraArgs?.trim()
    ? `${manager} run ${scriptName} -- ${extraArgs.trim()}`
    : `${manager} run ${scriptName}`;

  await runInTerminal({
    cwd: workingDir,
    commands: [runCmd],
    name: `${basename(workingDir)} - ${runCmd}`,
    show: true,
    disposeSame: true,
  });
}
