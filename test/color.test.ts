import { StyleColorProvider } from '@/providers/style-color';
import {
  clampChannel,
  createColorSwatchUri,
  hslToRgb,
  isPureColor,
  parseHexColor,
  parseHslColor,
  parseHwbColor,
  parseLabColor,
  parseLchColor,
  parseOklabColor,
  parseOklchColor,
  parseRgbColor,
  rgbToHsl,
  rgbToHwb,
  rgbToLab,
  rgbToLch,
  rgbToOklab,
  rgbToOklch,
} from '@/utils/color';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'vitest';
import type { Range, TextDocument } from 'vscode';
import { Color } from 'vscode';
import { cleanup, makeDocument, makeWorkspace, setConfig } from './helpers';

const colorTuple = (c: Color): number[] => [c.red, c.green, c.blue, c.alpha].map(v => Number(v.toFixed(3)));

test('JS 字符串基础色值探测（hex / rgb / hsl / hsla）', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text =
      `const a = '#ff0000';\nconst b = "rgb(0, 255, 0)";\n` +
      `const c = 'hsl(120, 100%, 50%)';\nconst d = "hsla(240, 100%, 50%, 0.5)";\n`;
    const doc = makeDocument(text, join(ws, 'a.js'), 'javascript');
    const colors = new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 4);
    // 扫描顺序按类别（hex → rgb → hsl），与文本顺序一致（每类各一个）
    assert.deepEqual(colorTuple(colors[0].color), [1, 0, 0, 1]); // hex
    assert.deepEqual(colorTuple(colors[1].color), [0, 1, 0, 1]); // rgb
    assert.deepEqual(colorTuple(colors[2].color), [0, 1, 0, 1]); // hsl
    assert.deepEqual(colorTuple(colors[3].color), [0, 0, 1, 0.5]); // hsla
    const start = text.indexOf("'#ff0000'");
    assert.deepEqual([colors[0].range.start.character, colors[0].range.end.character], [start + 1, start + 8]);
  } finally {
    cleanup(ws);
  }
});

test('CSS Color 4: 支持空格分隔与 / alpha 语法 (rgb 与 hsl)', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `
      const c1 = "rgb(255 0 0 / 50%)";
      const c2 = 'hsl(120deg 100% 50% / 0.5)';
      const c3 = "rgb(100% 0% 0%)";
      const c4 = 'hsl(0.5turn 100% 50%)';
    `;
    const doc = makeDocument(text, join(ws, 'c4.js'), 'javascript');
    const colors = new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 4);

    assert.deepEqual(colorTuple(colors[0].color), [1, 0, 0, 0.5]);
    assert.deepEqual(colorTuple(colors[1].color), [0, 1, 0, 0.5]);
    assert.deepEqual(colorTuple(colors[2].color), [1, 0, 0, 1]);
    assert.deepEqual(colorTuple(colors[3].color), [0, 1, 1, 1]);
  } finally {
    cleanup(ws);
  }
});

test('模板字符串：${} 屏蔽但静态色值保留', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'const s = `color: #ff0000; width: ${w}px;`;';
    const doc = makeDocument(text, join(ws, 't.js'), 'javascript');
    const colors = new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 1);
    assert.deepEqual(colorTuple(colors[0].color), [1, 0, 0, 1]);
    const at = text.indexOf('#ff0000');
    assert.deepEqual([colors[0].range.start.character, colors[0].range.end.character], [at, at + 7]);
  } finally {
    cleanup(ws);
  }
});

test('注释与正则字面量跳过、非 hex 词不误报', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `// #fff\n/* #000 */\nconst re = /^#abc$/;\nconst id = '#main';\nconst ok = '#abcdef';\n`;
    const doc = makeDocument(text, join(ws, 'c.js'), 'javascript');
    const colors = new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 1);
    assert.deepEqual(colorTuple(colors[0].color), [0.671, 0.804, 0.937, 1]);
  } finally {
    cleanup(ws);
  }
});

