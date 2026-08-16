// 测试脚手架：esbuild 转译 src（vscode → shim），注入配置/工作区根，提供文档与断言工具
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const shimPath = join(ROOT, 'test', 'vscode-shim.cjs');

const aliasPlugin = {
  name: 'alias-vscode',
  setup(b) {
    // external: true → 运行时 require(shim)，与测试进程共享同一模块实例（instanceof 生效）
    b.onResolve({ filter: /^vscode$/ }, () => ({ path: shimPath, external: true }));
  },
};

let rootCounter = 0;

/** 创建一次性临时工作区，返回根路径 */
export function makeWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), `zeta-test-${rootCounter++}-`));
  globalThis.__zetaWsRoot = ws;
  return ws;
}

/** 注入 zeta 配置（key 为去掉 zeta. 前缀的配置名） */
export function setConfig(cfg) {
  globalThis.__zetaCfg = cfg;
  return cfg;
}

/** 清除配置与工作区根，删除临时目录 */
export function cleanup(ws) {
  delete globalThis.__zetaCfg;
  delete globalThis.__zetaWsRoot;
  delete globalThis.__lastApply;
  if (ws) rmSync(ws, { recursive: true, force: true });
}

/** 转译模块并加载，返回其导出 */
export async function loadModule(exportSrc) {
  const result = await build({
    stdin: {
      contents: exportSrc,
      resolveDir: ROOT,
      sourcefile: 'test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'cjs',
    write: false,
    platform: 'node',
    plugins: [aliasPlugin],
  });
  const sandbox = { module: { exports: {} }, exports: {} };
  sandbox.module.exports = sandbox.exports;
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(sandbox, sandbox.module.exports, require);
  return sandbox.exports;
}

/** 简单的断言工具 */
export function makeChecker() {
  let pass = 0;
  let fail = 0;
  const failures = [];
  function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
      pass++;
    } else {
      fail++;
      failures.push({ name, expected, actual });
    }
  }
  return {
    check,
    summary() {
      if (failures.length > 0) {
        for (const f of failures) {
          console.error(`✗ ${f.name}\n    expected: ${JSON.stringify(f.expected)}\n    actual:   ${JSON.stringify(f.actual)}`);
        }
      }
      return `${pass} passed, ${fail} failed`;
    },
  };
}

const norm = p => normalize(p).replace(/[\\/]+$/, '');

/** 构造离线 TextDocument（esbuild 转译出的模块可用），支持 range/offsetAt/positionAt/wordRange */
export function makeDocument(text, filePath, languageId, version = 1) {
  const lines = text.split('\n');
  const offsetAt = pos => {
    let off = 0;
    for (let i = 0; i < pos.line; i++) off += lines[i].length + 1;
    return off + pos.character;
  };
  const { Uri, Position, Range } = require(shimPath);
  return {
    uri: Uri.file(filePath),
    languageId,
    version,
    getText: range => (range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text),
    offsetAt,
    positionAt: off => {
      let line = 0;
      let remaining = off;
      while (line < lines.length && remaining > lines[line].length) {
        remaining -= lines[line].length + 1;
        line++;
      }
      return new Position(line, Math.max(0, remaining));
    },
    lineAt: pos => {
      const line = typeof pos === 'number' ? pos : pos.line;
      const isLast = line === lines.length - 1;
      return {
        text: lines[line],
        range: new Range(line, 0, line, lines[line].length),
        rangeIncludingLineBreak: new Range(line, 0, isLast ? line : line + 1, isLast ? lines[line].length : 0),
      };
    },
    getWordRangeAtPosition: (pos, regex) => {
      const line = lines[pos.line];
      const pattern = new RegExp(regex.source, 'g');
      let m;
      while ((m = pattern.exec(line)) !== null) {
        if (m.index <= pos.character && m.index + m[0].length >= pos.character) {
          return new Range(new Position(pos.line, m.index), new Position(pos.line, m.index + m[0].length));
        }
      }
      return undefined;
    },
  };
}

export { norm };

/** 包装 shim 的 workspace.fs 方法并计数（readDirectory/readFile 等），供缓存命中测试 */
export function countFs(method) {
  const vscode = require(shimPath);
  const original = vscode.workspace.fs[method];
  let count = 0;
  vscode.workspace.fs[method] = async (...args) => {
    count++;
    return original(...args);
  };
  return {
    count: () => count,
    restore: () => {
      vscode.workspace.fs[method] = original;
    },
  };
}
