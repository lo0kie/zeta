import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModule } from './helpers.mjs';

// 通过 esbuild 加载纯函数模块（不依赖 vscode 运行时）
const { clampChannel, hslToRgb, rgbToHsl, parseHexColor, parseRgbColor, parseHslColor } = await loadModule(
  `export * from './src/utils/color';`
);

// 浮点比较（hslToRgb/parseHslColor 返回分量含舍入误差）
const close = (actual, expected) => {
  for (const k of ['r', 'g', 'b', 'a']) {
    assert.ok(Math.abs(actual[k] - expected[k]) < 1e-4, `${k}: ${actual[k]} vs ${expected[k]}`);
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
