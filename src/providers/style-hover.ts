import { basename } from '@/core/fs';
import * as vscode from 'vscode';
import {
  collectImportedFiles,
  collectImportedSymbols,
  getStyleBlocks,
  readFileTextCached,
  stripCommentsSafe,
} from './style-completion';

const STYLE_LANGUAGES = ['css', 'less', 'scss', 'vue'];

const HOVER_WORD = /([.#@][a-zA-Z0-9_-]+|--[a-zA-Z0-9_-]+)/;
// 纯 16 进制色值交给颜色悬浮处理，不做选择器解析（#abc 作为 id 选择器时同样跳过，与内置行为一致）
const HEX_ONLY = /^#[0-9a-fA-F]{3,8}$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 在文本中查找选择器（.name / #id）的声明块，返回格式化后的规则片段（真实内容，非占位符）。
 * 先剥离注释（复用 stripCommentsSafe：注释内的 .name { } 不会伪匹配，引号字符串保留），
 * 再做大括号深度计数（跳过字符串）匹配闭合，嵌套子规则不会被第一个 } 截断。
 * 回溯以 ; { } 为界：跨行选择器组（.a,\n.b {）能完整保留，又不会吞进上一条规则。
 * 先用原生 includes 剪枝：大部分导入文件不含当前悬停的选择器，跳过正则编译与遍历。
 */
function findSelectorBlocks(text: string, selector: string): string[] {
  const cleanText = stripCommentsSafe(text);
  if (!cleanText.includes(selector)) return [];

  const pattern = new RegExp(`${escapeRegExp(selector)}(?![\\w-])[^{}]*\\{`, 'g');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleanText)) !== null) {
    let depth = 1;
    let i = pattern.lastIndex;
    let inString: string | null = null;

    // 注释已剥离，只需跳过被保留的字符串（content: "}" 等）
    while (i < cleanText.length && depth > 0) {
      const char = cleanText[i];
      if (inString) {
        if (char === '\\') {
          i += 2;
          continue;
        }
        if (char === inString) inString = null;
        i++;
        continue;
      }
      if (char === '"' || char === "'") {
        inString = char;
        i++;
        continue;
      }
      if (char === '{') depth++;
      else if (char === '}') depth--;
      i++;
    }
    if (depth !== 0) continue;

    // 大括号计数已扫描到块闭合之后，跳过该区域避免下次 exec 重复扫描块内部
    pattern.lastIndex = i;

    // 向前回溯捕获完整的复合选择器头（.header .item 或 div.item）：
    // 以 ; { } 为界（注释已剥离），跨行选择器组（.container,\n.item）不丢前面的选择器
    let ruleStart = match.index;
    while (ruleStart > 0 && !/[;{}]/.test(cleanText[ruleStart - 1])) {
      ruleStart--;
    }

    const fullBlock = cleanText.slice(ruleStart, i).trim();
    const openBrace = fullBlock.indexOf('{');
    // 提取 body 并去掉首尾空行；以全部非空行的公共最小缩进为基准对齐后统一加展示缩进，
    // 避免以 body 首行为基准时（首行缩进更深，如 @media 嵌套）后续行被错误削字
    const rawBody = fullBlock.slice(openBrace + 1, fullBlock.lastIndexOf('}'));
    const bodyLines = rawBody.split('\n');
    while (bodyLines.length > 0 && !bodyLines[0].trim()) bodyLines.shift();
    while (bodyLines.length > 0 && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    if (bodyLines.length === 0) continue; // 空规则 {} 跳过

    const minIndent = bodyLines.reduce(
      (min, line) => (line.trim().length === 0 ? min : Math.min(min, line.match(/^[ \t]*/)?.[0].length ?? 0)),
      Infinity
    );
    const validMinIndent = minIndent === Infinity ? 0 : minIndent;
    const indented = bodyLines
      .map(line => (line.trim().length === 0 ? '' : `  ${line.slice(validMinIndent).trimEnd()}`))
      .join('\n');
    blocks.push(`${fullBlock.slice(0, openBrace).trim()} {\n${indented}\n}`);
  }

  return blocks;
}

/**
 * 样式悬浮：.class / #id 展示真实选择器声明（当前文档 + 导入文件），
 * @变量 与 --CSS 变量展示解析值。vue 只在 <style> 块内生效。
 */
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

    const range = document.getWordRangeAtPosition(position, HOVER_WORD);
    if (!range) return undefined;
    const word = document.getText(range);

    // @变量 与 --CSS 变量：展示解析后的值
    if (word.startsWith('@') || word.startsWith('--')) {
      const symbols = await collectImportedSymbols(document);
      const symbol = symbols.find(s => s.name === word);
      if (!symbol) return undefined;

      // @ 变量按 Less 高亮（CSS 高亮器会把 @variable 渲染为非法 At-Rule），-- 变量用 css
      const lang = word.startsWith('@') ? 'less' : 'css';
      const md = new vscode.MarkdownString();
      md.appendCodeblock(`${symbol.name}: ${symbol.value};`, lang);
      md.appendMarkdown(`定义于 \`${basename(vscode.Uri.file(symbol.filePath))}\``);
      return new vscode.Hover(md, range);
    }

    // .class / #id：查找真实声明（纯 hex 色值跳过）
    if (word.startsWith('.') || (word.startsWith('#') && !HEX_ONLY.test(word))) {
      const blocks = await this.findSelectorInScope(document, word);
      if (blocks.length === 0) return undefined;

      const md = new vscode.MarkdownString();
      md.appendCodeblock(blocks[0], 'css');
      if (blocks.length > 1) {
        md.appendMarkdown(`\n\n另有 ${blocks.length - 1} 处定义`);
      }
      return new vscode.Hover(md, range);
    }

    return undefined;
  }

  /** 在「当前文档的样式内容 + @import 引用的文件」中查找选择器声明 */
  private async findSelectorInScope(document: vscode.TextDocument, selector: string): Promise<string[]> {
    const scopes = getStyleBlocks(document).map(block => block.content);
    for (const uri of await collectImportedFiles(document)) {
      try {
        scopes.push(await readFileTextCached(uri));
      } catch {
        // 忽略不可读的导入文件
      }
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
