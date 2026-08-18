// RGB 颜色值，r/g/b/a 均为归一化 0~1（与 vscode.Color 一致，方便直接用于色块装饰）
export interface ColorRgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 识别色值的正则：hex / rgb() / hsl()（补全与悬浮里用于判断是否展示色块） */
export const COLOR_VALUE_PATTERN = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/i;

/** 把色值渲染成 12×12 的内联 SVG 色块（data URI），悬浮/补全文档里直接展示颜色 */
export function createColorSwatchUri(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="11" height="11"><rect width="12" height="12" rx="2" fill="${color}" stroke="#88888880" stroke-width="1.5"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** 把 0~255 之外的通道值钳制到合法区间 */
export function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, value));
}

/**
 * HSL → RGB。s/l 取 0~1，h 任意角度（负值/超界自动回绕到 0~360）。
 * 返回 r/g/b 为 0~1 的归一化值。
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;

  // 按色相区间取主色/副色
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return [r + m, g + m, b + m];
}

/**
 * RGB → HSL。输入 r/g/b 为归一化 0~1。
 * 返回 [h, s, l]：h 为 0~360 整数，s/l 为 0~100 整数（百分比）。
 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) {
      h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
    } else if (max === g) {
      h = ((b - r) / delta + 2) * 60;
    } else {
      h = ((r - g) / delta + 4) * 60;
    }
  }

  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/** 解析 hex 色值（3/4/6/8 位，不含 # 前缀），非法长度返回 null；通道归一化为 0~1 */
export function parseHexColor(hex: string): ColorRgb | null {
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

  return { r, g, b, a };
}

/** 解析 rgb 单个通道：支持整数或百分比（% 按 255 换算），非法返回 NaN 由调用方判空 */
function parseChannelValue(val: string): number {
  if (val.endsWith('%')) {
    return (Number(val.slice(0, -1)) / 100) * 255;
  }
  return Number(val);
}

/** 解析透明度：缺省为 1，支持百分比 */
function parseAlphaValue(alpha?: string): number {
  if (alpha === undefined) return 1;
  if (alpha.endsWith('%')) {
    return Number(alpha.slice(0, -1)) / 100;
  }
  return Number(alpha);
}

/** 解析 rgb()/rgba() 的三个通道与可选透明度；越界或非法返回 null */
export function parseRgbColor(r: string, g: string, b: string, alpha?: string): ColorRgb | null {
  const red = parseChannelValue(r);
  const green = parseChannelValue(g);
  const blue = parseChannelValue(b);
  if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) return null;
  if (red < 0 || red > 255 || green < 0 || green > 255 || blue < 0 || blue > 255) return null;

  const a = parseAlphaValue(alpha);
  if (Number.isNaN(a)) return null;

  return { r: red / 255, g: green / 255, b: blue / 255, a: Math.min(1, Math.max(0, a)) };
}

/** 解析色相值：支持 deg / grad / rad / turn 单位，无单位按度 */
function parseHueValue(hStr: string): number {
  if (hStr.endsWith('deg')) return Number(hStr.slice(0, -3));
  if (hStr.endsWith('grad')) return Number(hStr.slice(0, -4)) * 0.9;
  if (hStr.endsWith('rad')) return Number(hStr.slice(0, -3)) * (180 / Math.PI);
  if (hStr.endsWith('turn')) return Number(hStr.slice(0, -4)) * 360;
  return Number(hStr);
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
