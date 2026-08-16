import { scanStringTokens } from '@/utils/quote';
import { TtlCache } from '@/core/ttl-cache';
import * as vscode from 'vscode';
import { getStyleBlocks } from './style-completion';

// 内置颜色只覆盖 css/less/scss。这里补两类内置没有的场景：
// 1. JS/TS/JSX/TSX 字符串字面量里的颜色（const c = '#ff0000'、:style="{ color: '#0f0' }"）
// 2. vue 的 <style> 块（内置不覆盖 SFC）
const COLOR_LANGUAGES = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'vue'];

/** 匹配 #fff / #ff00 / #ffffff / #ff00ff80（8 位含 alpha） */
const HEX_PATTERN = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

/** 匹配 rgb(255, 0, 0) / rgba(255, 0, 0, 0.5)，alpha 支持 0-1 小数或 0-100% */
const RGB_PATTERN = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+%?)\s*)?\)/gi;

// 文档级结果缓存：VS Code 在文档变化后会重新请求颜色，同一版本内直接复用
const COLOR_CACHE_TTL_MS = 10000;
const colorResultCache = new TtlCache<{ version: number; colors: vscode.ColorInformation[] }>(COLOR_CACHE_TTL_MS);

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, value));
}

function parseHexColor(hex: string): vscode.Color | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 1;

  if (hex.length === 3 || hex.length === 4) {
    r = parseInt(hex[0] + hex[0], 16) / 255;
    g = parseInt(hex[1] + hex[1], 16) / 255;
    b = parseInt(hex[2] + hex[2], 16) / 255;
    if (hex.length === 4) a = parseInt(hex[3] + hex[3], 16) / 255;
  } else if (hex.length === 6 || hex.length === 8) {
    r = parseInt(hex.slice(0, 2), 16) / 255;
    g = parseInt(hex.slice(2, 4), 16) / 255;
    b = parseInt(hex.slice(4, 6), 16) / 255;
    if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
  } else {
    return null;
  }

  return new vscode.Color(r, g, b, a);
}

function parseRgbColor(r: string, g: string, b: string, alpha?: string): vscode.Color | null {
  const red = Number(r);
  const green = Number(g);
  const blue = Number(b);
  if (red > 255 || green > 255 || blue > 255) return null;

  let a = 1;
  if (alpha !== undefined) {
    if (alpha.endsWith('%')) {
      a = Number(alpha.slice(0, -1)) / 100;
    } else {
      a = Number(alpha);
    }
    if (Number.isNaN(a)) return null;
  }
  if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) return null;

  return new vscode.Color(red / 255, green / 255, blue / 255, Math.min(1, Math.max(0, a)));
}

/**
 * JS/TS 字符串与 vue <style> 块的颜色小色块与拾色器。
 * 字符串扫描复用 scanStringTokens：注释与正则字面量会被跳过，
 * 模板字符串的 ${expr} 部分是代码，整体跳过（内部的字符串会被作为独立 token 单独扫到）。
 */
export class StyleColorProvider implements vscode.DocumentColorProvider {
  public provideDocumentColors(document: vscode.TextDocument): vscode.ColorInformation[] {
    const cacheKey = document.uri.toString();
    const cached = colorResultCache.get(cacheKey);
    if (cached && cached.version === document.version) return cached.colors;

    const text = document.getText();

    // 快速路径：全文不含任何色值标记时直接返回，避免大文件（5000+ 行）走完整分词状态机
    if (!/[#]|rgb/i.test(text)) {
      colorResultCache.set(cacheKey, { version: document.version, colors: [] });
      return [];
    }

    const colors: vscode.ColorInformation[] = [];
    const seen = new Set<string>();

    // vue：<style> 块是样式文本，直接匹配颜色
    if (document.languageId === 'vue') {
      for (const block of getStyleBlocks(document)) {
        this.scanPlainText(block.content, block.start, document, colors, seen);
      }
    }

    // 全部语言：字符串字面量内的颜色；模板字符串将 ${...} 插值替换为等长空格后扫描，
    // 屏蔽插值内 JS 代码的同时，静态文本段（如 `color: #ff0000; width: ${w}px` 里的 #ff0000）
    // 的色值偏移不受影响，不会被整条跳过
    for (const token of scanStringTokens(text)) {
      const content = text.slice(token.start + 1, token.end - 1);
      if (token.quote === '`') {
        const safeContent = content.replace(/\${[\s\S]*?}/g, match => ' '.repeat(match.length));
        this.scanPlainText(safeContent, token.start + 1, document, colors, seen);
      } else {
        this.scanPlainText(content, token.start + 1, document, colors, seen);
      }
    }

    colorResultCache.set(cacheKey, { version: document.version, colors });

    return colors;
  }

  /** 在纯文本里匹配 hex / rgb，偏移按 baseOffset 换算到文档坐标，按范围去重 */
  private scanPlainText(
    text: string,
    baseOffset: number,
    document: vscode.TextDocument,
    colors: vscode.ColorInformation[],
    seen: Set<string>
  ): void {
    let match: RegExpExecArray | null;
    HEX_PATTERN.lastIndex = 0;
    while ((match = HEX_PATTERN.exec(text)) !== null) {
      const color = parseHexColor(match[1]);
      if (!color) continue;
      const start = baseOffset + match.index;
      const end = start + match[0].length;
      const key = `${start}-${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      colors.push(new vscode.ColorInformation(new vscode.Range(document.positionAt(start), document.positionAt(end)), color));
    }

    RGB_PATTERN.lastIndex = 0;
    while ((match = RGB_PATTERN.exec(text)) !== null) {
      const color = parseRgbColor(match[1], match[2], match[3], match[4]);
      if (!color) continue;
      const start = baseOffset + match.index;
      const end = start + match[0].length;
      const key = `${start}-${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      colors.push(new vscode.ColorInformation(new vscode.Range(document.positionAt(start), document.positionAt(end)), color));
    }
  }

  public provideColorPresentations(
    color: vscode.Color,
    _context: { document: vscode.TextDocument; range: vscode.Range }
  ): vscode.ColorPresentation[] {
    const r = Math.round(clampChannel(color.red * 255));
    const g = Math.round(clampChannel(color.green * 255));
    const b = Math.round(clampChannel(color.blue * 255));
    const a = color.alpha;

    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    const hexStr = `#${toHex(r)}${toHex(g)}${toHex(b)}${a < 1 ? toHex(Math.round(a * 255)) : ''}`;
    const rgbStr = a < 1 ? `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(2))})` : `rgb(${r}, ${g}, ${b})`;

    return [new vscode.ColorPresentation(hexStr), new vscode.ColorPresentation(rgbStr)];
  }
}

export function registerStyleColor(): vscode.Disposable {
  const provider = new StyleColorProvider();
  const selectors = COLOR_LANGUAGES.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerColorProvider(selectors, provider);
}

/** 文档关闭时释放颜色结果缓存 */
export function clearColorCache(uri: vscode.Uri): void {
  colorResultCache.delete(uri.toString());
}
