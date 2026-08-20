import { TtlCache } from '@/core/ttl-cache';
import {
  clampChannel,
  isPureColor,
  parseHexColor,
  parseHslColor,
  parseHwbColor,
  parseLabColor,
  parseLchColor,
  parseOklabColor,
  parseOklchColor,
  parseRgbColor,
  rgbToHex,
  rgbToHsl,
  rgbToHwb,
  rgbToLab,
  rgbToLch,
  rgbToOklab,
  rgbToOklch,
} from '@/utils/color';
import { scanStringTokens } from '@/utils/quote';
import * as vscode from 'vscode';
import { STYLE_LANGUAGES } from './style-languages';
import { collectImportedSymbols } from './style-completion';

// JS/TS/JSX/TSX 与 vue 的字符串字面量里找色值；
// 纯样式文件（css/scss/less 等）只扫 var(--x) 变量引用色块，普通色值由内置 CSS 语言服务处理。
const COLOR_LANGUAGES = [...STYLE_LANGUAGES, 'javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'vue'];
const STYLE_LANG_SET = new Set<string>(STYLE_LANGUAGES);

/**
 * 若 range 位于 `var(--x)` 引用内的变量名上，返回整个 `var(--x)` 的完整范围（含 var( 与 )）；
 * 否则返回 undefined。供写回时整体替换 var() 引用为真实色值。
 */
function findVarCallRange(document: vscode.TextDocument, varRange: vscode.Range): vscode.Range | undefined {
  const text = document.getText();
  const startOffset = document.offsetAt(varRange.start);
  const endOffset = document.offsetAt(varRange.end);
  const before = text.slice(0, startOffset);
  const after = text.slice(endOffset);
  // 变量名前最近的 `var(`（忽略空白）
  const openIdx = before.lastIndexOf('var(');
  if (openIdx < 0) return undefined;
  // `)` 之后最近的闭括号
  const closeIdx = after.indexOf(')');
  if (closeIdx < 0) return undefined;
  const fullStart = openIdx;
  const fullEnd = endOffset + closeIdx + 1; // 含 `)`
  return new vscode.Range(document.positionAt(fullStart), document.positionAt(fullEnd));
}

/** 依次尝试各 CSS 颜色解析器，返回首个可解析的 r/g/b/a；都无法解析返回 null */
function parseAnyColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const parsers = [
    (v: string) => parseHexColor(v),
    (v: string) => {
      const m = v.match(/^rgba?\(([^)]+)\)$/i);
      if (!m) return null;
      // 复用 parseRgbColor：支持逗号/空格分隔与 / alpha
      const parts = m[1].split(/[,\s/]+/).filter(Boolean);
      return parts.length >= 3 ? parseRgbColor(parts[0], parts[1], parts[2], parts[3]) : null;
    },
    (v: string) => {
      const m = v.match(/^hsla?\(([^)]+)\)$/i);
      if (!m) return null;
      const parts = m[1].split(/[,\s/]+/).filter(Boolean);
      return parts.length >= 3 ? parseHslColor(parts[0], parts[1], parts[2], parts[3]) : null;
    },
    (v: string) => {
      const m = v.match(/^hwb\(([^)]+)\)$/i);
      if (!m) return null;
      const parts = m[1].split(/[\s/]+/).filter(Boolean);
      return parts.length >= 3 ? parseHwbColor(parts[0], parts[1], parts[2], parts[3]) : null;
    },
    (v: string) => {
      const m = v.match(/^lab\(([^)]+)\)$/i);
      if (!m) return null;
      const parts = m[1].split(/[\s/]+/).filter(Boolean);
      return parts.length >= 3 ? parseLabColor(parts[0], parts[1], parts[2], parts[3]) : null;
    },
    (v: string) => {
      const m = v.match(/^lch\(([^)]+)\)$/i);
      if (!m) return null;
      const parts = m[1].split(/[\s/]+/).filter(Boolean);
      return parts.length >= 3 ? parseLchColor(parts[0], parts[1], parts[2], parts[3]) : null;
    },
    (v: string) => {
      const m = v.match(/^oklab\(([^)]+)\)$/i);
      if (!m) return null;
      const parts = m[1].split(/[\s/]+/).filter(Boolean);
      return parts.length >= 3 ? parseOklabColor(parts[0], parts[1], parts[2], parts[3]) : null;
    },
    (v: string) => {
      const m = v.match(/^oklch\(([^)]+)\)$/i);
      if (!m) return null;
      const parts = m[1].split(/[\s/]+/).filter(Boolean);
      return parts.length >= 3 ? parseOklchColor(parts[0], parts[1], parts[2], parts[3]) : null;
    },
  ] as ((v: string) => { r: number; g: number; b: number; a: number } | null)[];
  for (const parse of parsers) {
    const c = parse(value);
    if (c) return c;
  }
  return null;
}

