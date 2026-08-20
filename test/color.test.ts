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
import type { TextDocument } from 'vscode';
import { Color, Range } from 'vscode';
import { cleanup, makeDocument, makeWorkspace, setConfig } from './helpers';

const colorTuple = (c: Color): number[] => [c.red, c.green, c.blue, c.alpha].map(v => Number(v.toFixed(3)));

// 回归：lab/lch pattern 带 (?<!ok) 负向前瞻，避免在 oklab( / oklch( 内部误匹配子串 lab( / lch( 产生重复色块
test('JS 字符串：oklch/oklab 只产生一个色块（不误匹配内部 lab/lch 子串）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text =
      `const a = 'oklch(62.8% 0.26 29)';\n` +
      `const b = 'oklab(62.8% 0.22 0.13)';\n` +
      `const c = 'lch(62.8% 0.26 29)';\n` +
      `const d = 'lab(62.8% 0.22 0.13)';\n`;
    const doc = makeDocument(text, join(ws, 'a.js'), 'javascript');
    const colors = await new StyleColorProvider().provideDocumentColors(doc);
    // 每行一个色值，共 4 个；oklch/oklab 各自只能有 1 个（不叠加）
    assert.equal(colors.length, 4, 'oklch/oklab/lch/lab 各恰好 1 个色块，共 4 个');

    // 各自 range 覆盖整个函数调用，而非截断的子串
    const byRangeText = colors.map(c => doc.getText(c.range));
    assert.equal(byRangeText.filter(t => t.startsWith('oklch(')).length, 1);
    assert.equal(byRangeText.filter(t => t.startsWith('oklab(')).length, 1);
    assert.equal(byRangeText.filter(t => t === 'oklch(62.8% 0.26 29)').length, 1, 'oklch 色块覆盖完整表达式');
    assert.equal(byRangeText.filter(t => t === 'oklab(62.8% 0.22 0.13)').length, 1, 'oklab 色块覆盖完整表达式');
  } finally {
    cleanup(ws);
  }
});

test('JS 字符串基础色值探测（hex / rgb / hsl / hsla）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text =
      `const a = '#ff0000';\nconst b = "rgb(0, 255, 0)";\n` +
      `const c = 'hsl(120, 100%, 50%)';\nconst d = "hsla(240, 100%, 50%, 0.5)";\n`;
    const doc = makeDocument(text, join(ws, 'a.js'), 'javascript');
    const colors = await new StyleColorProvider().provideDocumentColors(doc);
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

test('CSS Color 4: 支持空格分隔与 / alpha 语法 (rgb 与 hsl)', async () => {
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
    const colors = await new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 4);

    assert.deepEqual(colorTuple(colors[0].color), [1, 0, 0, 0.5]);
    assert.deepEqual(colorTuple(colors[1].color), [0, 1, 0, 0.5]);
    assert.deepEqual(colorTuple(colors[2].color), [1, 0, 0, 1]);
    assert.deepEqual(colorTuple(colors[3].color), [0, 1, 1, 1]);
  } finally {
    cleanup(ws);
  }
});

test('模板字符串：${} 屏蔽但静态色值保留', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = 'const s = `color: #ff0000; width: ${w}px;`;';
    const doc = makeDocument(text, join(ws, 't.js'), 'javascript');
    const colors = await new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 1);
    assert.deepEqual(colorTuple(colors[0].color), [1, 0, 0, 1]);
    const at = text.indexOf('#ff0000');
    assert.deepEqual([colors[0].range.start.character, colors[0].range.end.character], [at, at + 7]);
  } finally {
    cleanup(ws);
  }
});

test('注释与正则字面量跳过、非 hex 词不误报', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `// #fff\n/* #000 */\nconst re = /^#abc$/;\nconst id = '#main';\nconst ok = '#abcdef';\n`;
    const doc = makeDocument(text, join(ws, 'c.js'), 'javascript');
    const colors = await new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 1);
    assert.deepEqual(colorTuple(colors[0].color), [0.671, 0.804, 0.937, 1]);
  } finally {
    cleanup(ws);
  }
});

