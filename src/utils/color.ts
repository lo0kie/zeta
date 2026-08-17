export interface ColorRgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, value));
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;

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

function parseChannelValue(val: string): number {
  if (val.endsWith('%')) {
    return (Number(val.slice(0, -1)) / 100) * 255;
  }
  return Number(val);
}

function parseAlphaValue(alpha?: string): number {
  if (alpha === undefined) return 1;
  if (alpha.endsWith('%')) {
    return Number(alpha.slice(0, -1)) / 100;
  }
  return Number(alpha);
}

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

function parseHueValue(hStr: string): number {
  if (hStr.endsWith('deg')) return Number(hStr.slice(0, -3));
  if (hStr.endsWith('grad')) return Number(hStr.slice(0, -4)) * 0.9;
  if (hStr.endsWith('rad')) return Number(hStr.slice(0, -3)) * (180 / Math.PI);
  if (hStr.endsWith('turn')) return Number(hStr.slice(0, -4)) * 360;
  return Number(hStr);
}

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
