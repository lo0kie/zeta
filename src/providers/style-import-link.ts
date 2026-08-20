import { resolveImportFileTargets } from '@/providers/path-definition';
import { TtlCache } from '@/core/ttl-cache';
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
  // 链接列表按文档版本缓存：编辑过程中 provideDocumentLinks 被反复请求（每次光标移动），
  // 同版本直接返回，避免每条 import 重复走 resolveImportFileTargets 的 stat 探测。
  // 用 TtlCache（带容量上限 + 惰性过期清理）而非裸 Map，防止长期会话中关闭文档后 key 无界积累。
  private _linksCache = new TtlCache<{ version: number; links: vscode.DocumentLink[] }>(60_000);
  // 当前一次 provide 内的 rawPath → resolveImportFileTargets 的 Promise 去重表：
  // 多个 import 指向同一目标时复用同一个探测 Promise，避免并发穿透到 stat。
  private _resolvePromises = new Map<string, Promise<vscode.Uri[]>>();

  /** 关闭文档时主动释放其缓存条目（配合 onDidCloseTextDocument） */
  public clearLink(uri: vscode.Uri): void {
    this._linksCache.delete(uri.toString());
  }

  public async provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.DocumentLink[]> {
    const cacheKey = document.uri.toString();
    const cached = this._linksCache.get(cacheKey);
    if (cached && cached.version === document.version) return cached.links;

    const lineCount = document.lineCount;

    // 先同步收集全部匹配（保持行序），再 Promise.all 并行 resolve（每条都会触发 stat 探测，
    // 串行 await 会按 N 倍放大首次渲染延迟；probe-cache 已在缓存命中时免读盘）。
    // 每个 import 位置都要有链接（不能去重丢位置），但相同 rawPath 的解析只做一次、结果复用：
    // 避免同层并发 Promise 在 probe-cache 写入前全部穿透到 resolveImportUriUncached 造成重复 I/O。
    const matches: { line: number; m: RegExpExecArray }[] = [];
    this._resolvePromises.clear();
    for (let line = 0; line < lineCount; line++) {
      const text = document.lineAt(line).text;

      STYLE_IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = STYLE_IMPORT_RE.exec(text)) !== null) matches.push({ line, m });

      STYLE_URL_RE.lastIndex = 0;
      while ((m = STYLE_URL_RE.exec(text)) !== null) matches.push({ line, m });
    }

    const resolved = await Promise.all(matches.map(({ line, m }) => this.linkForMatch(document, line, m)));
    const links = resolved.filter((link): link is vscode.DocumentLink => link !== undefined);

    this._linksCache.set(cacheKey, { version: document.version, links });
    return links;
  }

  /** 把一条 import/url 匹配转成 DocumentLink（无法解析为本地文件时返回 undefined） */
  private async linkForMatch(
    document: vscode.TextDocument,
    line: number,
    m: RegExpExecArray
  ): Promise<vscode.DocumentLink | undefined> {
    const rawPath = m[2].trim();
    if (!rawPath || EXTERNAL_RE.test(rawPath)) return undefined;

    // 字符串字面量范围（含引号），让链接下划线覆盖整个路径
    const quoteStart = m.index + m[0].indexOf(m[1]);
    const stringEnd = quoteStart + 1 + m[2].length + 1;
    const range = new vscode.Range(line, quoteStart, line, stringEnd);

    // 同 rawPath 复用同一个解析 Promise（probe-cache 写入前的并发穿透靠它消除）
    let p = this._resolvePromises.get(rawPath);
    if (!p) {
      p = resolveImportFileTargets(document, rawPath);
      this._resolvePromises.set(rawPath, p);
    }
    const targets = await p;
    if (targets.length === 0) return undefined;

    const link = new vscode.DocumentLink(range, targets[0]);
    link.tooltip = targets[0].fsPath;
    return link;
  }
}

let linkProvider: StyleImportLinkProvider | undefined;

export function registerStyleImportLinks(): vscode.Disposable {
  linkProvider = new StyleImportLinkProvider();
  const selectors = STYLE_LINK_LANGS.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerDocumentLinkProvider(selectors, linkProvider);
}

/** 文档关闭时清理其 import 链接缓存；在 activate 中调用，避免长会话 Map 无界增长 */
export function clearLinkCache(uri: vscode.Uri): void {
  linkProvider?.clearLink(uri);
}
