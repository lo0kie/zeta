import * as vscode from 'vscode';
import { getStyleBlocks } from './style-completion';

const tokenTypes = ['variable'];
const tokenModifiers: string[] = [];
export const semanticLegend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

const VAR_USAGE_REGEX = /var\(\s*(--[a-zA-Z0-9_-]+)/g;

function maskComments(content: string): string {
  return content.replace(/(['"`])(?:\\.|[^\\])*?\1|\/\*[\s\S]*?\*\/|\/\/.*/g, (match, quote) => {
    if (quote) return match;
    return match.replace(/[^\r\n]/g, ' ');
  });
}

function maskCommentsAndStrings(content: string): string {
  return content.replace(/(['"`])(?:\\.|[^\\\r\n])*?(?:\1|\r?\n|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/.*/g, match =>
    match.replace(/[^\r\n]/g, ' ')
  );
}

export class StyleSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  public provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(semanticLegend);
    const text = document.getText();

    const isVue = document.languageId === 'vue';
    const scopes = isVue
      ? getStyleBlocks(document)
      : [{ content: text, start: 0, end: text.length, lang: document.languageId }];

    for (const scope of scopes) {
      const maskedContent = maskCommentsAndStrings(scope.content);
      VAR_USAGE_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = VAR_USAGE_REGEX.exec(maskedContent)) !== null) {
        const varName = match[1];
        const varOffset = scope.start + match.index + match[0].indexOf(varName);
        const pos = document.positionAt(varOffset);

        builder.push(pos.line, pos.character, varName.length, 0, 0);
      }
    }

    return builder.build();
  }
}

export function registerStyleSemanticTokens(): vscode.Disposable {
  const provider = new StyleSemanticTokensProvider();
  const selectors = ['css', 'less', 'scss', 'sass', 'vue'].map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerDocumentSemanticTokensProvider(selectors, provider, semanticLegend);
}
