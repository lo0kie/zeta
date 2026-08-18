import { TtlCache } from '@/core/ttl-cache';
import { clampChannel, parseHexColor, parseHslColor, parseRgbColor, rgbToHsl } from '@/utils/color';
import { scanStringTokens } from '@/utils/quote';
import * as vscode from 'vscode';

// 只在 JS/TS/JSX/TSX 与 vue 的字符串字面量里找色值（样式文件由 CSS 语言服务处理）
const COLOR_LANGUAGES = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'vue'];

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

/** 为 JS/TS/vue 字符串字面量中的 hex / rgb / hsl 色值提供色块与拾色器 */
export class StyleColorProvider implements vscode.DocumentColorProvider {
  public provideDocumentColors(document: vscode.TextDocument): vscode.ColorInformation[] {
    const cacheKey = document.uri.toString();
    const cached = colorResultCache.get(cacheKey);
    if (cached && cached.version === document.version) return cached.colors;

    const text = document.getText();

    // 快速路径：全文无任何色值标记直接返回空
    if (!/[#]|rgb|hsl/i.test(text)) {
      colorResultCache.set(cacheKey, { version: document.version, colors: [] });
      return [];
    }

    const colors: vscode.ColorInformation[] = [];
    const seen = new Set<string>();

    // 逐个字符串字面量扫描（注释/正则中的假色值天然被排除）
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

    colorResultCache.set(cacheKey, { version: document.version, colors });
    return colors;
  }

  /** 在一段纯文本里依次扫 hex / rgb / hsl，按绝对偏移记录 ColorInformation（同区间去重） */
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
      const c = parseHexColor(match[1]);
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

    RGB_PATTERN.lastIndex = 0;
    while ((match = RGB_PATTERN.exec(text)) !== null) {
      const c = parseRgbColor(match[1], match[2], match[3], match[4]);
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

    HSL_PATTERN.lastIndex = 0;
    while ((match = HSL_PATTERN.exec(text)) !== null) {
      const c = parseHslColor(match[1], match[2], match[3], match[4]);
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

  /** 拾色器确认时提供三种写回格式：hex / rgb(a) / hsl(a)（alpha<1 时带透明度） */
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

    const [h, s, l] = rgbToHsl(color.red, color.green, color.blue);
    const hslStr = a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${Number(a.toFixed(2))})` : `hsl(${h}, ${s}%, ${l}%)`;

    return [
      new vscode.ColorPresentation(hexStr),
      new vscode.ColorPresentation(rgbStr),
      new vscode.ColorPresentation(hslStr),
    ];
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