test('vue：仅提取 template/script/style 字符串字面量（裸 style 交由 Volar 处理）', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `<template><div :style="{ color: '#00ff00' }">x</div></template>\n<style>.a { color: #ff0000; content: "#00ff00"; }</style>\n`;
    const doc = makeDocument(text, join(ws, 'v.vue'), 'vue');
    const colors = new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 2);
  } finally {
    cleanup(ws);
  }
});

test('fast-path：无任何色值标记的文本直接返回空', () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    // 500 行无任何 #/rgb/hsl 标记即可命中 fast-path 正则分支（行数与触发条件无关）
    const text = Array.from({ length: 500 }, (_, i) => `const x${i} = ${i} * 2;`).join('\n');
    const doc = makeDocument(text, join(ws, 'big.js'), 'javascript');
    assert.equal(new StyleColorProvider().provideDocumentColors(doc).length, 0);
  } finally {
    cleanup(ws);
  }
});

test('写回格式：支持 hex + rgb + hsl + hwb + lab + lch + oklab + oklch 八种', () => {
  const provider = new StyleColorProvider();
  assert.deepEqual(
    provider
      .provideColorPresentations(new Color(1, 0, 0, 1), {} as unknown as { document: TextDocument; range: Range })
      .map(p => p.label),
    [
      '#ff0000',
      'rgb(255, 0, 0)',
      'hsl(0, 100%, 50%)',
      'hwb(0 0% 0%)',
      'lab(54.29% 80.8 69.89)',
      'lch(54.29% 106.84 41)',
      'oklab(62.8% 0.22 0.13)',
      'oklch(62.8% 0.26 29)',
    ]
  );
  assert.deepEqual(
    provider
      .provideColorPresentations(new Color(1, 0, 0, 0.5), {} as unknown as { document: TextDocument; range: Range })
      .map(p => p.label),
    [
      '#ff000080',
      'rgba(255, 0, 0, 0.5)',
      'hsla(0, 100%, 50%, 0.5)',
      'hwb(0 0% 0% / 0.5)',
      'lab(54.29% 80.8 69.89 / 0.5)',
      'lch(54.29% 106.84 41 / 0.5)',
      'oklab(62.8% 0.22 0.13 / 0.5)',
      'oklch(62.8% 0.26 29 / 0.5)',
    ]
  );
});

// 通过 esbuild 加载纯函数模块（不依赖 vscode 运行时）

// 浮点比较（hslToRgb/parseHslColor 返回分量含舍入误差）
interface RgbaChannel {
  r: number;
  g: number;
  b: number;
  a: number;
}
const close = (actual: RgbaChannel | null, expected: RgbaChannel | null) => {
  if (!actual || !expected) throw new Error('解析结果不应为 null');
  for (const k of ['r', 'g', 'b', 'a'] as const) {
    assert.ok(Math.abs(actual[k] - expected[k]) < 1e-3, `${k}: ${actual[k]} vs ${expected[k]}`);
  }
};

// CSS Color 4 颜色比较：lab/oklab/oklch 输入为有限精度小数，反推 RGB 有 ~1% 量级偏差，
// 用更宽松容差（1%）。色块/拾色器展示场景下 1% 以内的色差可接受。
const closeColor = (actual: RgbaChannel | null, expected: RgbaChannel | null) => {
  if (!actual || !expected) throw new Error('解析结果不应为 null');
  for (const k of ['r', 'g', 'b', 'a'] as const) {
    assert.ok(Math.abs(actual[k] - expected[k]) < 1e-2, `${k}: ${actual[k]} vs ${expected[k]}`);
  }
};

test('clampChannel: 边界与越界钳制', () => {
  assert.equal(clampChannel(0), 0);
  assert.equal(clampChannel(128), 128);
  assert.equal(clampChannel(255), 255);
  assert.equal(clampChannel(300), 255); // 上溢
  assert.equal(clampChannel(-5), 0); // 下溢
  assert.equal(clampChannel(255.9), 255); // 小数上溢
  assert.equal(clampChannel(0.4), 0.4); // 小数保留
});

