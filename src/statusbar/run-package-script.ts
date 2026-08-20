/**
 * 状态栏脚本运行按钮：点击执行 zeta.folder.runPackageScript（查找 package.json 脚本并运行）。
 */
import { Configuration } from '@/core/configuration';
import * as vscode from 'vscode';

/**
 * 状态栏脚本运行按钮：npm 风格图标，点击触发脚本查找运行命令。
 * 受 zeta.show.packageScript 配置与是否存在工作区文件夹控制可见性，dispose 时统一清理。
 */
export class PackageScriptStatusItem implements vscode.Disposable {
  private _item: vscode.StatusBarItem;
  private _listeners: vscode.Disposable[] = [];

  constructor() {
    // 紧靠终端切换按钮（priority 100）左侧，置于状态栏左侧组
    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this._item.name = 'Zeta 脚本运行';
    this._item.command = 'zeta.folder.runPackageScript';
    this._item.text = '$(package)';
    this._item.tooltip = '查找脚本运行';

    this._listeners.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.update()),
      vscode.workspace.onDidChangeConfiguration(({ affectsConfiguration }) => {
        if (affectsConfiguration('zeta.show.packageScript')) this.update();
      })
    );

    this.update();
  }

  /** 配置或工作区文件夹变化时刷新可见性 */
  public update(): void {
    const hasFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    if (Configuration.PACKAGE_SCRIPT && hasFolder) this._item.show();
    else this._item.hide();
  }

  public dispose(): void {
    for (const listener of this._listeners) listener.dispose();
    this._listeners = [];
    this._item.dispose();
  }
}
