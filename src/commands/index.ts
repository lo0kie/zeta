import explorerTreeViewProvider from '@/providers/explorer-view';
import { exist } from '@/utils';
import * as vscode from 'vscode';
import changeCase from './change-case';
import packageScript from './package-script';
import scriptRunner from './script-runner';
import tagsWrap from './tags-wrap';

const openFolder = (uri: vscode.Uri, newWindow: boolean) => {
  if (exist(uri)) {
    vscode.commands.executeCommand('vscode.openFolder', uri, newWindow);
  }
};

const openInDefaultBrowser = (uri = vscode.window.activeTextEditor?.document.uri) => {
  if (uri && exist(uri)) {
    vscode.env.openExternal(uri);
  }
};

const addToWorkspace = (uri: vscode.Uri | vscode.Uri[]) => {
  const uris = Array.isArray(uri) ? uri : [uri];
  uris.forEach(u => {
    if (exist(u)) {
      vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri: u });
    }
  });
};

const commands = [
  vscode.commands.registerTextEditorCommand('zeta.language.wrap', tagsWrap),
  vscode.commands.registerTextEditorCommand('zeta.other.changeCase', changeCase),
  vscode.commands.registerCommand('zeta.other.scriptRunner', scriptRunner),
  vscode.commands.registerCommand('zeta.open.defaultBrowser', openInDefaultBrowser),
  vscode.commands.registerCommand('zeta.open.currentWindow', (uri: vscode.Uri) => openFolder(uri, false)),
  vscode.commands.registerCommand('zeta.open.newWindow', (uri: vscode.Uri) => openFolder(uri, true)),
  vscode.commands.registerCommand('zeta.other.packageScript', packageScript),
  vscode.commands.registerCommand('zeta.other.addToWorkspace', addToWorkspace),
  vscode.commands.registerCommand('zeta.other.refresh', () => explorerTreeViewProvider.refresh()),
];

export default commands;
