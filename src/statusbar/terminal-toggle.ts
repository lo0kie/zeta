import { Configuration } from '@/core/configuration';
import * as vscode from 'vscode';

/**
 * 状态栏终端切换按钮：图标 + 当前终端数量，点击切换面板显示。
 * 自管理事件监听（终端开关、配置变更），dispose 时统一清理。
 */
export class TerminalToggleStatusItem implements vscode.Disposable {
  private _item: vscode.StatusBarItem;
  private _listeners: vscode.Disposable[] = [];

  constructor() {
    const alignment = vscode.StatusBarAlignment?.Left ?? 1;
    this._item = vscode.window.createStatusBarItem(alignment, 100);
    this._item.name = 'Zeta 终端切换';
    this._item.command = 'zeta.terminal.toggle';

    const listeners = [
      vscode.window.onDidOpenTerminal?.(() => this.update()),
      vscode.window.onDidCloseTerminal?.(() => this.update()),
      vscode.workspace.onDidChangeConfiguration?.(({ affectsConfiguration }) => {
        if (affectsConfiguration('zeta.show.terminal')) this.update();
      }),
    ].filter((l): l is vscode.Disposable => !!l && typeof l.dispose === 'function');

    this._listeners.push(...listeners);

    this.update();
  }

  /** 终端数量或配置变化时刷新文案与可见性 */
  public update(): void {
    const count = vscode.window.terminals.length;

    this._item.text = count > 0 ? `$(terminal) ${count}` : '$(terminal)';
    this._item.tooltip = count > 0 ? `切换终端显示（当前 ${count} 个终端）` : '切换终端显示';

    if (Configuration.TERMINAL) this._item.show();
    else this._item.hide();
  }

  public dispose(): void {
    for (const listener of this._listeners) listener.dispose();
    this._listeners = [];
    this._item.dispose();
  }
}
