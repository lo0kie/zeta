import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, loadModule, makeWorkspace, setConfig, shimPath } from './helpers.mjs';

const require = createRequire(import.meta.url);
const vscode = require(shimPath);
const { Uri } = vscode;

const { default: runScript } = await loadModule(`
  export { default } from './src/commands/run-script';
`);

test('run-script: packageManager 声明优先于锁文件', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.runScript.askArguments': false });
  try {
    const pkgPath = join(ws, 'package.json');
    writeFileSync(
      pkgPath,
      JSON.stringify({
        packageManager: 'pnpm@9.1.0',
        scripts: { build: 'tsc' },
      })
    );
    writeFileSync(join(ws, 'yarn.lock'), '');

    const executedCmds = [];
    const origPick = vscode.window.showQuickPick;
    const origTerminal = vscode.window.createTerminal;

    vscode.window.showQuickPick = async () => ({ label: 'build', detail: 'tsc' });
    vscode.window.createTerminal = () => ({
      show() {},
      sendText(cmd) {
        executedCmds.push(cmd);
      },
      dispose() {},
    });

    try {
      await runScript(Uri.file(pkgPath));
      assert.equal(executedCmds[0], 'pnpm run build');
    } finally {
      vscode.window.showQuickPick = origPick;
      vscode.window.createTerminal = origTerminal;
    }
  } finally {
    cleanup(ws);
  }
});

test('run-script: 锁文件映射嗅探 (yarn / bun / pnpm)', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.runScript.askArguments': false });
  try {
    const testCases = [
      { lock: 'yarn.lock', expectedManager: 'yarn' },
      { lock: 'pnpm-lock.yaml', expectedManager: 'pnpm' },
      { lock: 'bun.lockb', expectedManager: 'bun' },
      { lock: 'package-lock.json', expectedManager: 'npm' },
    ];

    for (const { lock, expectedManager } of testCases) {
      const dir = join(ws, expectedManager);
      mkdirSync(dir, { recursive: true });
      const pkgPath = join(dir, 'package.json');
      writeFileSync(pkgPath, JSON.stringify({ scripts: { dev: 'vite' } }));
      writeFileSync(join(dir, lock), '');

      const executedCmds = [];
      const origPick = vscode.window.showQuickPick;
      const origTerminal = vscode.window.createTerminal;

      vscode.window.showQuickPick = async () => ({ label: 'dev', detail: 'vite' });
      vscode.window.createTerminal = () => ({
        show() {},
        sendText(cmd) {
          executedCmds.push(cmd);
        },
        dispose() {},
      });

      try {
        await runScript(Uri.file(pkgPath));
        assert.equal(executedCmds[0], `${expectedManager} run dev`);
      } finally {
        vscode.window.showQuickPick = origPick;
        vscode.window.createTerminal = origTerminal;
      }
    }
  } finally {
    cleanup(ws);
  }
});

test('run-script: askArguments=true 追加参数', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.runScript.askArguments': true });
  try {
    const pkgPath = join(ws, 'package.json');
    writeFileSync(pkgPath, JSON.stringify({ scripts: { test: 'vitest' } }));

    const executedCmds = [];
    const origPick = vscode.window.showQuickPick;
    const origInput = vscode.window.showInputBox;
    const origTerminal = vscode.window.createTerminal;

    vscode.window.showQuickPick = async () => ({ label: 'test', detail: 'vitest' });
    vscode.window.showInputBox = async () => ' --coverage --ui ';
    vscode.window.createTerminal = () => ({
      show() {},
      sendText(cmd) {
        executedCmds.push(cmd);
      },
      dispose() {},
    });

    try {
      await runScript(Uri.file(pkgPath));
      assert.equal(executedCmds[0], 'npm run test -- --coverage --ui');
    } finally {
      vscode.window.showQuickPick = origPick;
      vscode.window.showInputBox = origInput;
      vscode.window.createTerminal = origTerminal;
    }
  } finally {
    cleanup(ws);
  }
});

test('run-script: 目标为普通文件时向上查找 package.json', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.runScript.askArguments': false });
  try {
    const subDir = join(ws, 'src', 'components');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint' } }));
    const targetFile = join(subDir, 'Button.ts');
    writeFileSync(targetFile, '');

    const executedCmds = [];
    const origPick = vscode.window.showQuickPick;
    const origTerminal = vscode.window.createTerminal;

    vscode.window.showQuickPick = async () => ({ label: 'lint', detail: 'eslint' });
    vscode.window.createTerminal = () => ({
      show() {},
      sendText(cmd) {
        executedCmds.push(cmd);
      },
      dispose() {},
    });

    try {
      await runScript(Uri.file(targetFile));
      assert.equal(executedCmds[0], 'npm run lint');
    } finally {
      vscode.window.showQuickPick = origPick;
      vscode.window.createTerminal = origTerminal;
    }
  } finally {
    cleanup(ws);
  }
});

test('run-script: package.json 缺失、语法损坏与空 scripts 异常提示', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    let warnMessage = '';
    let errorMessage = '';

    const origWarn = vscode.window.showWarningMessage;
    const origError = vscode.window.showErrorMessage;

    vscode.window.showWarningMessage = async msg => {
      warnMessage = msg;
    };
    vscode.window.showErrorMessage = async msg => {
      errorMessage = msg;
    };

    try {
      const nonExist = join(ws, 'empty-dir');
      mkdirSync(nonExist, { recursive: true });
      await runScript(Uri.file(nonExist));
      assert.ok(warnMessage.includes('package.json'));

      warnMessage = '';
      const emptyPkg = join(ws, 'empty-pkg', 'package.json');
      mkdirSync(join(ws, 'empty-pkg'), { recursive: true });
      writeFileSync(emptyPkg, JSON.stringify({ name: 'empty' }));
      await runScript(Uri.file(emptyPkg));
      assert.ok(warnMessage.includes('未配置任何 scripts'));

      const brokenPkg = join(ws, 'broken-pkg', 'package.json');
      mkdirSync(join(ws, 'broken-pkg'), { recursive: true });
      writeFileSync(brokenPkg, '{ invalid json }');
      await runScript(Uri.file(brokenPkg));
      assert.ok(errorMessage.includes('无法正确解析'));
    } finally {
      vscode.window.showWarningMessage = origWarn;
      vscode.window.showErrorMessage = origError;
    }
  } finally {
    cleanup(ws);
  }
});

test('run-script: Monorepo 子包无锁文件时向上查找根目录 pnpm-lock.yaml', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.runScript.askArguments': false });
  try {
    writeFileSync(join(ws, 'pnpm-lock.yaml'), '');
    const pkgDir = join(ws, 'packages', 'client');
    mkdirSync(pkgDir, { recursive: true });
    const pkgJson = join(pkgDir, 'package.json');
    writeFileSync(pkgJson, JSON.stringify({ scripts: { build: 'vite build' } }));

    const executedCmds = [];
    const origPick = vscode.window.showQuickPick;
    const origTerminal = vscode.window.createTerminal;

    vscode.window.showQuickPick = async () => ({ label: 'build', detail: 'vite build' });
    vscode.window.createTerminal = () => ({
      show() {},
      sendText(cmd) {
        executedCmds.push(cmd);
      },
      dispose() {},
    });

    try {
      await runScript(Uri.file(pkgJson));
      assert.equal(executedCmds[0], 'pnpm run build');
    } finally {
      vscode.window.showQuickPick = origPick;
      vscode.window.createTerminal = origTerminal;
    }
  } finally {
    cleanup(ws);
  }
});
