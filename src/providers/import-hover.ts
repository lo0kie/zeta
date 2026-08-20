import { extractImportString, JUMP_SUPPORTED_LANGS, resolveImportFileTargets } from '@/providers/path-definition';
import * as vscode from 'vscode';

/**
 * 导入路径的悬浮打开入口：在 js/ts/vue/样式表等任意文件里的路径字符串上悬浮时，
 * 追加解析结果与可点击的「打开」链接（调用 zeta.openResolvedImport）。
 *
 * 覆盖全部受支持的跳转语言，纯增量能力——不改任何默认键位/点击行为，
 * 只是给"内置定义结果被坏结果抢占/排后"的场景一个可靠的鼠标入口。
 * 悬浮内容只包含可点击的「打开」链接，不再展示冗余的纯文本路径。
 */
export class ImportHoverProvider implements vscode.HoverProvider {
  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const lineText = document.lineAt(position.line).text;
    const found = extractImportString(position.line, lineText, position.character);
    if (!found) return undefined;

    const targets = await resolveImportFileTargets(document, found.rawPath);
    if (targets.length === 0) return undefined;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    targets.forEach((target, i) => {
      if (i > 0) md.appendMarkdown('\n\n');
      const args = encodeURIComponent(JSON.stringify([target.toString()]));
      // 只保留可点击的「打开」链接，不再追加纯文本路径（避免重复且难看的路径展示）
      md.appendMarkdown(`[打开 ${target.fsPath}](command:zeta.openResolvedImport?${args})`);
    });
    return new vscode.Hover(md, found.stringRange);
  }
}

export function registerImportHover(): vscode.Disposable {
  return vscode.languages.registerHoverProvider(
    JUMP_SUPPORTED_LANGS.map(language => ({ language, scheme: 'file' })),
    new ImportHoverProvider()
  );
}
