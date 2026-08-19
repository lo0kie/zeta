import { converter, parse } from 'culori';

/**
 * 颜色工具。hex/rgb/hsl 解析与 hsl 互转为本项目实现（无依赖）；
 * hwb/lab/lch/oklab/oklch 等 CSS Color 4 的色彩空间转换委托给 culori
 * （这些转换涉及 D50/D65 白点与 LMS 矩阵，手写易出错且难验证）。
 */

export interface ColorRgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 识别色值的正则：hex / rgb / hsl / hwb / lab / lch / oklab / oklch（补全里用于判断是否展示色块） */
export const COLOR_VALUE_PATTERN =
  /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|hwb\([^)]+\)|lab\([^)]+\)|lch\([^)]+\)|oklab\([^)]+\)|oklch\([^)]+\))/i;

/**
 * 把颜色绘制成 12×12 的内联 SVG 色块 data URI（悬浮/补全文档里直接展示颜色）。
 * 用 base64 编码（VS Code Markdown 对 utf8+encodeURIComponent 的 data URI 渲染不可靠，
 * 会显示破图；base64 纯字母数字最稳）。SVG fill 只识别 CSS Color 3 与命名色，
 * hwb/lab/lch/oklab/oklch 等 CSS Color 4 会被 Chromium 渲染成黑色，因此统一转成 #rrggbb。
 */
export function createColorSwatchUri(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="11" height="11"><rect width="12" height="12" rx="2" fill="${toSvgColor(color)}" stroke="#88888880" stroke-width="1.5"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** 任意 CSS 色值 → SVG 可识别的 #rrggbb；解析失败（非色值）时回退原字符串 */
function toSvgColor(color: string): string {
  const parsed = parse(color);
  if (!parsed) return color;
  const c = converter('rgb')(parsed);
  const hex = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

/**
 * 判断字符串整体是否为纯色值（hex/rgb/hsl/hwb/lab/lch/oklab/oklch 等）。
 * 用「整体锚定」正则而非「值里是否含色值子串」：阴影/渐变/多值等含 rgba 片段的
 * 复杂值整体不匹配，避免把 `--shadow: 0 1px 3px rgba(...)` 这类变量误判为颜色。
 */
const PURE_COLOR_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|hwb\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\))$/i;

export function isPureColor(value: string): boolean {
  const cleaned = value
    .trim()
    .replace(/;?\s*!important\s*$/i, '')
    .replace(/;$/, '')
    .trim();
  return PURE_COLOR_PATTERN.test(cleaned);
}

/** 把颜色通道值钳制到 0~255 整数 */
export function clampChannel(v: number): number {
  return Math.min(255, Math.max(0, v));
}

/** hsl → rgb：h 为度数（0~360），s/l 为 0~1；返回归一化 0~1 的 [r, g, b] */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((hp / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 60) {
    [r, g, b] = [c, x, 0];
  } else if (hp < 120) {
    [r, g, b] = [x, c, 0];
  } else if (hp < 180) {
    [r, g, b] = [0, c, x];
  } else if (hp < 240) {
    [r, g, b] = [0, x, c];
  } else if (hp < 300) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }
  return [r + m, g + m, b + m];
}

/** rgb（归一化 0~1）→ [h(0~360), s%, l%] */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, Math.round(l * 100)];

  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;

  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/** 解析单个通道值：支持整数 / 小数 / 百分比（百分比按 0~100 → 0~255） */
function parseChannelValue(v: string): number {
  if (v.endsWith('%')) return (Number(v.slice(0, -1)) / 100) * 255;
  return Number(v);
}

/** 解析 alpha：百分比(0~100→0~1) 或数值(0~1)；非法返回 NaN */
function parseAlphaValue(v: string | undefined): number {
  if (v === undefined) return 1;
  if (v.endsWith('%')) return Number(v.slice(0, -1)) / 100;
  return Number(v);
}

/** 解析 hex：#rgb / #rgba / #rrggbb / #rrggbbaa（# 可选，provider 传入的是不带 # 的捕获组） */
export function parseHexColor(hex: string): ColorRgb | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(hex);
  if (!m) return null;
  // 3/4 位先按位双写展开成 6/8 位（#f00 → #ff0000）
  const raw = m[1].length <= 4 ? m[1].replace(/./g, c => c + c) : m[1];
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const a = raw.length > 6 ? parseInt(raw.slice(6, 8), 16) : 255;
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

/** 解析 rgb()/rgba()：逗号或空格分隔，通道支持百分比 */
export function parseRgbColor(rStr: string, gStr: string, bStr: string, alpha?: string): ColorRgb | null {
  const r = parseChannelValue(rStr);
  const g = parseChannelValue(gStr);
  const b = parseChannelValue(bStr);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) return null;

  const a = parseAlphaValue(alpha);
  if (Number.isNaN(a)) return null;

  return { r: r / 255, g: g / 255, b: b / 255, a: Math.min(1, Math.max(0, a)) };
}

