import StatusBarItem from '@/classes/StatusBarItem';
import { formatSize } from '@/utils';
import { Configuration } from '@/utils/configuration';
import { freemem, totalmem } from 'node:os';
import * as vscode from 'vscode';

class FileSizeStatusBar extends StatusBarItem {
  constructor() {
    super(StatusBarItem.Right, 101);
  }

  public async update(): Promise<void> {
    if (!Configuration.FILE_SIZE || !vscode.window.activeTextEditor) {
      this.resetState();
      return;
    }
    try {
      this.setVisible(true);
      const { uri, isUntitled } = vscode.window.activeTextEditor.document;
      if (isUntitled) throw new Error('Untitled file');

      const { size } = await vscode.workspace.fs.stat(uri);
      this.setText(formatSize(size));
    } catch {
      this.resetState();
    }
  }
}

class MemoryStatusBar extends StatusBarItem {
  constructor() {
    super(StatusBarItem.Right, 102);
  }

  public update(): void {
    if (!Configuration.MEMORY) {
      this.resetState();
      return;
    }
    const freeMemB = freemem();
    const totalMemB = totalmem();
    const usedMemB = totalMemB - freeMemB;
    this.setText(`${formatSize(usedMemB, undefined, true)} / ${formatSize(totalMemB)}`).setVisible(true);
  }
}

// 导出新的状态栏实例
export const fileSize = new FileSizeStatusBar();
export const memory = new MemoryStatusBar();

// 内部自闭环轮询，不把污染扩散给外部监听器
setInterval(() => memory.update(), 3000);