test('vue：仅提取 template/script/style 字符串字面量（裸 style 交由 Volar 处理）', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `<template><div :style="{ color: '#00ff00' }">x</div></template>\n<style>.a { color: #ff0000; content: "#00ff00"; }</style>\n`;
    const doc = makeDocument(text, join(ws, 'v.vue'), 'vue');
    const colors = await new StyleColorProvider().provideDocumentColors(doc);
    assert.equal(colors.length, 2);
  } finally {
    cleanup(ws);
  }
});

test('fast-path：无任何色值标记的文本直接返回空', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    // 500 行无任何 #/rgb/hsl 标记即可命中 fast-path 正则分支（行数与触发条件无关）
    const text = Array.from({ length: 500 }, (_, i) => `const x${i} = ${i} * 2;`).join('\n');
    const doc = makeDocument(text, join(ws, 'big.js'), 'javascript');
    assert.equal((await new StyleColorProvider().provideDocumentColors(doc)).length, 0);
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

// 灰度色（r === g === b，无饱和度）时 culori 的 h 为 undefined，色相应归 0，不能产出 NaN。
// 回归：此前 c.h! 断言只骗过 TS，运行时 NaN 污染写回成 hwb(NaN 100% 0%) 等非法 CSS。
test('CSS Color 4 写回：灰度色 h 为 undefined 时色相归 0，不产出 NaN', () => {
  // 纯白 #ffffff
  assert.equal(rgbToHwb(1, 1, 1), 'hwb(0 100% 0%)');
  assert.equal(rgbToLch(1, 1, 1), 'lch(100% 0 0)');
  assert.equal(rgbToOklch(1, 1, 1), 'oklch(100% 0 0)');
  // 纯黑 #000000
  assert.equal(rgbToHwb(0, 0, 0), 'hwb(0 0% 100%)');
  assert.equal(rgbToLch(0, 0, 0), 'lch(0% 0 0)');
  assert.equal(rgbToOklch(0, 0, 0), 'oklch(0% 0 0)');
  // 中间灰 rgb(128,128,128)
  assert.equal(rgbToHwb(128 / 255, 128 / 255, 128 / 255), 'hwb(0 50.2% 49.8%)');
  assert.equal(rgbToLch(128 / 255, 128 / 255, 128 / 255), 'lch(53.59% 0 0)');
  assert.equal(rgbToOklch(128 / 255, 128 / 255, 128 / 255), 'oklch(59.99% 0 0)');
  // 明确不产出 NaN
  assert.ok(!rgbToHwb(1, 1, 1).includes('NaN'));
  assert.ok(!rgbToLch(1, 1, 1).includes('NaN'));
  assert.ok(!rgbToOklch(1, 1, 1).includes('NaN'));
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

// vue <style> 块定义纯色变量，template 里 var(--x) 引用处挂可调色色块（与普通色值一致，可写回真实色值）。
test('vue：var(--x) 引用处为纯色变量时挂可调色色块', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text =
      `<template><div :style="{ color: 'var(--brand)' }">x</div></template>\n` +
      `<style>:root { --brand: #ff9500; --shadow-sm: 0 1px 3px rgba(0,0,0,.04); }</style>\n`;
    const doc = makeDocument(text, join(ws, 'ref.vue'), 'vue');
    const colors = await new StyleColorProvider().provideDocumentColors(doc);

    // var(--brand) 是纯色 → 挂色块；var(--shadow-sm) 非纯色 → 不挂
    const brandVar = colors.find(c => doc.getText(c.range).includes('--brand'));
    assert.ok(brandVar, 'var(--brand) 引用应挂色块');
    // 解析出的颜色接近 #ff9500
    assert.ok(Math.abs(brandVar!.color.red - 1) < 1e-2, 'red ≈ 255');
    assert.ok(Math.abs(brandVar!.color.green - 149 / 255) < 1e-2, 'green ≈ 149');
    assert.ok(Math.abs(brandVar!.color.blue) < 1e-2, 'blue ≈ 0');
    assert.equal(doc.getText(brandVar!.range), '--brand', '色块只覆盖变量名（显示在 var( 之后）');

    // 可调色：与普通色值一样返回完整写回格式列表
    const presentations = new StyleColorProvider().provideColorPresentations(brandVar!.color, {
      document: doc,
      range: brandVar!.range,
    });
    assert.equal(presentations.length, 8, '提供完整 8 种写回格式，可正常调色');
    assert.equal(presentations[0].label, '#ff9500', 'hex 为默认第一项');
    // 写回时用 textEdit 替换整个 var() 引用，而非只替换变量名（避免 var(#ff9500)）
    for (const p of presentations) {
      assert.ok(p.textEdit, '变量色块的 presentation 应带 textEdit 覆盖整个 var()');
      assert.equal(
        p.textEdit!.range && doc.getText(p.textEdit!.range),
        'var(--brand)',
        `textEdit 应替换整个 var()，当前格式 ${p.label}`
      );
      assert.equal(p.textEdit!.newText, p.label, 'textEdit 的新文本为选中格式的色值');
    }

    const shadowVar = colors.find(c => doc.getText(c.range).includes('var(--shadow-sm)'));
    assert.ok(!shadowVar, 'var(--shadow-sm) 非纯色不挂色块');
  } finally {
    cleanup(ws);
  }
});

// 纯样式文件：普通色值色块交给内置 CSS 语言服务，zeta 只补充 var(--x) 变量引用色块
test('css：var(--x) 引用处为纯色变量时挂色块', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text =
      `:root { --brand: #ff9500; --shadow-sm: 0 1px 3px rgba(0,0,0,.04); }\n` +
      `.a { color: var(--brand); box-shadow: var(--shadow-sm); }`;
    const doc = makeDocument(text, join(ws, 'a.css'), 'css');
    const colors = await new StyleColorProvider().provideDocumentColors(doc);

    // var(--brand) 是纯色 → 挂色块；var(--shadow-sm) 非纯色 → 不挂
    const brandVar = colors.find(c => doc.getText(c.range) === '--brand');
    assert.ok(brandVar, 'var(--brand) 引用应挂色块');
    assert.ok(Math.abs(brandVar!.color.red - 1) < 1e-2, 'red ≈ 255');
    assert.ok(Math.abs(brandVar!.color.green - 149 / 255) < 1e-2, 'green ≈ 149');
    assert.ok(Math.abs(brandVar!.color.blue) < 1e-2, 'blue ≈ 0');
    assert.equal(doc.getText(brandVar!.range), '--brand', '色块只覆盖变量名（显示在 var( 之后）');

    const shadowVar = colors.find(c => doc.getText(c.range) === '--shadow-sm');
    assert.ok(!shadowVar, 'var(--shadow-sm) 非纯色不挂色块');

    // 可调色：与普通色值一样返回完整写回格式
    const presentations = new StyleColorProvider().provideColorPresentations(brandVar!.color, {
      document: doc,
      range: brandVar!.range,
    });
    assert.equal(presentations.length, 8, '提供完整 8 种写回格式');
    for (const p of presentations) {
      assert.ok(p.textEdit, '变量色块 presentation 应带 textEdit 覆盖整个 var()');
      assert.equal(doc.getText(p.textEdit!.range), 'var(--brand)', 'textEdit 应替换整个 var()');
    }
  } finally {
    cleanup(ws);
  }
});