/** 解析色相值：支持 deg / grad / rad / turn（默认 deg），返回度数 */
function parseHueValue(v: string): number {
  const num = Number(v.replace(/(turn|grad|rad|deg)$/i, ''));
  if (Number.isNaN(num)) return Number.NaN;
  if (/turn$/i.test(v)) return num * 360;
  if (/grad$/i.test(v)) return num * 0.9;
  if (/rad$/i.test(v)) return (num * 180) / Math.PI;
  return num;
}

/** 解析 hsl()/hsla()：s/l 为百分比（无 % 按 0~1 原始值），h 支持多种单位；越界或非法返回 null */
export function parseHslColor(hStr: string, sStr: string, lStr: string, alpha?: string): ColorRgb | null {
  const h = parseHueValue(hStr);
  const s = sStr.endsWith('%') ? Number(sStr.slice(0, -1)) / 100 : Number(sStr);
  const l = lStr.endsWith('%') ? Number(lStr.slice(0, -1)) / 100 : Number(lStr);

  if (Number.isNaN(h) || Number.isNaN(s) || Number.isNaN(l)) return null;
  if (s < 0 || s > 1 || l < 0 || l > 1) return null;

  const a = parseAlphaValue(alpha);
  if (Number.isNaN(a)) return null;

  const [r, g, b] = hslToRgb(h, s, l);
  return { r, g, b, a: Math.min(1, Math.max(0, a)) };
}

// ── CSS Color 4（hwb / lab / lch / oklab / oklch）：委托 culori ─────────────
// 只做参数解析与范围校验，色彩空间转换（含 D50/D65 白点、LMS 矩阵）交给 culori，
// 避免手写偏差（如 oklab 红色 g/b 分量不归零）。

/** culori 各目标色彩空间的转换器（模块级复用） */
const toRgb = converter('rgb');

/** 把 culori 转换结果钳制到 0~1（lab/oklab 可能超出 sRGB 色域，超出取最近色） */
function fromCulori(c: { r: number; g: number; b: number; alpha?: number }): ColorRgb {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  return { r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b), a: clamp01(c.alpha ?? 1) };
}

/** 解析 CSS Color 4 分量：可带符号、可百分比（返回去掉 % 的数值） */
function parseColor4Component(val: string): number {
  return Number(val.endsWith('%') ? val.slice(0, -1) : val);
}

/**
 * 解析 lab()/oklab() 的亮度 L：
 * - lab（scale=false）：百分比 0~100 直接作 L，数值 0~1 换算成 0~100
 * - oklab（scale=true）：百分比 0~100 → 0~1，数值 0~1 直接作 L
 */
function parseLabLightness(LStr: string, scale: boolean): number {
  const v = Number(LStr.endsWith('%') ? LStr.slice(0, -1) : LStr);
  if (LStr.endsWith('%')) return scale ? v / 100 : v;
  return scale ? v : v * 100;
}

/** 解析 hwb()：h 度数，w/b 百分比或 0~1；越界或非法返回 null */
export function parseHwbColor(hStr: string, wStr: string, bStr: string, alpha?: string): ColorRgb | null {
  const h = parseHueValue(hStr);
  const w = wStr.endsWith('%') ? Number(wStr.slice(0, -1)) / 100 : Number(wStr);
  const b = bStr.endsWith('%') ? Number(bStr.slice(0, -1)) / 100 : Number(bStr);
  if (Number.isNaN(h) || Number.isNaN(w) || Number.isNaN(b)) return null;
  if (w < 0 || w > 1 || b < 0 || b > 1) return null;

  const a = parseAlphaValue(alpha);
  if (Number.isNaN(a)) return null;

  const c = toRgb({ mode: 'hwb', h, w, b });
  return { ...fromCulori(c), a: Math.min(1, Math.max(0, a)) };
}

/** 解析 lab()：L 百分比(0~100)/数值(0~1)，a/b 为有符号分量 */
export function parseLabColor(LStr: string, aStr: string, bStr: string, alpha?: string): ColorRgb | null {
  const L = parseLabLightness(LStr, false);
  const a = parseColor4Component(aStr);
  const b = parseColor4Component(bStr);
  if (Number.isNaN(L) || Number.isNaN(a) || Number.isNaN(b)) return null;

  const alphaV = parseAlphaValue(alpha);
  if (Number.isNaN(alphaV)) return null;

  const c = toRgb({ mode: 'lab', l: L, a, b });
  return { ...fromCulori(c), a: Math.min(1, Math.max(0, alphaV)) };
}

