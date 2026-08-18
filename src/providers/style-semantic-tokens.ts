import * as vscode from 'vscode';
import { getStyleBlocks } from './style-completion';
import { STYLE_SYMBOL_LANGS } from './style-languages';

// 语义着色只用一种 token 类型：CSS 变量（var(--x) 的用法位置）
const tokenTypes = ['variable'];
const tokenModifiers: string[] = [];
export const semanticLegend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

// 匹配 var(--name) 用法：只关心第一个参数（变量名），后面的兜底值忽略
const VAR_USAGE_REGEX = /var\(\s*(--[a-zA-Z0-9_-]+)/g;

/** 把注释替换为空白（保留字符串字面量），使后面的扫描不会命中注释里的 var(...) */
function maskComments(content: string): string {
  return content.replace(/(['"`])(?:\\.|[^\\])*?\1|\/\*[\s\S]*?\*\/|\/\/.*/g, (match, quote) => {
    if (quote) return match;
    return match.replace(/[^\r\n]/g, ' ');
  });
}

/** 把注释与字符串字面量都替换为空白（跨行/未闭合时截断），var() 扫描只面向真实代码 */
function maskCommentsAndStrings(content: string): string {
  return content.replace(/(['"`])(?:\\.|[^\\\r\n])*?(?:\1|\r?\n|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/.*/g, match =>
    match.replace(/[^\r\n]/g, ' ')
  );
}

/** 为 CSS 变量的用法位置（var(--x)）提供语义着色；vue 文件只处理 <style> 块 */
export class StyleSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  public provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(semanticLegend);
    const text = document.getText();

    // vue：按 <style> 块逐段扫描；其余样式语言整文件扫描
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
        // 把块内偏移换算回文档绝对偏移，再转行列
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
  const selectors = STYLE_SYMBOL_LANGS.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerDocumentSemanticTokensProvider(selectors, provider, semanticLegend);
}