// 上下文感知：同一变量在 :root 与 .dark 均有定义时，
// .dark 内的 var() 引用应显示 .dark 的定义色，而非永远取第一个（:root）。
test('css：多定义变量按上下文（作用域）选择生效色', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text =
      `:root { --brand: #ff9500; }\n` +
      `.dark { --brand: #7dd3fc; }\n` +
      `.a { color: var(--brand); }\n` +
      `.dark .b { color: var(--brand); }`;
    const doc = makeDocument(text, join(ws, 'a.css'), 'css');
    const colors = await new StyleColorProvider().provideDocumentColors(doc);

    const colorAt = (varIndex: number) => {
      const offset = text.indexOf('--brand', varIndex);
      return colors.find(c => doc.offsetAt(c.range.start) === offset);
    };
    const aIdx = text.indexOf('var(--brand)');
    const bIdx = text.indexOf('var(--brand)', aIdx + 1);
    const aColor = colorAt(aIdx);
    const bColor = colorAt(bIdx);

    assert.ok(aColor, '.a 的 var(--brand) 应有色块');
    assert.ok(bColor, '.dark .b 的 var(--brand) 应有色块');
    // .a → :root 定义 #ff9500
    assert.equal(Math.round(aColor!.color.red * 255), 255);
    assert.equal(Math.round(aColor!.color.green * 255), 149);
    assert.equal(Math.round(aColor!.color.blue * 255), 0);
    // .dark .b → .dark 定义 #7dd3fc
    assert.equal(Math.round(bColor!.color.red * 255), 125);
    assert.equal(Math.round(bColor!.color.green * 255), 211);
    assert.equal(Math.round(bColor!.color.blue * 255), 252);
  } finally {
    cleanup(ws);
  }
});

