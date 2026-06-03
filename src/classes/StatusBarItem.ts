import * as vscode from 'vscode';

export default abstract class StatusBarItem implements vscode.Disposable {
  private _statusBarItem: vscode.StatusBarItem;
  public command?: vscode.StatusBarItem['command'];

  public static Left = vscode.StatusBarAlignment.Left;
  public static Right = vscode.StatusBarAlignment.Right;

  constructor(
    alignment?: vscode.StatusBarAlignment,
    priority?: number,
    private _icon = '',
    public text = '',
    public visible = true
  ) {
    this._statusBarItem = vscode.window.createStatusBarItem(alignment, priority);
    this.setText(text).setVisible(visible);
  }

  public dispose(): void {
    this._statusBarItem.dispose();
  }

  public resetState(): this {
    this.setVisible(false);
    this.setText('');
    this.setTooltip('');
    this.setCommand();
    return this;
  }

  // 抽象方法，强制继承者实现自己的 update 逻辑
  public abstract update(): void | Promise<void>;

  public setVisible(visible: boolean): this {
    if (visible) this._statusBarItem.show();
    else this._statusBarItem.hide();

    this.visible = visible;
    return this;
  }

  public setText(text: string): this {
    this._statusBarItem.text = this._icon ? `${this._icon} ${text}` : text;
    this.text = text;
    return this;
  }

  public setTooltip(tooltip: vscode.StatusBarItem['tooltip']): this {
    this._statusBarItem.tooltip = tooltip;
    return this;
  }

  public setCommand(command?: vscode.StatusBarItem['command']): this {
    this._statusBarItem.command = command;
    this.command = command;
    return this;
  }
}
