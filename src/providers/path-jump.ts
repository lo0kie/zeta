import { exist, findRootUri, findTargetFile } from '@/utils';
import { Configuration } from '@/utils/configuration';
import { JAVASCRIPT_PATH } from '@/utils/constants';
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';

class PathJumpProvider implements vscode.DefinitionProvider {
  private _asRelativePath(uri: vscode.Uri, fsPath: string): vscode.Uri {
    return vscode.Uri.joinPath(Utils.dirname(uri), fsPath);
  }

  private _asAbsolutePath(fsPath: string): vscode.Uri {
    return vscode.Uri.file(fsPath);
  }

  private _asAliasPath(rootUri: vscode.Uri, fsPath: string): vscode.Uri | undefined {
    const aliasMap = Configuration.ALIAS;
    for (const [alias, target] of Object.entries(aliasMap)) {
      const regExp = new RegExp(`^${alias}`);
      if (regExp.test(fsPath)) {
        const aliasPath = fsPath.replace(regExp, target);
        return vscode.Uri.joinPath(rootUri, aliasPath.replace('${root}', ''));
      }
    }
    return undefined;
  }

  private _asPackageJson(rootUri: vscode.Uri, fsPath: string): vscode.Uri[] {
    const targetUri = vscode.Uri.joinPath(rootUri, 'node_modules', fsPath);
    return [targetUri, vscode.Uri.joinPath(targetUri, 'package.json')];
  }

  public async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> {
    const range = document.getWordRangeAtPosition(position, JAVASCRIPT_PATH);
    if (!range) return [];

    const rangeWithoutQuote = range.with(range.start.translate(0, 1), range.end.translate(0, -1));
    const targetPath = document.getText(rangeWithoutQuote);
    const rootPath = findRootUri(document.uri);
    if (!rootPath) return [];

    const candidateUris: (vscode.Uri | undefined)[] = [
      this._asAbsolutePath(targetPath),
      this._asRelativePath(document.uri, targetPath),
      this._asAliasPath(rootPath, targetPath),
      ...this._asPackageJson(rootPath, targetPath),
    ];

    const locations: vscode.Location[] = [];
    const defaultPosition = new vscode.Position(0, 0);

    for (const resUri of candidateUris) {
      if (!resUri) continue;

      const verifiedUris = await findTargetFile(resUri);
      for (const uri of verifiedUris) {
        if (exist(uri)) {
          locations.push(new vscode.Location(uri, defaultPosition));
        }
      }
    }

    return locations;
  }
}

export default new PathJumpProvider();