// less/scss 同为纯样式语言，普通色值由内置插件处理，var(--x) 纯色变量挂色块
test('scss：var(--x) 纯色变量引用挂色块', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    const text = `:root { --accent: #0af; }\n.a { border-color: var(--accent); }`;
    const doc = makeDocument(text, join(ws, 'a.scss'), 'scss');
    const colors = await new StyleColorProvider().provideDocumentColors(doc);
    const accentVar = colors.find(c => doc.getText(c.range) === '--accent');
    assert.ok(accentVar, 'var(--accent) 引用应挂色块');
  } finally {
    cleanup(ws);
  }
});

// 写回格式固定顺序、不做任何重排：VS Code 用户在下拉里手动选择确认格式，选什么写回什么。
// 既不做「匹配原文排第一」（原文 oklch 时 oklch 永远默认），也不做「确认后自动前进」（导致闪烁）。
// 队列顺序固定 = [hex, rgb, hsl, hwb, lab, lch, oklab, oklch]，与原文无关。
test('写回格式固定顺序：不随原文格式重排', () => {
  const provider = new StyleColorProvider();
  const mkContext = (text: string, selStart: number, selEnd: number) => {
    const doc = makeDocument(text, '/virtual/fmt.js', 'javascript');
    const range = new Range(doc.positionAt(selStart), doc.positionAt(selEnd));
    return { document: doc, range };
  };

  const labelsOf = (text: string, selStart: number, selEnd: number) =>
    provider.provideColorPresentations(new Color(1, 0, 0, 1), mkContext(text, selStart, selEnd)).map(p => p.label);

  // 无论原文是什么格式，第一项都固定是 hex
  const oklch = labelsOf('const c = oklch(62.8% 0.26 29);', 10, 29);
  const hex = labelsOf('const c = #ff0000;', 10, 17);
  const hsl = labelsOf('const c = hsl(0, 100%, 50%);', 10, 28);
  const hwb = labelsOf('const c = hwb(0 0% 0%);', 10, 21);

  for (const labels of [oklch, hex, hsl, hwb]) {
    assert.equal(labels[0], '#ff0000', '无论原文格式，第一项固定为 hex');
    assert.equal(labels.length, 8, '提供完整 8 种格式');
  }
  // 全部 8 种格式都在，用户可手动选任意一种（各格式用函数名前缀判别，不断言具体数值）
  const prefixOf = (s: string) => {
    if (s.startsWith('#')) return '#';
    const m = s.match(/^([a-z]+)/);
    return m ? m[1] : s;
  };
  const expectedPrefixes = ['#', 'rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch'];
  const gotPrefixes = oklch.map(prefixOf).sort();
  assert.deepEqual(gotPrefixes, [...expectedPrefixes].sort(), '固定顺序应包含全部 8 种格式');
});
