import runPackageScript from '@/commands/run-package-script';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, vi } from 'vitest';
import * as vscode from 'vscode';
import { cleanup, makeWorkspace, setConfig } from './helpers';

const { Uri } = vscode;

function fakeTerminal(executedCmds: string[]): vscode.Terminal {
  return {
    show() {},
    sendText(cmd: string) {
      executedCmds.push(cmd);
    },
    dispose() {},
  } as unknown as vscode.Terminal;
}

function spyQuickPick(label: string, detail: string): void {
  vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(
    async (): Promise<vscode.QuickPickItem | undefined> => ({ label, detail })
  );
}

function spyTerminal(executedCmds: string[]): void {
  vi.spyOn(vscode.window, 'createTerminal').mockImplementation(() => fakeTerminal(executedCmds));
}

test('run-package-script: packageManager 声明优先于锁文件', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.packageScript.askArguments': false });
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

    const executedCmds: string[] = [];
    spyQuickPick('build', 'tsc');
    spyTerminal(executedCmds);

    await runPackageScript(Uri.file(pkgPath));
    assert.equal(executedCmds[0], 'pnpm run build');
  } finally {
    cleanup(ws);
  }
});

test('run-package-script: 锁文件映射嗅探 (yarn / bun / pnpm)', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.packageScript.askArguments': false });
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

      const executedCmds: string[] = [];
      spyQuickPick('dev', 'vite');
      spyTerminal(executedCmds);

      await runPackageScript(Uri.file(pkgPath));
      assert.equal(executedCmds[0], `${expectedManager} run dev`);
    }
  } finally {
    cleanup(ws);
  }
});

test('run-package-script: askArguments=true 追加参数', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.packageScript.askArguments': true });
  try {
    const pkgPath = join(ws, 'package.json');
    writeFileSync(pkgPath, JSON.stringify({ scripts: { test: 'vitest' } }));

    const executedCmds: string[] = [];
    spyQuickPick('test', 'vitest');
    vi.spyOn(vscode.window, 'showInputBox').mockImplementation(
      async (): Promise<string | undefined> => ' --coverage --ui '
    );
    spyTerminal(executedCmds);

    await runPackageScript(Uri.file(pkgPath));
    assert.equal(executedCmds[0], 'npm run test -- --coverage --ui');
  } finally {
    cleanup(ws);
  }
});

test('run-package-script: 目标为普通文件时向上查找 package.json', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.packageScript.askArguments': false });
  try {
    const subDir = join(ws, 'src', 'components');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint' } }));
    const targetFile = join(subDir, 'Button.ts');
    writeFileSync(targetFile, '');

    const executedCmds: string[] = [];
    spyQuickPick('lint', 'eslint');
    spyTerminal(executedCmds);

    await runPackageScript(Uri.file(targetFile));
    assert.equal(executedCmds[0], 'npm run lint');
  } finally {
    cleanup(ws);
  }
});

test('run-package-script: package.json 缺失、语法损坏与空 scripts 异常提示', async () => {
  const ws = makeWorkspace();
  setConfig({});
  try {
    let warnMessage = '';
    let errorMessage = '';

    vi.spyOn(vscode.window, 'showWarningMessage').mockImplementation(
      async (msg: string): Promise<vscode.MessageItem | undefined> => {
        warnMessage = msg;
        return undefined;
      }
    );
    vi.spyOn(vscode.window, 'showErrorMessage').mockImplementation(
      async (msg: string): Promise<vscode.MessageItem | undefined> => {
        errorMessage = msg;
        return undefined;
      }
    );

    const nonExist = join(ws, 'empty-dir');
    mkdirSync(nonExist, { recursive: true });
    await runPackageScript(Uri.file(nonExist));
    assert.ok(warnMessage.includes('package.json'));

    warnMessage = '';
    const emptyPkg = join(ws, 'empty-pkg', 'package.json');
    mkdirSync(join(ws, 'empty-pkg'), { recursive: true });
    writeFileSync(emptyPkg, JSON.stringify({ name: 'empty' }));
    await runPackageScript(Uri.file(emptyPkg));
    assert.ok(warnMessage.includes('未配置任何 scripts'));

    const brokenPkg = join(ws, 'broken-pkg', 'package.json');
    mkdirSync(join(ws, 'broken-pkg'), { recursive: true });
    writeFileSync(brokenPkg, '{ invalid json }');
    await runPackageScript(Uri.file(brokenPkg));
    assert.ok(errorMessage.includes('无法正确解析'));
  } finally {
    cleanup(ws);
  }
});

test('run-package-script: Monorepo 子包无锁文件时向上查找根目录 pnpm-lock.yaml', async () => {
  const ws = makeWorkspace();
  setConfig({ 'zeta.packageScript.askArguments': false });
  try {
    writeFileSync(join(ws, 'pnpm-lock.yaml'), '');
    const pkgDir = join(ws, 'packages', 'client');
    mkdirSync(pkgDir, { recursive: true });
    const pkgJson = join(pkgDir, 'package.json');
    writeFileSync(pkgJson, JSON.stringify({ scripts: { build: 'vite build' } }));

    const executedCmds: string[] = [];
    spyQuickPick('build', 'vite build');
    spyTerminal(executedCmds);

    await runPackageScript(Uri.file(pkgJson));
    assert.equal(executedCmds[0], 'pnpm run build');
  } finally {
    cleanup(ws);
  }
});