const HEX_PATTERN = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

// rgb/hsl 各分量：整数/小数/百分比；h 额外支持 deg/grad/rad/turn
const CHANNEL_PATTERN = String.raw`(?:\d+(?:\.\d+)?|\.\d+)%?`;
const HUE_PATTERN = String.raw`-?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|grad|rad|turn)?`;
const ALPHA_PATTERN = String.raw`(?:\d+(?:\.\d+)?|\.\d+)%?`;

// rgba()/rgb()：兼容逗号与空格分隔（CSS Color 4），alpha 可用 / 分隔
const RGB_PATTERN = new RegExp(
  String.raw`rgba?\(\s*(${CHANNEL_PATTERN})\s*(?:,\s*|\s+)(${CHANNEL_PATTERN})\s*(?:,\s*|\s+)(${CHANNEL_PATTERN})\s*(?:(?:,|\/)\s*(${ALPHA_PATTERN})\s*)?\)`,
  'gi'
);

// 结果按文档版本缓存（文档改动即失效），避免重复扫描
const COLOR_CACHE_TTL_MS = 10000;
const colorResultCache = new TtlCache<{ version: number; colors: vscode.ColorInformation[] }>(COLOR_CACHE_TTL_MS);

const HSL_PATTERN = new RegExp(
  String.raw`hsla?\(\s*(${HUE_PATTERN})\s*(?:,\s*|\s+)(${CHANNEL_PATTERN})\s*(?:,\s*|\s+)(${CHANNEL_PATTERN})\s*(?:(?:,|\/)\s*(${ALPHA_PATTERN})\s*)?\)`,
  'gi'
);

// CSS Color 4：hwb / lab / lch / oklab / oklch 均为空格分隔，可选 `/ alpha`。
// 分量可带符号（lab/oklab 的 a/b 可为负），支持百分比。
const COLOR4_NUMBER = String.raw`-?(?:\d+(?:\.\d+)?|\.\d+)%?`;

const HWB_PATTERN = new RegExp(
  String.raw`hwb\(\s*(${HUE_PATTERN})\s+(${COLOR4_NUMBER})\s+(${COLOR4_NUMBER})\s*(?:/\s*(${ALPHA_PATTERN})\s*)?\)`,
  'gi'
);
const LAB_PATTERN = new RegExp(
  // (?<!ok) 防止在 oklab( 内部 index 处误匹配 lab( → 产生重复色块
  String.raw`(?<!ok)lab\(\s*(${COLOR4_NUMBER})\s+(${COLOR4_NUMBER})\s+(${COLOR4_NUMBER})\s*(?:/\s*(${ALPHA_PATTERN})\s*)?\)`,
  'gi'
);
const LCH_PATTERN = new RegExp(
  // (?<!ok) 防止在 oklch( 内部 index 处误匹配 lch( → 产生重复色块
  String.raw`(?<!ok)lch\(\s*(${COLOR4_NUMBER})\s+(${COLOR4_NUMBER})\s+(${HUE_PATTERN})\s*(?:/\s*(${ALPHA_PATTERN})\s*)?\)`,
  'gi'
);
const OKLAB_PATTERN = new RegExp(
  String.raw`oklab\(\s*(${COLOR4_NUMBER})\s+(${COLOR4_NUMBER})\s+(${COLOR4_NUMBER})\s*(?:/\s*(${ALPHA_PATTERN})\s*)?\)`,
  'gi'
);
const OKLCH_PATTERN = new RegExp(
  String.raw`oklch\(\s*(${COLOR4_NUMBER})\s+(${COLOR4_NUMBER})\s+(${HUE_PATTERN})\s*(?:/\s*(${ALPHA_PATTERN})\s*)?\)`,
  'gi'
);

