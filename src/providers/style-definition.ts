import { escapeRegExp } from '@/core/strings';
import { collectImportedSymbols, getStyleBlocks } from '@/providers/style-completion';
import { buildLineStarts, lineOf } from '@/utils/text';
import * as vscode from 'vscode';
import { STYLE_SYMBOL_LANGS } from './style-languages';

// re-export：历史导入路径兼容（test/performance.test.ts 从此处导入 buildLineStarts/lineOf），
// 实现已统一到 @/utils/text。
export { buildLineStarts, lineOf } from '@/utils/text';

// 可跳转的符号词形：变量 @x $x / CSS 变量 --x / mixin（less .mixin-name、scss @mixin-name）。
// 普通类/ID 跳转由内置 CSS 语言服务处理，这里不再处理 .class / #id。
const DEF_WORD = /([.#@$][\w-\\]+|--[\w-\\]+)/;

/** 找第一个定义位置（无匹配返回 undefined） */
export function findDefinitionRange(text: string, word: string): vscode.Range | undefined {
  return findDefinitionRanges(text, word)[0];
}

/**
 * 在样式文本中查找符号定义位置（支持跨行）。
 * 先屏蔽注释与字符串，再按符号类型构造定义正则：
 * 变量匹配 `@x:` / `$x:` / `--x:`（mixin 匹配 `@mixin x`），类/ID 匹配选择器声明段。
 * 返回的是匹配行「行尾」位置，即 VS Code 跳到该定义后的光标落点。
 */
export function findDefinitionRanges(text: string, word: string): vscode.Range[] {
  const cleanText = text.replace(/(['"`])(?:\\.|[^\\\r\n])*?(?:\1|\r?\n|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/.*/g, match =>
    match.replace(/[^\r\n]/g, ' ')
  );

  let pattern: RegExp;
  // 注意：所有正则均增加 'g' 标志以支持跨行全局搜索
  if (word.startsWith('@')) {
    const raw = word.slice(1);
    pattern = new RegExp(`@${escapeRegExp(raw)}[ \\t]*:|@mixin[ \\t]+${escapeRegExp(raw)}\\b`, 'g');
  } else if (word.startsWith('$')) {
    pattern = new RegExp(`\\$${escapeRegExp(word.slice(1))}[ \\t]*:`, 'g');
  } else if (word.startsWith('--')) {
    pattern = new RegExp(`--${escapeRegExp(word.slice(2))}[ \\t]*:`, 'g');
  } else if (word.startsWith('.')) {
    pattern = new RegExp(`\\.${escapeRegExp(word.slice(1))}(?![\\w-])[^{};\\n]*[{,]`, 'g');
  } else if (word.startsWith('#')) {
    pattern = new RegExp(`#${escapeRegExp(word.slice(1))}(?![\\w-])[^{};\\n]*[{,]`, 'g');
  } else {
    return [];
  }

  // 行偏移索引一次构建，行号换算由 O(match.index) 降为 O(log n)
  const lineStarts = buildLineStarts(cleanText);
  const ranges: vscode.Range[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleanText)) !== null) {
    const line = lineOf(lineStarts, match.index);
    const lineStart = lineStarts[line];

    // 定位到当前行的末尾，还原原始业务逻辑的 range 指向
    let lineEnd = cleanText.indexOf('\n', match.index);
    if (lineEnd === -1) lineEnd = cleanText.length;
    if (cleanText[lineEnd - 1] === '\r') lineEnd--;

    const pos = new vscode.Position(line, lineEnd - lineStart);
    ranges.push(new vscode.Range(pos, pos));
  }

  return ranges;
}

/** 样式符号定义跳转：变量/类/ID → 本文件或导入文件中的定义位置 */
export class StyleDefinitionProvider implements vscode.DefinitionProvider {
  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Definition | undefined> {
    // vue：光标不在 <style> 块内时不参与（模板里的类名交给其他语言服务）
    if (document.languageId === 'vue') {
      const offset = document.offsetAt(position);
      const inStyle = getStyleBlocks(document).some(block => offset >= block.start && offset <= block.end);
      if (!inStyle) return undefined;
    }

    let wordRange = document.getWordRangeAtPosition(position, DEF_WORD);
    let word = wordRange ? document.getText(wordRange) : '';

    // 兜底：光标在 @include/@mixin 后紧跟的标识符上时，按变量名补 @ 前缀
    if (!word) {
      const simpleRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_-]+/);
      if (simpleRange) {
        const lineText = document.lineAt(position.line).text;
        const textBefore = lineText.slice(0, simpleRange.start.character);
        if (/@(include|mixin)\s+$/.test(textBefore)) {
          wordRange = simpleRange;
          word = `@${document.getText(simpleRange)}`;
        }
      }
    }

    if (!wordRange || !word) return undefined;

    const locations: vscode.Location[] = [];

    // 变量类（@ / $ / --）：从导入关系展开的符号表里找定义位置——符号已带 offset/line，
    // 直接定位（ParsedSymbol），不再对每个定义文件做 findDefinitionRanges 全文正则。
    if (word.startsWith('@') || word.startsWith('$') || word.startsWith('--')) {
      const symbols = await collectImportedSymbols(document);
      const matchedSymbols = symbols.filter(s => s.name === word);
      if (matchedSymbols.length === 0) return undefined;

      const seen = new Set<string>();
      for (const s of matchedSymbols) {
        const targetUri = vscode.Uri.file(s.filePath);
        const key = `${s.filePath}:${s.line}`;
        if (seen.has(key)) continue; // 同文件同行（如 @x 与 $x 同名场景）去重
        seen.add(key);
        // 显式 zero-length Range（Location 传 Position 时 shim 不转 Range，真机虽兼容但统一更稳）
        const pos = new vscode.Position(s.line, s.lineEndCharacter);
        locations.push(new vscode.Location(targetUri, new vscode.Range(pos, pos)));
      }

      if (locations.length === 0) return undefined;
      return locations.length === 1 ? locations[0] : locations;
    }

    // mixin：less `.mixin-name` 与 scss `@mixin-name` 都从符号表定位（mixin 不在 selectorDefs，
    // 普通类/ID 跳转交给内置 CSS 语言服务，这里不再处理 .class / #id）。
    if (word.startsWith('.') || word.startsWith('@')) {
      const symbols = await collectImportedSymbols(document);
      // 只匹配 mixin 符号（less kind='mixin'，scss kind='scss-mixin'）；
      // 变量（kind='variable'/'css-variable'/'scss-variable'）在上面的 @ / $ / -- 分支已处理。
      const matchedSymbols = symbols.filter(s => s.name === word && (s.kind === 'mixin' || s.kind === 'scss-mixin'));
      if (matchedSymbols.length === 0) return undefined;

      const seen = new Set<string>();
      for (const s of matchedSymbols) {
        const targetUri = vscode.Uri.file(s.filePath);
        const key = `${s.filePath}:${s.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pos = new vscode.Position(s.line, s.lineEndCharacter);
        locations.push(new vscode.Location(targetUri, new vscode.Range(pos, pos)));
      }

      if (locations.length === 0) return undefined;
      return locations.length === 1 ? locations[0] : locations;
    }

    return undefined;
  }
}

export function registerStyleDefinition(): vscode.Disposable {
  const provider = new StyleDefinitionProvider();
  const selectors = STYLE_SYMBOL_LANGS.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerDefinitionProvider(selectors, provider);
}
