import * as vscode from 'vscode';

interface CommandMeta {
  id: string;
  title: string;
}

/** 从扩展清单的 contributes.commands 提取全部 zeta 命令（id → title），供 QuickPick 展示 */
export function collectZetaCommands(packageJSON: unknown): CommandMeta[] {
  const commands =
    (packageJSON as { contributes?: { commands?: { command?: string; title?: string }[] } })?.contributes?.commands ??
    [];
  return commands
    .filter(c => typeof c.command === 'string' && c.command.startsWith('zeta.'))
    .map(c => ({ id: c.command as string, title: c.title ?? (c.command as string) }));
}

/**
 * QuickPick 列出全部 zeta 命令（可搜索，detail 显示命令 id），选中即执行。
 * 命令清单来自本扩展的 package.json contributes.commands，与命令面板保持一致。
 */
export default async function showCommands(): Promise<void> {
  const ext = vscode.extensions.all.find(e =>
    (e.packageJSON as { contributes?: { commands?: { command?: string }[] } })?.contributes?.commands?.some(
      c => typeof c.command === 'string' && c.command.startsWith('zeta.')
    )
  );
  if (!ext) return;

  const items = collectZetaCommands(ext.packageJSON).map(c => ({
    label: c.title,
    detail: c.id,
    id: c.id,
  }));
  if (items.length === 0) return;

  const picked = await vscode.window.showQuickPick(items, {
    matchOnDetail: true,
    placeHolder: '选择要执行的 zeta 命令',
  });
  if (picked) await vscode.commands.executeCommand(picked.id);
}
