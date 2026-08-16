import { registerCommand, registerTextEditorCommand } from '@/core/command';
import { resolveUriArgument } from '@/core/fs';
import type { ExplorerTreeViewProvider } from '@/explorer/provider';
import * as vscode from 'vscode';
import addFolder from './add-folder';
import changeCase from './change-case';
import cycleCase from './cycle-case';
import cycleQuotes from './cycle-quotes';
import { openFolder, openInDefaultBrowser } from './folder';
import removeFolder from './remove-folder';
import runScript from './run-script';
import tagsWrap from './tags-wrap';
import { runInTerminal, toggleTerminal } from './terminal';
import unwrapTags from './unwrap-tags';
import { wrapWithConsole, wrapWithIf, wrapWithTryCatch } from './wrap-with';

export interface CommandDeps {
  explorerProvider: ExplorerTreeViewProvider;
}

export function registerCommands({ explorerProvider }: CommandDeps): vscode.Disposable[] {
  return [
    registerTextEditorCommand('zeta.editor.wrapTags', tagsWrap),
    registerTextEditorCommand('zeta.editor.changeCase', changeCase),
    registerTextEditorCommand('zeta.editor.cycleCase', cycleCase),
    registerTextEditorCommand('zeta.editor.wrapConsole', wrapWithConsole),
    registerTextEditorCommand('zeta.editor.wrapTryCatch', wrapWithTryCatch),
    registerTextEditorCommand('zeta.editor.wrapIf', wrapWithIf),
    registerTextEditorCommand('zeta.editor.unwrapTags', unwrapTags),
    registerTextEditorCommand('zeta.editor.cycleQuotes', cycleQuotes),

    registerCommand('zeta.folder.openInTerminal', arg => runInTerminal({ cwd: resolveUriArgument(arg) })),
    registerCommand('zeta.file.openInBrowser', openInDefaultBrowser),
    registerCommand('zeta.folder.openInWindow', arg => openFolder(arg, false)),
    registerCommand('zeta.folder.openInNewWindow', arg => openFolder(arg, true)),
    registerCommand('zeta.folder.runScript', runScript),
    registerCommand('zeta.explorer.addFolder', addFolder),
    registerCommand('zeta.explorer.removeFolder', removeFolder),
    registerCommand('zeta.explorer.refresh', () => explorerProvider.refresh()),
    registerCommand('zeta.terminal.toggle', toggleTerminal),
  ];
}
