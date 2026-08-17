import { basename } from '@/core/fs';
import { escapeRegExp } from '@/core/strings';
import * as vscode from 'vscode';
import {
  collectImportedFiles,
  collectImportedSymbols,
  getStyleBlocks,
  readFileTextCached,
  stripCommentsSafe,
} from './style-completion';

const STYLE_LANGUAGES = ['css', 'less', 'scss', 'sass', 'vue'];
const HOVER_WORD = /([.#@$][a-zA-Z0-9_-]+|--[a-zA-Z0-9_-]+)/;
const HEX_ONLY = /^#[0-9a-fA-F]{3,8}$/;

const COLOR_VALUE_PATTERN = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/i;

function createColorSwatchUri(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="11" height="11"><rect width="12" height="12" rx="2" fill="${color}" stroke="#88888880" stroke-width="1.5"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function findSelectorBlocks(text: string, selector: string): string[] {
  const cleanText = stripCommentsSafe(text);
  if (!cleanText.includes(selector)) return [];

  // 生成影子副本：将所有字符串内容替换为空格，避免大括号干扰
  const searchTarget = cleanText.replace(/(['"`])(?:\\.|[^\\\r\n])*?(?:\1|\r?\n|$)/g, match =>
    ' '.repeat(match.length)
  );

  const pattern = new RegExp(`${escapeRegExp(selector)}(?![\\w-])[^{}]*\\{`, 'g');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  // 使用搜索影子副本
  while ((match = pattern.exec(searchTarget)) !== null) {
    let depth = 1;
    let i = pattern.lastIndex;

    // 因为字符串已被抹去，无需再处理引号状态，纯数括号即可
    while (i < searchTarget.length && depth > 0) {
      const char = searchTarget[i];
      if (char === '{') depth++;
      else if (char === '}') depth--;
      i++;
    }
    if (depth !== 0) continue;

    pattern.lastIndex = i;

    let ruleStart = match.index;
    while (ruleStart > 0 && !/[;{}]/.test(searchTarget[ruleStart - 1])) {
      ruleStart--;
    }

    const openBraceIndex = match.index + match[0].length - 1;

    // 切割动作回到原始 cleanText 身上，确保用户看到的是完整含字符串的代码
    const selectorHeader = cleanText.slice(ruleStart, openBraceIndex).trim();
    const rawBody = cleanText.slice(openBraceIndex + 1, i - 1);
    const bodyLines = rawBody.split('\n');
    while (bodyLines.length > 0 && !bodyLines[0].trim()) bodyLines.shift();
    while (bodyLines.length > 0 && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    if (bodyLines.length === 0) continue;

    const minIndent = bodyLines.reduce(
      (min, line) => (line.trim().length === 0 ? min : Math.min(min, line.match(/^[ \t]*/)?.[0].length ?? 0)),
      Infinity
    );
    const validMinIndent = minIndent === Infinity ? 0 : minIndent;
    const indented = bodyLines
      .map(line => (line.trim().length === 0 ? '' : `  ${line.slice(validMinIndent).trimEnd()}`))
      .join('\n');
    blocks.push(`${selectorHeader} {\n${indented}\n}`);
  }

  return blocks;
}

export class StyleHoverProvider implements vscode.HoverProvider {
  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    if (document.languageId === 'vue') {
      const offset = document.offsetAt(position);
      const inStyle = getStyleBlocks(document).some(block => offset >= block.start && offset <= block.end);
      if (!inStyle) return undefined;
    }

    let range = document.getWordRangeAtPosition(position, HOVER_WORD);
    let word = range ? document.getText(range) : '';

    if (!word) {
      const simpleRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_-]+/);
      if (simpleRange) {
        const lineText = document.lineAt(position.line).text;
        const textBefore = lineText.slice(0, simpleRange.start.character);
        if (/@(include|mixin)\s+$/.test(textBefore)) {
          range = simpleRange;
          word = `@${document.getText(simpleRange)}`;
        }
      }
    }

    if (!range || !word) return undefined;

    if (word.startsWith('@') || word.startsWith('$') || word.startsWith('--')) {
      const symbols = await collectImportedSymbols(document);
      const matchedSymbols = symbols.filter(s => s.name === word);
      if (matchedSymbols.length === 0) return undefined;

      const md = new vscode.MarkdownString();
      md.supportHtml = true;
      md.isTrusted = true;

      const lines = matchedSymbols.map(s => {
        const scopePart = s.scope ? `\`[${s.scope}]\` ` : '';
        const colorMatch = s.value.match(COLOR_VALUE_PATTERN);
        const colorPart = colorMatch
          ? `![](${createColorSwatchUri(colorMatch[0])}) \`${colorMatch[0]}\``
          : `\`${s.value}\``;
        return `${scopePart}${colorPart}`;
      });

      md.appendMarkdown(lines.join('  \n'));

      const files = Array.from(new Set(matchedSymbols.map(s => basename(vscode.Uri.file(s.filePath)))));
      md.appendMarkdown(`\n\n\`${word}\` 定义于 \`${files.join('`, `')}\``);
      return new vscode.Hover(md, range);
    }

    if (word.startsWith('.') || word.startsWith('#')) {
      const blocks = await this.findSelectorInScope(document, word);
      if (blocks.length === 0) {
        if (HEX_ONLY.test(word)) return undefined;
        return undefined;
      }

      const md = new vscode.MarkdownString();
      md.appendCodeblock(blocks[0], 'css');
      if (blocks.length > 1) {
        md.appendMarkdown(`\n\n另有 ${blocks.length - 1} 处定义`);
      }
      return new vscode.Hover(md, range);
    }

    return undefined;
  }

  private async findSelectorInScope(document: vscode.TextDocument, selector: string): Promise<string[]> {
    const scopes = getStyleBlocks(document).map(block => block.content);
    for (const uri of await collectImportedFiles(document)) {
      try {
        scopes.push(await readFileTextCached(uri));
      } catch {}
    }

    const blocks: string[] = [];
    for (const scope of scopes) blocks.push(...findSelectorBlocks(scope, selector));
    return blocks;
  }
}

export function registerStyleHover(): vscode.Disposable {
  const provider = new StyleHoverProvider();
  const selectors = STYLE_LANGUAGES.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerHoverProvider(selectors, provider);
}
