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

/**
 * 一层解引用：变量值里引用的其他变量（var(--x) / @y / $y）再展开一层实际值。
 * 只在「引用的变量能查到且本身是纯值」时追加说明行，避免把复杂链无限展开。
 * 例如 `--brand: var(--primary)` 悬浮时追加「--primary = #ff9500」。
 */
export function appendVarDeref(
  md: vscode.MarkdownString,
  symbols: StyleDocSymbol[],
  allSymbols: StyleDocSymbol[]
): void {
  const derefLines: string[] = [];
  const seen = new Set<string>();
  for (const s of symbols) {
    // 匹配 var(--x)、@y、$y 引用
    const refRe = /(var\(\s*--[a-zA-Z0-9_-]+\s*\)|[@$][a-zA-Z0-9_-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(s.value)) !== null) {
      const raw = m[1];
      // 取变量名：var(--x) → --x；@y/$y → 去掉前缀。用捕获组提取，避免带上 ) 或前缀
      const name = raw.startsWith('var(') ? (raw.match(/--[a-zA-Z0-9_-]+/) ?? [''])[0] : raw;
      if (name === s.name || seen.has(name)) continue; // 跳过自引用与已展示
      const target = allSymbols.find(t => t.name === name && isPureColor(t.value));
      if (!target) continue;
      seen.add(name);
      derefLines.push(`\`${name}\` = \`${target.value}\``);
    }
  }
  if (derefLines.length > 0) {
    md.appendMarkdown('\n\n' + derefLines.join('  \n'));
  }
}
