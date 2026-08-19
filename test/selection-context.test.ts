import { registerSelectionContext, shouldDisableCaseCommands } from '@/events/selection-context';
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import * as vscode from 'vscode';
import { editorWith, makeDocument } from './helpers';
const { Selection, Position } = vscode;

/** 构造选中 range 的 Selection（anchor/active 顺序无关，start/end 会归一） */
function sel(from: vscode.Position, to: vscode.Position): vscode.Selection {
  return new Selection(from, to);
}

test('shouldDisableCaseCommands: 单光标跨行非空选区 → true', () => {
  assert.equal(
    shouldDisableCaseCommands([sel(new Position(0, 0), new Position(2, 3))]),
    true,
    '单光标跨行非空选区应禁用'
  );
});

test('shouldDisableCaseCommands: 非跨行 / 空光标 / 多光标 / 无选区 → false', () => {
  // 单光标单行非空选区
  assert.equal(shouldDisableCaseCommands([sel(new Position(0, 0), new Position(0, 5))]), false);
  // 单光标空光标
  assert.equal(shouldDisableCaseCommands([sel(new Position(0, 2), new Position(0, 2))]), false);
  // 单光标跨行空光标（空选区不可能跨行，跨行必然非空）
  // 多光标（含一个跨行选区）→ 命令可用，行为层负责跳过
  assert.equal(
    shouldDisableCaseCommands([
      sel(new Position(0, 0), new Position(2, 3)),
      sel(new Position(1, 0), new Position(1, 5)),
    ]),
    false
  );
  // 无选区 / 空数组
  assert.equal(shouldDisableCaseCommands(undefined), false);
  assert.equal(shouldDisableCaseCommands([]), false);
});

test('registerSelectionContext: 注册时立即计算并写 zeta.caseDisabled', () => {
  const executed: Array<{ cmd: string; args: unknown[] }> = [];
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (cmd: string, ...args: unknown[]) => {
    executed.push({ cmd, args });
    return undefined;
  });

  // 激活编辑器为单光标跨行选区
  const doc = makeDocument('aa\nbb\ncc', '/virtual/ctx.ts', 'typescript');
  vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(
    editorWith(doc, new Selection(new Position(0, 0), new Position(2, 2)))
  );

  const sub = registerSelectionContext();
  const setCtx = executed.find(e => e.cmd === 'setContext');
  assert.ok(setCtx, '应调用 setContext');
  assert.equal(setCtx.args[0], 'zeta.caseDisabled');
  assert.equal(setCtx.args[1], true, '单光标跨行选区应禁用');
  sub.dispose();
});

test('registerSelectionContext: 选区/激活编辑器变化时刷新状态', () => {
  let selectionListener: ((e: any) => void) | undefined;
  let activeEditorListener: ((e: any) => void) | undefined;
  vi.spyOn(vscode.window, 'onDidChangeTextEditorSelection').mockImplementation((listener: any) => {
    selectionListener = listener;
    return { dispose() {} };
  });
  vi.spyOn(vscode.window, 'onDidChangeActiveTextEditor').mockImplementation((listener: any) => {
    activeEditorListener = listener;
    return { dispose() {} };
  });

  const executed: Array<{ cmd: string; args: unknown[] }> = [];
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (cmd: string, ...args: unknown[]) => {
    executed.push({ cmd, args });
    return undefined;
  });

  const doc = makeDocument('aa\nbb\ncc', '/virtual/ctx2.ts', 'typescript');

  // 初始：单光标单行 → false
  vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(
    editorWith(doc, new Selection(new Position(0, 0), new Position(0, 2)))
  );
  const sub = registerSelectionContext();
  assert.equal(executed.filter(e => e.cmd === 'setContext').at(-1)!.args[1], false, '初始单行选区不禁用');

  // 选区变化为单光标跨行 → true
  const crossEditor = editorWith(doc, new Selection(new Position(0, 0), new Position(2, 2)));
  vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(crossEditor);
  selectionListener!({});
  assert.equal(executed.filter(e => e.cmd === 'setContext').at(-1)!.args[1], true, '跨行选区应禁用');

  // 激活编辑器变化为空 → false
  vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(undefined);
  activeEditorListener!(undefined);
  assert.equal(executed.filter(e => e.cmd === 'setContext').at(-1)!.args[1], false, '无编辑器不禁用');

  sub.dispose();
});
