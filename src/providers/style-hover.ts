import * as vscode from 'vscode';
import { collectImportedSymbols, getStyleBlocks } from './style-completion';
import { STYLE_SYMBOL_LANGS } from './style-languages';
import { appendStyleMixinDoc, appendStyleVariableDoc, appendVarDeref } from './style-markdown';

// 可悬浮的符号词形：变量 @x $x / CSS 变量 --x / mixin（less .mixin-name、scss @mixin-name）；
// [.#@$] 后允许 \w（字母数字下划线）、连字符与反斜杠转义（Tailwind 负值 .-mt-2、BEM 修饰符 ._hidden、arbitrary value .w-\[10px\]）。
// 普通类/ID 悬浮由内置 CSS 语言服务处理，这里不再处理 .class / #id。
const HOVER_WORD = /([.#@$][\w-\\]+|--[\w-\\]+)/;

/** 样式悬浮：变量 / CSS 变量（含 var(--xxx) 引用）/ mixin 显示解析值与定义位置 */
export class StyleHoverProvider implements vscode.HoverProvider {
  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    // vue：光标不在 <style> 块内时不参与
    if (document.languageId === 'vue') {
      const offset = document.offsetAt(position);
      const inStyle = getStyleBlocks(document).some(block => offset >= block.start && offset <= block.end);
      if (!inStyle) return undefined;
    }

    let range = document.getWordRangeAtPosition(position, HOVER_WORD);
    let word = range ? document.getText(range) : '';

    // 兜底：光标在 @include/@mixin 后的标识符上时补 @ 前缀
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

    const symbols = await collectImportedSymbols(document);
    const matchedSymbols = symbols.filter(s => s.name === word);
    if (matchedSymbols.length === 0) return undefined;

    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.isTrusted = true;

    // mixin：less `.mixin-name`（kind='mixin'）与 scss `@mixin-name`（kind='scss-mixin'）。
    // 展示定义文本（.mixin-name(params) / @mixin name(params)），多个命名空间全部展示；
    // 语言 id 跟随来源文件（less 用 less、scss 用 scss），避免硬编码 css 导致 mixin 语法高亮错误。
    // 注意：`@` 开头可能是 less 变量（@primary），因此必须按 kind 精确分流。
    // 渲染逻辑与 completion 共用（style-markdown）。
    const mixinSymbols = matchedSymbols.filter(s => s.kind === 'mixin' || s.kind === 'scss-mixin');
    if (mixinSymbols.length > 0) {
      appendStyleMixinDoc(md, mixinSymbols);
      return new vscode.Hover(md, range);
    }

    // 变量 / CSS 变量（@x / $x / --x，含 var(--xxx) 引用）：直接展示「定义的样子」，
    // 如 `@duration-fast: 0.16s;`、`--shadow-sm: 0 1px 3px rgba(...);`。
    // 多个命名空间（:root / .dark 等）全部展示，每行一个；代码块 + 下方纯色色块预览。
    // 渲染逻辑与 completion 共用（style-markdown）。
    appendStyleVariableDoc(md, matchedSymbols);
    // 一层解引用：值里引用的变量（var(--x)/@y/$y）再展开一层实际值
    appendVarDeref(md, matchedSymbols, symbols);
    return new vscode.Hover(md, range);
  }
}

export function registerStyleHover(): vscode.Disposable {
  const provider = new StyleHoverProvider();
  const selectors = STYLE_SYMBOL_LANGS.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerHoverProvider(selectors, provider);
}
