import explorerTreeViewProvider from '@/providers/explorer-view';
import { fileSize, memory } from '@/statusbar';
import { debounce } from '@/utils'; // 引入防抖
import * as vscode from 'vscode';

export function registerEvents(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      fileSize.update();
      memory.update();
    })
  );

  // 🚀 核心优化：使用防抖，停止打字 500ms 后再去读取硬盘
  const debouncedFileSizeUpdate = debounce(() => fileSize.update(), 500);

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      debouncedFileSizeUpdate();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(({ affectsConfiguration }) => {
      const needsRefresh = ['zeta.show.description', 'zeta.list.folders', 'zeta.list.filterFolders'].some(key =>
        affectsConfiguration(key)
      );
      if (needsRefresh) {
        // 配置改变时，清空侧边栏正则缓存（配合下文的第二点优化）
        explorerTreeViewProvider.clearCache();
        explorerTreeViewProvider.refresh();
      }

      if (affectsConfiguration('zeta.show.memory')) memory.update();
      if (affectsConfiguration('zeta.show.fileSize')) fileSize.update();
    })
  );
}