test('parseHexColor: 3/4/6/8 位与非法长度', () => {
  assert.deepEqual(parseHexColor('ff0000'), { r: 1, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseHexColor('f00'), { r: 1, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseHexColor('f00f'), { r: 1, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseHexColor('ff0000ff'), { r: 1, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseHexColor('FF0000'), { r: 1, g: 0, b: 0, a: 1 }); // 大写
  assert.deepEqual(parseHexColor('00ff0080'), { r: 0, g: 1, b: 0, a: 128 / 255 });
  assert.equal(parseHexColor(''), null); // 空
  assert.equal(parseHexColor('12'), null); // 2 位
  assert.equal(parseHexColor('12345'), null); // 5 位非法
  assert.equal(parseHexColor('1234567'), null); // 7 位非法
});

test('parseRgbColor: 整数/%/越界/NaN/alpha', () => {
  assert.deepEqual(parseRgbColor('255', '0', '0'), { r: 1, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseRgbColor('100%', '0%', '0%'), { r: 1, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseRgbColor('255', '255', '255', '50%'), { r: 1, g: 1, b: 1, a: 0.5 });
  assert.deepEqual(parseRgbColor('255', '0', '0', undefined), { r: 1, g: 0, b: 0, a: 1 });
  assert.equal(parseRgbColor('300', '0', '0'), null); // 越界
  assert.equal(parseRgbColor('abc', '0', '0'), null); // NaN
  assert.equal(parseRgbColor('255', '0', 'notnum'), null); // alpha NaN
  assert.equal(parseRgbColor('-1', '0', '0'), null); // 负值越界
});

test('parseHslColor: deg/grad/rad/turn、%/越界/alpha', () => {
  close(parseHslColor('120', '100%', '50%'), { r: 0, g: 1, b: 0, a: 1 });
  close(parseHslColor('120deg', '100%', '50%'), { r: 0, g: 1, b: 0, a: 1 });
  close(parseHslColor('0.5turn', '100%', '50%'), { r: 0, g: 1, b: 1, a: 1 });
  close(parseHslColor('3.14159rad', '100%', '50%'), { r: 0, g: 1, b: 1, a: 1 }); // π rad = 180° = 青色
  close(parseHslColor('133.333grad', '100%', '50%'), { r: 0, g: 1, b: 0, a: 1 }); // 120deg
  close(parseHslColor('120', '1', '0.5'), { r: 0, g: 1, b: 0, a: 1 }); // 非 % 小数 s/l
  close(parseHslColor('120', '100%', '50%', '0.5'), { r: 0, g: 1, b: 0, a: 0.5 });
  assert.equal(parseHslColor('120', '150%', '50%'), null); // s 越界
  assert.equal(parseHslColor('120', '100%', '150%'), null); // l 越界
  assert.equal(parseHslColor('abc', '100%', '50%'), null); // h NaN
});

test('hslToRgb: 主色相与灰阶、负/超界色相回绕', () => {
  assert.deepEqual(hslToRgb(0, 1, 0.5), [1, 0, 0]); // 红
  assert.deepEqual(hslToRgb(120, 1, 0.5), [0, 1, 0]); // 绿
  assert.deepEqual(hslToRgb(240, 1, 0.5), [0, 0, 1]); // 蓝
  assert.deepEqual(hslToRgb(0, 0, 0), [0, 0, 0]); // 黑
  assert.deepEqual(hslToRgb(0, 0, 1), [1, 1, 1]); // 白
  assert.deepEqual(hslToRgb(0, 0, 0.5), [0.5, 0.5, 0.5]); // 中灰
  const neg = hslToRgb(-120, 1, 0.5);
  assert.deepEqual(neg, [0, 0, 1]); // -120° 回绕到 240°
  const over = hslToRgb(400, 1, 0.5);
  assert.equal(over.length, 3); // 400° 回绕，返回合法三元组
  for (const v of over) assert.ok(v >= 0 && v <= 1);
});

test('rgbToHsl: 纯色与灰阶、舍入（输入为归一化 0~1）', () => {
  assert.deepEqual(rgbToHsl(1, 0, 0), [0, 100, 50]);
  assert.deepEqual(rgbToHsl(0, 1, 0), [120, 100, 50]);
  assert.deepEqual(rgbToHsl(0, 0, 1), [240, 100, 50]);
  assert.deepEqual(rgbToHsl(0.5, 0.5, 0.5), [0, 0, 50]); // 灰阶饱和度为 0
  assert.deepEqual(rgbToHsl(1, 1, 1), [0, 0, 100]); // 白
  assert.deepEqual(rgbToHsl(0, 0, 0), [0, 0, 0]); // 黑
});

// ── CSS Color 4：hwb / lab / lch / oklab / oklch ─────────────────────────────

// 各格式解析验证：用红色 #ff0000 的标准 CSS Color 4 参考值（D50 基底 lab/lch、D65 基底 oklab/oklch）
// 解析应还原为同一红色。参考值需保留足够小数位（2 位会引入 ~0.05 的 RGB 反推误差）。
test('CSS Color 4 解析：红色 #ff0000 各格式还原同一 RGB', () => {
  const red = { r: 1, g: 0, b: 0, a: 1 };
  closeColor(parseHwbColor('0', '0%', '0%'), red);
  closeColor(parseLabColor('54.2917%', '80.8125', '69.885'), red);
  closeColor(parseLchColor('54.2917%', '106.84', '40.858'), red);
  closeColor(parseOklabColor('62.796%', '0.22486', '0.12585'), red);
  closeColor(parseOklchColor('62.796%', '0.25768', '29.234'), red);
});

test('CSS Color 4 解析：alpha 与空格分隔语法', () => {
  const red = { r: 1, g: 0, b: 0, a: 0.5 };
  closeColor(parseHwbColor('0', '0%', '0%', '50%'), red);
  closeColor(parseLabColor('54.2917%', '80.8125', '69.885', '0.5'), red);
  closeColor(parseLchColor('54.2917%', '106.84', '40.858', '50%'), red);
  closeColor(parseOklabColor('62.796%', '0.22486', '0.12585', '0.5'), red);
  closeColor(parseOklchColor('62.796%', '0.25768', '29.234', '50%'), red);
});

test('CSS Color 4 往返自洽：#ff9500 各格式写回再解析还原同一 RGB', () => {
  // target 用 hwb 解析的理论值（g=0.5833，对应整数 149 取整前的精确值），避免取整偏差
  const target = parseHwbColor('35', '0%', '0%');
  assert.ok(target, 'hwb 解析不应为 null');
  // 提取写回字符串的三个分量原样传回解析（保留 %），验证转换自洽（不依赖外部参考值）
  const fromStr = (s: string): [string, string, string] => {
    const m = s.match(/\(([^()]*)\)/);
    const parts = m![1].split(' ');
    return [parts[0], parts[1], parts[2]];
  };
  closeColor(parseHwbColor(...fromStr(rgbToHwb(target.r, target.g, target.b))), target);
  closeColor(parseLabColor(...fromStr(rgbToLab(target.r, target.g, target.b))), target);
  closeColor(parseLchColor(...fromStr(rgbToLch(target.r, target.g, target.b))), target);
  closeColor(parseOklabColor(...fromStr(rgbToOklab(target.r, target.g, target.b))), target);
  closeColor(parseOklchColor(...fromStr(rgbToOklch(target.r, target.g, target.b))), target);
});

test('CSS Color 4 解析：L 数值/百分比两种写法', () => {
  // lab 的 L：71.39% = 71.39，数值 0.7139 = 71.39
  close(parseLabColor('71.39%', '32.23', '76.68'), parseLabColor('0.7139', '32.23', '76.68'));
  // oklab 的 L：76.523% = 0.76523，数值 0.76523 直接作 L
  close(parseOklabColor('76.523%', '0.0807', '0.15546'), parseOklabColor('0.76523', '0.0807', '0.15546'));
});

test('CSS Color 4 解析：越界/非法输入返回 null', () => {
  assert.equal(parseHwbColor('35', '150%', '0%'), null); // w 越界
  assert.equal(parseHwbColor('35', '0%', '-10%'), null); // b 越界
  assert.equal(parseHwbColor('abc', '0%', '0%'), null); // h NaN
  assert.equal(parseLabColor('abc%', '1', '1'), null); // L NaN
  assert.equal(parseOklabColor('50%', 'abc', '1'), null); // a NaN
  assert.equal(parseLchColor('50%', '1', 'abc'), null); // h NaN
  assert.equal(parseOklchColor('50%', '1', '1', 'abc'), null); // alpha NaN
});

test('CSS Color 4 写回：红色 #ff0000 生成各格式（culori 输出）', () => {
  const r = 1;
  const g = 0;
  const b = 0;
  assert.equal(rgbToHwb(r, g, b), 'hwb(0 0% 0%)');
  assert.equal(rgbToLab(r, g, b), 'lab(54.29% 80.8 69.89)');
  assert.equal(rgbToLch(r, g, b), 'lch(54.29% 106.84 41)');
  assert.equal(rgbToOklab(r, g, b), 'oklab(62.8% 0.22 0.13)');
  assert.equal(rgbToOklch(r, g, b), 'oklch(62.8% 0.26 29)');
  // alpha 段
  assert.equal(rgbToHwb(r, g, b, 0.5), 'hwb(0 0% 0% / 0.5)');
});

test('CSS Color 4 写回：hwb 是确定性的（#ff9500 直接派生于 hsl）', () => {
  // hsl(35,100%,50%) = hwb(35 0% 0%)：#ff9500 的 hwb 与 hsl 完全一致（纯色）
  assert.equal(rgbToHwb(1, 149 / 255, 0), 'hwb(35 0% 0%)');
});

// SVG fill 只识别 CSS Color 3；CSS Color 4 色值必须转成 #rrggbb 才不渲染成黑色。
test('createColorSwatchUri: CSS Color 4 色值转成 hex 后填充 SVG', () => {
  const svgOf = (color: string) => {
    const data = createColorSwatchUri(color);
    assert.ok(data.startsWith('data:image/svg+xml;base64,'), '应为 base64 data URI');
    return Buffer.from(data.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
  };
  // 各格式都应以 #rrggbb 填充（#ff9500 ≈ #ff9500），而不是直接填充原始 CSS Color 4 字符串
  for (const color of [
    '#ff9500',
    'rgb(255, 149, 0)',
    'hsl(35, 100%, 50%)',
    'hwb(35 0% 0%)',
    'oklch(76.52% 0.18 62.57)',
  ]) {
    const svg = svgOf(color);
    assert.match(svg, /fill="#[0-9a-f]{6}"/, `${color} 应转成 hex 填充`);
  }
  assert.doesNotMatch(svgOf('oklch(76.52% 0.18 62.57)'), /fill="oklch/i, 'oklch 不应直接填充原始字符串');
  assert.doesNotMatch(svgOf('hwb(35 0% 0%)'), /fill="hwb/i, 'hwb 不应直接填充原始字符串');
});

// 纯色判断：值整体是色值才判为颜色；阴影/渐变等多段值含 rgba 片段但整体不是色，不能误判。
test('isPureColor: 纯色为 true，阴影/渐变等复杂值为 false', () => {
  // 纯色
  assert.equal(isPureColor('#ff9500'), true);
  assert.equal(isPureColor('rgb(255, 149, 0)'), true);
  assert.equal(isPureColor('hsl(35, 100%, 50%)'), true);
  assert.equal(isPureColor('oklab(62.8% 0.22 0.13)'), true);
  assert.equal(isPureColor('#ff9500 !important'), true);
  assert.equal(isPureColor('#ff9500;'), true);
  // 单个 rgba 是纯色；多段值（含色值片段但整体不是色）判 false
  assert.equal(isPureColor('rgba(0, 0, 0, 0.04)'), true, '单个 rgba 是纯色');
  assert.equal(isPureColor('0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)'), false, '阴影不应判为纯色');
  assert.equal(isPureColor('linear-gradient(180deg, #fff, rgba(0,0,0,.04))'), false, '渐变不应判为纯色');
  assert.equal(isPureColor('var(--brand)'), false, '变量引用不应判为纯色');
});
