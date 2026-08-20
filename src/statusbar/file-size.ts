/**
 * 状态栏当前文件大小：显示活动编辑器文件的磁盘大小，置于状态栏右侧。
 * 无点击事件、无 hover（tooltip）；跟随活动编辑器切换与文档保存/内容变化刷新。
 */
import * as vscode from 'vscode';

/** 将字节数格式化为人类可读文本 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  // 整数时省略小数，否则保留一位
  const text = value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${units[unit]}`;
}

/** 状态栏当前文件大小显示项（右侧，无交互） */
export class FileSizeStatusItem implements vscode.Disposable {
  private _item: vscode.StatusBarItem;
  private _listeners: vscode.Disposable[] = [];
  private _activeUri: vscode.Uri | undefined;

  constructor() {
    // 右侧组内：priority 越大越靠左 → 用大值放到右侧组的最左侧
    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 999);
    this._item.name = 'Zeta 当前文件大小';
    // 不设置 command、不设置 tooltip：无点击、无 hover

    this._listeners.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        this._activeUri = editor?.document.uri;
        this.update();
      }),
      // 文档内容变化（dirty）时，磁盘大小不变，但保存后需刷新；
      // 内容变化本身也用于未保存场景下按缓冲区字节数显示
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (this._activeUri && doc.uri.toString() === this._activeUri.toString()) this.update();
      }),
      vscode.workspace.onDidCloseTextDocument(doc => {
        if (this._activeUri && doc.uri.toString() === this._activeUri.toString()) this.update();
      })
    );

    this._activeUri = vscode.window.activeTextEditor?.document.uri;
    this.update();
  }

  /** 计算当前文件大小并刷新显示；untitled（未保存新文件）不显示 */
  public async update(): Promise<void> {
    const uri = this._activeUri;
    if (!uri || uri.scheme === 'untitled') {
      this._item.hide();
      return;
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const text = formatBytes(stat.size);
      if (text) {
        this._item.text = text;
        this._item.show();
      } else {
        this._item.hide();
      }
    } catch {
      // 无法 stat（文件已删除/不可读）→ 不显示
      this._item.hide();
    }
  }

  public dispose(): void {
    for (const listener of this._listeners) listener.dispose();
    this._listeners = [];
    this._item.dispose();
  }
}
