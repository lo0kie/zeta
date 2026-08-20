// 测试脚手架：配置注入、工作区根、文档工具（vitest 下 'vscode' 经 alias 指向 shim，与 src 同实例）
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import * as vscode from 'vscode';

// 供 makeDocument 等构造离线文档对象使用（与测试/ src 共享同一 shim 实例）
const { Uri, Position, Range } = vscode;

let rootCounter = 0;

/** 创建一次性临时工作区，返回根路径 */
export function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), `zeta-test-${rootCounter++}-`));
  globalThis.__zetaWsRoot = ws;
  return ws;
}

/**
 * 注入 zeta 配置（key 为完整配置名，如 'zeta.packageScript.askArguments'）。
 * 直接写入 globalThis.__zetaCfg，由 shim 的 getConfiguration 读取——
 * 不再覆盖 vscode API（此前 helpers 直接重赋值 getConfiguration / 事件属错误写法）。
 */
export function setConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  globalThis.__zetaCfg = cfg;
  return cfg;
}

/** 清除配置与工作区根，删除临时目录 */
export function cleanup(ws?: string): void {
  delete globalThis.__zetaCfg;
  delete globalThis.__zetaWsRoot;
  delete globalThis.__lastApply;
  if (ws) rmSync(ws, { recursive: true, force: true });
}

const norm = (p: string): string => normalize(p).replace(/[\\/]+$/, '');

// ── 常用工具函数（从各测试文件提取，消除重复定义）──

/** 统一分隔符（win 路径 → 正斜杠），用于路径断言 */
export const normSep = (p: string): string => (p ? p.replace(/\\/g, '/') : p);

/** CompletionList 解包：返回 items 数组（兼容直接返回数组的旧实现） */
export const unwrapItems = (result: vscode.CompletionList | unknown[] | undefined | null): vscode.CompletionItem[] =>
  result ? (Array.isArray(result) ? (result as vscode.CompletionItem[]) : result.items) : [];

/** 用 shim 的 Uri 构造 file uri（与 src 共享同一 shim 实例） */
export const makeUri = (p: string): vscode.Uri => vscode.Uri.file(p);

/** 构造离线 TextDocument（esbuild 转译出的模块可用），支持 range/offsetAt/positionAt/wordRange */
export function makeDocument(text: string, filePath: string, languageId: string, version = 1): vscode.TextDocument {
  const lines = text.split('\n');
  const offsetAt = (pos: vscode.Position): number => {
    let off = 0;
    for (let i = 0; i < pos.line; i++) off += lines[i].length + 1;
    return off + pos.character;
  };

  const doc: vscode.TextDocument = {
    uri: Uri.file(filePath),
    languageId,
    version,
    lineCount: lines.length,
    getText: (range: vscode.Range | null) => (range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text),
    offsetAt,
    positionAt: (off: number): vscode.Position => {
      let line = 0;
      let remaining = off;
      while (line < lines.length && remaining > lines[line].length) {
        remaining -= lines[line].length + 1;
        line++;
      }
      return new Position(line, Math.max(0, remaining));
    },
    lineAt: (pos: number | vscode.Position): vscode.TextLine => {
      const line = typeof pos === 'number' ? pos : pos.line;
      const safeLine = Math.min(Math.max(0, line), Math.max(0, lines.length - 1));
      const lineText = lines[safeLine] ?? '';
      const isLast = safeLine === lines.length - 1;
      return {
        text: lineText,
        range: new Range(safeLine, 0, safeLine, lineText.length),
        rangeIncludingLineBreak: new Range(safeLine, 0, isLast ? safeLine : safeLine + 1, isLast ? lineText.length : 0),
        lineNumber: safeLine,
        firstNonWhitespaceCharacterIndex: lineText.length - lineText.trimStart().length,
        isEmptyOrWhitespace: lineText.trim().length === 0,
      };
    },
    getWordRangeAtPosition: (pos: vscode.Position, regex: RegExp = /[\w$]+/): vscode.Range | undefined => {
      const line = lines[pos.line] ?? '';
      const pattern = new RegExp(regex.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(line)) !== null) {
        if (m.index <= pos.character && m.index + m[0].length >= pos.character) {
          return new Range(new Position(pos.line, m.index), new Position(pos.line, m.index + m[0].length));
        }
      }
      return undefined;
    },
  } as unknown as vscode.TextDocument;
  return doc;
}

export { norm };

/**
 * 提取 Hover.contents 的纯文本。contents 可能为 MarkdownString / MarkedString / 数组，
 * 统一规整为字符串以便断言。
 */
export function hoverText(hover: vscode.Hover): string {
  const c = hover.contents;
  if (Array.isArray(c)) return c.map(markdownValue).join('\n');
  return markdownValue(c);
}

function markdownValue(c: vscode.MarkdownString | vscode.MarkedString): string {
  return typeof c === 'string' ? c : c.value;
}

/** 空 CancellationToken，供测试向需要 token 的 provideX 方法传参（被测逻辑不依赖 token） */
export const noopToken: vscode.CancellationToken = undefined as unknown as vscode.CancellationToken;

/** 空 TextEditorEdit，供测试向命令传参（被测命令的 _edit 参数均未使用） */
export const noopEdit: vscode.TextEditorEdit = undefined as unknown as vscode.TextEditorEdit;

/** 包装 shim 的 workspace.fs 方法并计数（缓存命中测试用）。
 *  类型与 vscode-shim.ts 的 workspace.fs 实现范围严格一致（仅 stat/readFile/readDirectory），
 *  需要计数其他方法时先补 shim 实现再扩此联合类型——避免类型签名「骗过」编译器。 */
export function countFs(method: 'readDirectory' | 'readFile' | 'stat') {
  const fs = vscode.workspace.fs as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = fs[method];
  let count = 0;
  const wrapped = async (...args: unknown[]): Promise<unknown> => {
    count++;
    return original(...args);
  };
  fs[method] = wrapped;
  return {
    count: () => count,
    restore: () => {
      fs[method] = original;
    },
  };
}

/**
 * 构造离线 TextEditor 包裹。document 由 makeDocument 提供，selections 与 options 可选。
 * 类型为 vscode.TextEditor 以满足被测函数的签名要求（测试用极简 mock）。
 */
export function editorWith(
  doc: vscode.TextDocument,
  selections: vscode.Selection | vscode.Selection[],
  options: vscode.TextEditorOptions = { insertSpaces: true, tabSize: 2 }
): vscode.TextEditor {
  const selArray = Array.isArray(selections) ? selections : [selections];
  const editor = {
    document: doc,
    selections: selArray,
    options,
    revealRange: async (): Promise<void> => {},
    get selection(): vscode.Selection {
      return editor.selections[0];
    },
    set selection(sel: vscode.Selection) {
      editor.selections = [sel];
    },
    insertSnippet: async (
      snippet: vscode.SnippetString | string,
      location?: vscode.Range | vscode.Range[] | vscode.Position | vscode.Position[]
    ): Promise<boolean> => {
      const snippetStr = typeof snippet === 'string' ? snippet : snippet.value;
      const rawRanges = location ? (Array.isArray(location) ? location : [location]) : editor.selections;
      const ranges = rawRanges.map(loc => {
        if (loc instanceof vscode.Range) return loc;
        return new vscode.Range(loc, loc);
      });
      const ops = ranges.map(range => ({
        range,
        text: snippetStr,
        snippet: snippetStr,
      }));
      globalThis.__lastApply = ops;
      return true;
    },
  };
  return editor as unknown as vscode.TextEditor;
}