/** 解析 lch()：L 百分比(0~100)/数值(0~1)，C 分量，h 色相（支持多种单位） */
export function parseLchColor(LStr: string, cStr: string, hStr: string, alpha?: string): ColorRgb | null {
  const L = parseLabLightness(LStr, false);
  const C = parseColor4Component(cStr);
  const h = parseHueValue(hStr);
  if (Number.isNaN(L) || Number.isNaN(C) || Number.isNaN(h)) return null;

  const alphaV = parseAlphaValue(alpha);
  if (Number.isNaN(alphaV)) return null;

  const c = toRgb({ mode: 'lch', l: L, c: C, h });
  return { ...fromCulori(c), a: Math.min(1, Math.max(0, alphaV)) };
}

/** 解析 oklab()：L 百分比(0~100)/数值(0~1)，a/b 为有符号分量 */
export function parseOklabColor(LStr: string, aStr: string, bStr: string, alpha?: string): ColorRgb | null {
  const L = parseLabLightness(LStr, true);
  const a = parseColor4Component(aStr);
  const b = parseColor4Component(bStr);
  if (Number.isNaN(L) || Number.isNaN(a) || Number.isNaN(b)) return null;

  const alphaV = parseAlphaValue(alpha);
  if (Number.isNaN(alphaV)) return null;

  const c = toRgb({ mode: 'oklab', l: L, a, b });
  return { ...fromCulori(c), a: Math.min(1, Math.max(0, alphaV)) };
}

/** 解析 oklch()：L 百分比(0~100)/数值(0~1)，C 分量，h 色相（支持多种单位） */
export function parseOklchColor(LStr: string, cStr: string, hStr: string, alpha?: string): ColorRgb | null {
  const L = parseLabLightness(LStr, true);
  const C = parseColor4Component(cStr);
  const h = parseHueValue(hStr);
  if (Number.isNaN(L) || Number.isNaN(C) || Number.isNaN(h)) return null;

  const alphaV = parseAlphaValue(alpha);
  if (Number.isNaN(alphaV)) return null;

  const c = toRgb({ mode: 'oklch', l: L, c: C, h });
  return { ...fromCulori(c), a: Math.min(1, Math.max(0, alphaV)) };
}

// ── 写回（sRGB → 各 CSS Color 4 格式，供拾色器选择写入）────────────────────────

/** 保留 2 位小数、去尾零的格式化（颜色分量展示） */
function fmt2(v: number): string {
  return Number(v.toFixed(2)).toString();
}

/** 色相转 0~360 取整（用于 hwb / lch / oklch 写回） */
function hueToDeg(h: number): number {
  return Math.round(((h % 360) + 360) % 360);
}

/** 追加 alpha 段：alpha < 1 时附 ` / a`，否则空串 */
function alphaPart(a: number): string {
  return a < 1 ? ` / ${Number(a.toFixed(2))}` : '';
}

/** rgb(归一化 0~1) → hwb(h w% b%[ / a]) */
export function rgbToHwb(r: number, g: number, b: number, a = 1): string {
  const c = converter('hwb')({ mode: 'rgb', r, g, b, alpha: a });
  return `hwb(${hueToDeg(c.h!)} ${fmt2(c.w * 100)}% ${fmt2(c.b * 100)}%${alphaPart(a)})`;
}

/** rgb(归一化 0~1) → lab(L% a b[ / a]) */
export function rgbToLab(r: number, g: number, b: number, a = 1): string {
  const c = converter('lab')({ mode: 'rgb', r, g, b, alpha: a });
  return `lab(${fmt2(c.l)}% ${fmt2(c.a)} ${fmt2(c.b)}${alphaPart(a)})`;
}

/** rgb(归一化 0~1) → lch(L% C h[ / a]) */
export function rgbToLch(r: number, g: number, b: number, a = 1): string {
  const c = converter('lch')({ mode: 'rgb', r, g, b, alpha: a });
  return `lch(${fmt2(c.l)}% ${fmt2(c.c)} ${hueToDeg(c.h!)}${alphaPart(a)})`;
}

/** rgb(归一化 0~1) → oklab(L% a b[ / a]) */
export function rgbToOklab(r: number, g: number, b: number, a = 1): string {
  const c = converter('oklab')({ mode: 'rgb', r, g, b, alpha: a });
  return `oklab(${fmt2(c.l * 100)}% ${fmt2(c.a)} ${fmt2(c.b)}${alphaPart(a)})`;
}

/** rgb(归一化 0~1) → oklch(L% C h[ / a]) */
export function rgbToOklch(r: number, g: number, b: number, a = 1): string {
  const c = converter('oklch')({ mode: 'rgb', r, g, b, alpha: a });
  return `oklch(${fmt2(c.l * 100)}% ${fmt2(c.c)} ${hueToDeg(c.h!)}${alphaPart(a)})`;
}
