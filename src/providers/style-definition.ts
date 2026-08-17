import { escapeRegExp } from '@/core/strings';
import {
  collectImportedFiles,
  collectImportedSymbols,
  getStyleBlocks,
  readFileTextCached,
} from '@/providers/style-completion';
import * as vscode from 'vscode';

const STYLE_LANGUAGES = ['css', 'less', 'scss', 'sass', 'vue'];
const DEF_WORD = /([.#@$][a-zA-Z0-9_-]+|--[a-zA-Z0-9_-]+)/;

export function findDefinitionRange(text: string, word: string): vscode.Range | undefined {
  return findDefinitionRanges(text, word)[0];
}

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

  const ranges: vscode.Range[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleanText)) !== null) {
    let line = 0;
    let lastNewLine = -1;
    // 换算当前绝对偏移对应的行号
    for (let i = 0; i < match.index; i++) {
      if (cleanText[i] === '\n') {
        line++;
        lastNewLine = i;
      }
    }

    // 定位到当前行的末尾，还原原始业务逻辑的 range 指向
    let lineEnd = cleanText.indexOf('\n', match.index);
    if (lineEnd === -1) lineEnd = cleanText.length;
    if (cleanText[lineEnd - 1] === '\r') lineEnd--;

    const pos = new vscode.Position(line, lineEnd - (lastNewLine + 1));
    ranges.push(new vscode.Range(pos, pos));
  }

  return ranges;
}

export class StyleDefinitionProvider implements vscode.DefinitionProvider {
  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Definition | undefined> {
    if (document.languageId === 'vue') {
      const offset = document.offsetAt(position);
      const inStyle = getStyleBlocks(document).some(block => offset >= block.start && offset <= block.end);
      if (!inStyle) return undefined;
    }

    let wordRange = document.getWordRangeAtPosition(position, DEF_WORD);
    let word = wordRange ? document.getText(wordRange) : '';

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

    if (word.startsWith('@') || word.startsWith('$') || word.startsWith('--')) {
      const symbols = await collectImportedSymbols(document);
      const matchedSymbols = symbols.filter(s => s.name === word);
      if (matchedSymbols.length === 0) return undefined;

      const filePaths = Array.from(new Set(matchedSymbols.map(s => s.filePath)));
      for (const filePath of filePaths) {
        const targetUri = vscode.Uri.file(filePath);
        try {
          const targetText = await readFileTextCached(targetUri);
          const ranges = findDefinitionRanges(targetText, word);
          if (ranges.length > 0) {
            for (const range of ranges) {
              locations.push(new vscode.Location(targetUri, range));
            }
          } else {
            locations.push(new vscode.Location(targetUri, new vscode.Position(0, 0)));
          }
        } catch {}
      }

      if (locations.length === 0) return undefined;
      return locations.length === 1 ? locations[0] : locations;
    }

    if (word.startsWith('.') || word.startsWith('#')) {
      const files = [document.uri, ...(await collectImportedFiles(document))];
      for (const uri of files) {
        try {
          const text = await readFileTextCached(uri);
          const ranges = findDefinitionRanges(text, word);
          for (const range of ranges) {
            locations.push(new vscode.Location(uri, range));
          }
        } catch {}
      }

      if (locations.length === 0) return undefined;
      return locations.length === 1 ? locations[0] : locations;
    }

    return undefined;
  }
}

export function registerStyleDefinition(): vscode.Disposable {
  const provider = new StyleDefinitionProvider();
  const selectors = STYLE_LANGUAGES.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerDefinitionProvider(selectors, provider);
}
