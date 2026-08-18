import { resolveImportFileTargets } from '@/providers/path-definition';
import * as vscode from 'vscode';
import { STYLE_LINK_LANGS } from './style-languages';

// 样式文件里的导入语句：@import / @use / @forward / @require 'xxx'
const STYLE_IMPORT_RE = /@(?:import|use|forward|require)\s+(["'])((?:\\.|(?!\1)[^\r\n])*)\1/g;
// url('xxx') 引号形式（无引号的 url(xxx) 少见且多为相对/外部资源，暂不处理）
const STYLE_URL_RE = /url\(\s*(["'])((?:\\.|(?!\1)[^"')])*)\1\s*\)/g;

/** 外部/数据类 URL，不应作为本地文件链接 */
const EXTERNAL_RE = /^(?:https?:|data:|file:|\/\/)/i;

/**
 * 为样式文件里的导入字符串（@import/@use/@forward/@require、url()）提供可点击链接。
 *
 * 背景：VS Code 内置 css-language-features 会对 @import '@/assets/tokens.module'
 * 返回一个「无后缀、指向不存在文件」的定义结果，且排在合并结果前面，Ctrl+点击会
 * 直接报「无法打开 tokens.module」。DocumentLink 的 target 是文件 URI，点击由 VS Code
 * 直接打开目标文件，不经定义结果合并，可彻底规避该问题。
 */
export class StyleImportLinkProvider implements vscode.DocumentLinkProvider {
  public async provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.DocumentLink[]> {
    const links: vscode.DocumentLink[] = [];
    const lineCount = document.lineCount;

    for (let line = 0; line < lineCount; line++) {
      const text = document.lineAt(line).text;

      STYLE_IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = STYLE_IMPORT_RE.exec(text)) !== null) {
        const link = await this.linkForMatch(document, line, text, m);
        if (link) links.push(link);
      }

      STYLE_URL_RE.lastIndex = 0;
      while ((m = STYLE_URL_RE.exec(text)) !== null) {
        const link = await this.linkForMatch(document, line, text, m);
        if (link) links.push(link);
      }
    }

    return links;
  }

  /** 把一条 import/url 匹配转成 DocumentLink（无法解析为本地文件时返回 undefined） */
  private async linkForMatch(
    document: vscode.TextDocument,
    line: number,
    text: string,
    m: RegExpExecArray
  ): Promise<vscode.DocumentLink | undefined> {
    const rawPath = m[2].trim();
    if (!rawPath || EXTERNAL_RE.test(rawPath)) return undefined;

    // 字符串字面量范围（含引号），让链接下划线覆盖整个路径
    const quoteStart = m.index + m[0].indexOf(m[1]);
    const stringEnd = quoteStart + 1 + m[2].length + 1;
    const range = new vscode.Range(line, quoteStart, line, stringEnd);

    const targets = await resolveImportFileTargets(document, rawPath);
    if (targets.length === 0) return undefined;

    const link = new vscode.DocumentLink(range, targets[0]);
    link.tooltip = targets[0].fsPath;
    return link;
  }
}

export function registerStyleImportLinks(): vscode.Disposable {
  const provider = new StyleImportLinkProvider();
  const selectors = STYLE_LINK_LANGS.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerDocumentLinkProvider(selectors, provider);
}