/** 为 JS/TS/vue 字符串字面量中的 hex / rgb / hsl 色值提供色块与拾色器；vue <style> 内 var(--x) 引用追加色块 */
export class StyleColorProvider implements vscode.DocumentColorProvider {
  public async provideDocumentColors(document: vscode.TextDocument): Promise<vscode.ColorInformation[]> {
    const cacheKey = document.uri.toString();
    const cached = colorResultCache.get(cacheKey);
    if (cached && cached.version === document.version) return cached.colors;

    const text = document.getText();

    // 快速路径：全文无任何色值标记直接返回空
    if (!/[#]|rgb|hsl|hwb|lab|lch|oklab|oklch|var\(/i.test(text)) {
      colorResultCache.set(cacheKey, { version: document.version, colors: [] });
      return [];
    }

    const colors: vscode.ColorInformation[] = [];
    const seen = new Set<string>();

    // 纯样式文件（css/scss/less…）：普通色值由内置 CSS 语言服务提供色块，
    // zeta 只补充 `var(--x)` 变量引用色块（内置插件不处理 var() 引用）。
    if (STYLE_LANG_SET.has(document.languageId)) {
      await this.scanVarReferences(document, colors, seen);
      colorResultCache.set(cacheKey, { version: document.version, colors });
      return colors;
    }

    // JS/TS/Vue：逐个字符串字面量扫描（注释/正则中的假色值天然被排除）
    for (const token of scanStringTokens(text)) {
      const content = text.slice(token.start + 1, token.end - 1);
      if (token.quote === '`') {
        // 模板字符串：把 ${...} 插值替换成等长空白，避免插值里的文本误报色值
        const safeContent = content.replace(/\${[\s\S]*?}/g, match => ' '.repeat(match.length));
        this.scanPlainText(safeContent, token.start + 1, document, colors, seen);
      } else {
        this.scanPlainText(content, token.start + 1, document, colors, seen);
      }
    }

    // vue <style> 块内的 `var(--x)` 引用：查符号表取值，纯色则挂只读色块（读代码时直接看颜色）
    if (document.languageId === 'vue') {
      await this.scanVarReferences(document, colors, seen);
    }

    colorResultCache.set(cacheKey, { version: document.version, colors });
    return colors;
  }

  /** 扫描全文 var(--x) 引用（vue <style> / 纯样式文件），若符号表里是纯色则在 var() 引用处挂色块 */
  private async scanVarReferences(
    document: vscode.TextDocument,
    colors: vscode.ColorInformation[],
    seen: Set<string>
  ): Promise<void> {
    const text = document.getText();
    const symbols = await collectImportedSymbols(document);
    if (symbols.length === 0) return;

    const varRe = /var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = varRe.exec(text)) !== null) {
      const varName = m[1];
      // 上下文感知：按 var() 所在的选择器作用域选择生效的纯色定义，
      // 使 .dark 内引用 --brand 时显示 .dark 的定义，而非永远取第一个。
      const scope = scopeAtOffset(text, m.index);
      const match = findBestVarMatch(symbols, varName, scope);
      if (!match) continue;
      const color = parseAnyColor(match.value);
      if (!color) continue;
      // 色块只覆盖变量名 `--x`（显示在 var( 之后），写回时由 provideColorPresentations 用 textEdit 替换整个 var()
      const varOffset = m[0].indexOf(m[1]); // 变量名在匹配串内的偏移
      const start = m.index + varOffset;
      const end = start + m[1].length;
      const key = `v-${start}-${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      colors.push(
        new vscode.ColorInformation(
          new vscode.Range(document.positionAt(start), document.positionAt(end)),
          new vscode.Color(color.r, color.g, color.b, color.a)
        )
      );
    }
  }

  /** 在一段纯文本里依次扫 hex / rgb / hsl 及 CSS Color 4，按绝对偏移记录 ColorInformation（同区间去重） */
  private scanPlainText(
    text: string,
    baseOffset: number,
    document: vscode.TextDocument,
    colors: vscode.ColorInformation[],
    seen: Set<string>
  ): void {
    // 各类格式共用同一扫描循环，仅模式与「捕获组 → 颜色」的解析不同
    this.scanPattern(HEX_PATTERN, m => parseHexColor(m[1]), text, baseOffset, document, colors, seen);
    this.scanPattern(RGB_PATTERN, m => parseRgbColor(m[1], m[2], m[3], m[4]), text, baseOffset, document, colors, seen);
    this.scanPattern(HSL_PATTERN, m => parseHslColor(m[1], m[2], m[3], m[4]), text, baseOffset, document, colors, seen);
    // CSS Color 4：hwb / lab / lch / oklab / oklch（空格分隔，可选 / alpha）
    this.scanPattern(HWB_PATTERN, m => parseHwbColor(m[1], m[2], m[3], m[4]), text, baseOffset, document, colors, seen);
    this.scanPattern(LAB_PATTERN, m => parseLabColor(m[1], m[2], m[3], m[4]), text, baseOffset, document, colors, seen);
    this.scanPattern(LCH_PATTERN, m => parseLchColor(m[1], m[2], m[3], m[4]), text, baseOffset, document, colors, seen);
    this.scanPattern(
      OKLAB_PATTERN,
      m => parseOklabColor(m[1], m[2], m[3], m[4]),
      text,
      baseOffset,
      document,
      colors,
      seen
    );
    this.scanPattern(
      OKLCH_PATTERN,
      m => parseOklchColor(m[1], m[2], m[3], m[4]),
      text,
      baseOffset,
      document,
      colors,
      seen
    );
  }

  /** 用一个模式扫描文本，把匹配捕获组解析成颜色并记录 ColorInformation（同区间去重） */
  private scanPattern(
    pattern: RegExp,
    parse: (m: RegExpMatchArray) => { r: number; g: number; b: number; a: number } | null,
    text: string,
    baseOffset: number,
    document: vscode.TextDocument,
    colors: vscode.ColorInformation[],
    seen: Set<string>
  ): void {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const c = parse(match);
      if (!c) continue;
      const start = baseOffset + match.index;
      const end = start + match[0].length;
      const key = `${start}-${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      colors.push(
        new vscode.ColorInformation(
          new vscode.Range(document.positionAt(start), document.positionAt(end)),
          new vscode.Color(c.r, c.g, c.b, c.a)
        )
      );
    }
  }

