import { registerCommand, registerTextEditorCommand } from '@/core/command';
import { resolveUriArgument } from '@/core/fs';
import type { ExplorerTreeViewProvider } from '@/explorer/provider';
import * as vscode from 'vscode';
import addFolder from './add-folder';
import changeCase from './change-case';
import { addToWorkspace, openFolder, openInDefaultBrowser } from './folder';
import runScript from './run-script';
import tagsWrap from './tags-wrap';
import { runInTerminal } from './terminal';

export interface CommandDeps {
  explorerProvider: ExplorerTreeViewProvider;
}

export function registerCommands({ explorerProvider }: CommandDeps): vscode.Disposable[] {
  return [
    registerTextEditorCommand('zeta.editor.wrapTags', tagsWrap),
    registerTextEditorCommand('zeta.editor.changeCase', changeCase),
    registerCommand('zeta.folder.openInTerminal', arg => runInTerminal({ cwd: resolveUriArgument(arg) })),
    registerCommand('zeta.file.openInBrowser', openInDefaultBrowser),
    registerCommand('zeta.folder.openInWindow', arg => openFolder(arg, false)),
    registerCommand('zeta.folder.openInNewWindow', arg => openFolder(arg, true)),
    registerCommand('zeta.folder.runScript', runScript),
    registerCommand('zeta.folder.addToWorkspace', addToWorkspace),
    registerCommand('zeta.explorer.addFolder', addFolder),
    registerCommand('zeta.explorer.refresh', () => explorerProvider.refresh()),
  ];
}
