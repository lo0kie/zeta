/**
 * 样式符号的 Markdown 文档渲染：hover 与 completion 共用，保证两处展示完全一致。
 * - 变量 / CSS 变量：代码块展示「定义的样子」`scope name: value;`，语言 id 跟随来源文件，
 *   并在代码块下方对纯色变量追加色块预览行（代码块内无法渲染 Markdown 图片，只能放代码块外）。
 * - mixin：代码块展示定义文本 `scope value`，语言 id 跟随来源文件。
 */
import * as vscode from 'vscode';
import { createColorSwatchUri, isPureColor } from '../utils/color';

/** 文档渲染所需的符号最小字段（hover 的 ParsedSymbol / completion 的 StyleSymbol 均满足） */
export interface StyleDocSymbol {
  name: string;
  value: string;
  scope?: string;
  filePath: string;
}

/** 从符号来源文件路径推断代码块语言 id（less 用 less、scss 用 scss，其余 css） */
export function languageFromFilePath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.less')) return 'less';
  if (lower.endsWith('.scss') || lower.endsWith('.sass')) return 'scss';
  return 'css';
}

/**
 * 变量 / CSS 变量（@x / $x / --x）文档：代码块展示「定义的样子」（多个命名空间全部展示，
 * 每行一个），纯色变量再在代码块下方追加色块预览行。阴影/渐变等整体非纯色的复杂值不渲染色块。
 */
export function appendStyleVariableDoc(md: vscode.MarkdownString, symbols: StyleDocSymbol[]): void {
  md.appendCodeblock(
    symbols.map(s => `${s.scope ? `${s.scope} ` : ''}${s.name}: ${s.value};`).join('\n'),
    languageFromFilePath(symbols[0].filePath)
  );

  // 代码块内无法渲染 Markdown 图片（![]() 显示为字面），色块只能追加在代码块之外。
  // 只对整体为纯色的值（isPureColor）加色块；阴影/渐变等含颜色片段但非纯色的复杂值跳过。
  // 多个色块之间用「行尾两空格 + \n」（hard break）真正换行：
  // 普通单个 \n 在 CommonMark 里是 soft break，渲染成空格，多命名空间色块会挤在同一行。
  const colorSymbols = symbols.filter(s => isPureColor(s.value));
  if (colorSymbols.length > 0) {
    md.appendMarkdown(
      '\n\n' + colorSymbols.map(s => `![${s.value}](${createColorSwatchUri(s.value)}) \`${s.value}\``).join('  \n')
    );
  }
}

/**
 * mixin 文档：代码块展示定义文本（less `.mixin-name(params)` / scss `@mixin name(params)`），
 * 多个命名空间全部展示；语言 id 跟随来源文件（less 用 less、scss 用 scss）。
 */
export function appendStyleMixinDoc(md: vscode.MarkdownString, symbols: StyleDocSymbol[]): void {
  md.appendCodeblock(
    symbols.map(s => (s.scope ? `${s.scope} ${s.value}` : s.value)).join('\n'),
    languageFromFilePath(symbols[0].filePath)
  );
}
