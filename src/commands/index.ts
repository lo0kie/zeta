import { registerCommand, registerTextEditorCommand } from '@/core/command';
import { resolveUriArgument } from '@/core/fs';
import {
  copyAbsolutePath,
  copyRelativePath,
  createFile,
  createFolder,
  deleteEntry,
  renameEntry,
} from '@/explorer/actions';
import type { ExplorerTreeViewProvider } from '@/explorer/provider';
import * as vscode from 'vscode';
import addFolder from './add-folder';
import changeCase from './change-case';
import cycleCase from './cycle-case';
import cycleQuotes from './cycle-quotes';
import { openFolder, openInDefaultBrowser } from './folder';
import removeFolder from './remove-folder';
import runPackageScript from './run-package-script';
import selectBlock from './select-block';
import selectString from './select-string';
import showCommands from './show-commands';
import { debugResolveImport, openResolvedImport } from './style-import';
import tagsWrap from './tags-wrap';
import { runInTerminal, toggleTerminal } from './terminal';
import unwrapTags from './unwrap-tags';
import { wrapWithConsole, wrapWithIf, wrapWithTryCatch } from './wrap-with';

/** 命令注册依赖：资源导航提供者用于刷新命令（explorer.refresh） */
export interface CommandDeps {
  explorerProvider: ExplorerTreeViewProvider;
}

/** 注册全部命令：编辑器命令统一走 registerTextEditorCommand，资源导航/终端/浏览器命令走 registerCommand，异常由命令中心统一兜底 */
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
    registerTextEditorCommand('zeta.editor.debugResolveImport', debugResolveImport),
    registerTextEditorCommand('zeta.editor.selectBlock', selectBlock),
    registerTextEditorCommand('zeta.editor.selectString', selectString),

    registerCommand('zeta.openResolvedImport', (uriString: string) => openResolvedImport(uriString)),
    registerCommand('zeta.folder.openInTerminal', arg => runInTerminal({ cwd: resolveUriArgument(arg) })),
    registerCommand('zeta.file.openInBrowser', openInDefaultBrowser),
    registerCommand('zeta.folder.openInWindow', arg => openFolder(arg, false)),
    registerCommand('zeta.folder.openInNewWindow', arg => openFolder(arg, true)),
    registerCommand('zeta.folder.runPackageScript', runPackageScript),
    registerCommand('zeta.explorer.addFolder', addFolder),
    registerCommand('zeta.explorer.removeFolder', removeFolder),
    registerCommand('zeta.explorer.refresh', () => explorerProvider.refresh()),
    registerCommand('zeta.explorer.newFile', createFile),
    registerCommand('zeta.explorer.newFolder', createFolder),
    registerCommand('zeta.explorer.rename', renameEntry),
    registerCommand('zeta.explorer.delete', deleteEntry),
    registerCommand('zeta.explorer.copyAbsolutePath', copyAbsolutePath),
    registerCommand('zeta.explorer.copyRelativePath', copyRelativePath),
    registerCommand('zeta.terminal.toggle', toggleTerminal),
    registerCommand('zeta.showCommands', showCommands),
  ];
}