  /**
   * 拾色器确认时提供多种写回格式：hex / rgb(a) / hsl(a) / hwb / lab / lch / oklab / oklch
   * （alpha<1 时 hex 带透明度、其余带 ` / a`）。
   */
  public provideColorPresentations(
    color: vscode.Color,
    context: { document: vscode.TextDocument; range: vscode.Range }
  ): vscode.ColorPresentation[] {
    const r = Math.round(clampChannel(color.red * 255));
    const g = Math.round(clampChannel(color.green * 255));
    const b = Math.round(clampChannel(color.blue * 255));
    const a = color.alpha;

    const hexStr = rgbToHex(color.red, color.green, color.blue, color.alpha);
    const rgbStr = a < 1 ? `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(2))})` : `rgb(${r}, ${g}, ${b})`;

    const [h, s, l] = rgbToHsl(color.red, color.green, color.blue);
    const hslStr = a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${Number(a.toFixed(2))})` : `hsl(${h}, ${s}%, ${l}%)`;

    const { red, green, blue } = color;
    const presentations = [
      new vscode.ColorPresentation(hexStr),
      new vscode.ColorPresentation(rgbStr),
      new vscode.ColorPresentation(hslStr),
      new vscode.ColorPresentation(rgbToHwb(red, green, blue, a)),
      new vscode.ColorPresentation(rgbToLab(red, green, blue, a)),
      new vscode.ColorPresentation(rgbToLch(red, green, blue, a)),
      new vscode.ColorPresentation(rgbToOklab(red, green, blue, a)),
      new vscode.ColorPresentation(rgbToOklch(red, green, blue, a)),
    ];

    // 固定顺序返回全部格式，不做任何基于原文的重排：
    // VS Code 里用户在下拉中手动选择确认的格式，选什么写回什么。
    // 刻意不做「匹配原文排第一」——那样原文是 oklch 时 oklch 永远默认；
    // 也不做「确认后自动前进」——那会与 VS Code 确认机制冲突，导致每次确认格式循环变化、颜色不变（闪烁）。

    // 当 range 是 var(--x) 内的变量名时，色块显示在变量名上（var( 之后），
    // 但写回必须替换整个 var() 为真实色值（否则会留下 var(#ff9500) 非法 CSS）。
    // 用 ColorPresentation.textEdit 指定完整替换范围。
    const originalText =
      context && context.document && context.range ? context.document.getText(context.range).trim() : '';
    if (/^--[a-zA-Z0-9_-]+$/.test(originalText)) {
      const fullRange = findVarCallRange(context.document, context.range);
      if (fullRange) {
        for (const p of presentations) {
          p.textEdit = vscode.TextEdit.replace(fullRange, p.label);
        }
      }
    }
    return presentations;
  }
}

export function registerStyleColor(): vscode.Disposable {
  const provider = new StyleColorProvider();
  const selectors = COLOR_LANGUAGES.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerColorProvider(selectors, provider);
}

/** 文档关闭时清掉该文档的色值缓存 */
export function clearColorCache(uri: vscode.Uri): void {
  colorResultCache.delete(uri.toString());
}

/**
 * 计算文本中 offset 处所在的 CSS 选择器作用域。
 * 规则：从 offset 向前找最近的一个 `{`，其前的文本（去空白）即为当前规则的选择器。
 * 例：`.dark { color: var(--x); }` 中 offset 指向 var() → 返回 `.dark`。
 * 顶层（`:root` 或文档开头，无 `{`）→ 返回空字符串（全局）。
 * 注意按「当前文件文本」计算即可（import 文件的作用域由符号的 scope 携带，不在此推导）。
 */
export function scopeAtOffset(text: string, offset: number): string {
  // 向前找最近的未闭合 `{`；忽略字符串/注释内的大括号（CSS 变量定义与 var() 引用
  // 都在规则体内，字符串/注释里的大括号不构成作用域——用简单向后扫描即可满足常见场景）
  let braceIdx = -1;
  for (let i = offset - 1; i >= 0; i--) {
    if (text[i] === '{') {
      braceIdx = i;
      break;
    }
    if (text[i] === '}') break; // 最近的闭合块之前若先遇到 }，说明 offset 在块外，无作用域
  }
  if (braceIdx === -1) return '';
  // 从 braceIdx 向前回溯到上一条语句的结束（; / } / 文本起点），取选择器文本
  let selStart = braceIdx;
  while (selStart > 0 && !/[;{}]/.test(text[selStart - 1])) selStart--;
  return text.slice(selStart, braceIdx).trim();
}

/**
 * 按作用域选择 var(--x) 生效的纯色定义（上下文感知）。
 * CSS 变量级联：作用域越具体、越贴近引用处的定义优先。
 * 匹配优先级：
 * 1. scope 与引用作用域「完全一致」的定义（.dark → .dark）
 * 2. scope 是引用作用域的后缀/祖先（引用 .dark .a 时，.dark 的定义）
 * 3. scope 为全局（:root / 空）的默认定义
 * 4. 以上都没有 → 第一个同名纯色定义（兜底，兼容无 scope 记录的旧数据）
 */
function findBestVarMatch(
  symbols: { name: string; value: string; scope?: string }[],
  varName: string,
  refScope: string
): { name: string; value: string; scope?: string } | undefined {
  const pure = symbols.filter(s => s.name === varName && isPureColor(s.value));
  if (pure.length === 0) return undefined;
  if (pure.length === 1) return pure[0];

  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

  // 1) 完全一致
  const exact = pure.find(s => norm(s.scope ?? '') === norm(refScope));
  if (exact) return exact;

  // 2) 定义作用域是引用作用域的前缀（引用 .dark .a，定义 .dark）
  const refNorm = norm(refScope);
  const prefixMatch = pure.find(s => {
    const defScope = norm(s.scope ?? '');
    if (!defScope || !refNorm) return false;
    return refNorm === defScope || refNorm.startsWith(defScope + ' ') || refNorm.startsWith(defScope + '>');
  });
  if (prefixMatch) return prefixMatch;

  // 3) 全局默认（:root 或空 scope）
  const globalDef = pure.find(s => {
    const defScope = norm(s.scope ?? '');
    return defScope === ':root' || defScope === '';
  });
  if (globalDef) return globalDef;

  // 4) 兜底：第一个
  return pure[0];
}
