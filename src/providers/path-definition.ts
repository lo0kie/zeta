import { Configuration } from '@/core/configuration';
import { dirname, isFile } from '@/core/fs';
import { findProjectRootUri, resolveAliasCandidates } from '@/core/path-alias';
import * as vscode from 'vscode';

// 支持触发路径跳转的文件类型（DefinitionProvider 与 ImportHoverProvider 共用）
export const JUMP_SUPPORTED_LANGS = [
  'javascript',
  'typescript',
  'javascriptreact',
  'typescriptreact',
  'vue',
  'html',
  'css',
  'less',
  'scss',
  'sass',
  'stylus',
  'json',
];

/**
 * 取可配置的扩展名探测列表（zeta.path.extensions，默认前端常见后缀顺序）。
 * 只保留以点开头的有效后缀；原路径本身的精确匹配（无后缀）始终单独探测。
 */
function getExtensionCandidates(): string[] {
  return Array.from(
    new Set(Configuration.PATH_EXTENSIONS.filter(ext => typeof ext === 'string' && /^\.[A-Za-z0-9]+$/.test(ext.trim())))
  );
}

/** 解析目录时自动查找的 index 文件后缀（随配置生成） */
function getIndexCandidates(): string[] {
  return getExtensionCandidates().map(ext => `/index${ext}`);
}

/**
 * 精确提取一行文本中光标所在的字符串字面量及其完整范围（含引号）。
 * 范围用作 LocationLink.originSelectionRange / DocumentLink 的 range，
 * 让 VS Code 的 Ctrl+悬停下划线覆盖整个字符串（默认 wordPattern 会把 / @ . 当分隔符）。
 */
export function extractImportString(
  line: number,
  lineText: string,
  char: number
): { rawPath: string; stringRange: vscode.Range } | undefined {
  const stringRegex = /(['"`])((?:\\.|(?!\1)[^\r\n])*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = stringRegex.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (char >= start && char <= end) {
      return { rawPath: match[2].trim(), stringRange: new vscode.Range(line, start, line, end) };
    }
  }
  return undefined;
}

/**
 * 把一条导入/引用路径解析为「真实存在的目标文件 URI」列表。
 * - 支持 @ 别名（tsconfig paths）、~/、绝对 /、相对 ./ ../ 与省略 ./ 的子路径；
 * - 裸模块说明符（react、bootstrap 等包名）返回空数组，避免与同名本地文件产生错误跳转；
 * - 同名不同后缀的多个文件全部返回（F12 可在多个结果间切换），已按 fsPath 去重；
 * - 目录导入回退到 index 文件；
 * - 没有 workspace folder（单文件打开）时，以最近的 tsconfig/jsconfig/package.json 目录兜底。
 *
 * 供 PathDefinitionProvider（F12/Ctrl+点击）与 StyleImportLinkProvider（样式 @import 链接）共用。
 */
export async function resolveImportFileTargets(
  document: vscode.TextDocument,
  rawPath: string
): Promise<vscode.Uri[]> {
  const candidates: vscode.Uri[] = [];
  const currentDir = dirname(document.uri);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const projectRoot = workspaceFolder?.uri ?? (await findProjectRootUri(document.uri));

  // 1. 根据路径规则推导可能的绝对 URI
  if (rawPath.startsWith('@')) {
    const aliasUris = await resolveAliasCandidates(document.uri, rawPath, rawPath);
    if (aliasUris) candidates.push(...aliasUris);

    if (rawPath.startsWith('@/') && projectRoot) {
      candidates.push(vscode.Uri.joinPath(projectRoot, 'src', rawPath.slice(2)));
    }
  } else if (rawPath.startsWith('/')) {
    if (projectRoot) {
      candidates.push(vscode.Uri.joinPath(projectRoot, rawPath.replace(/^\/+/, '')));
    }
  } else if (rawPath.startsWith('~/')) {
    if (projectRoot) {
      candidates.push(vscode.Uri.joinPath(projectRoot, rawPath.replace(/^[~/]+/, '')));
    }
  } else if (rawPath.startsWith('.') || rawPath.includes('/')) {
    // 相对路径（./foo、../foo）或省略 ./ 前缀的相对子路径（src/utils/foo）
    candidates.push(vscode.Uri.joinPath(currentDir, rawPath));
  } else {
    // 裸模块说明符（react、bootstrap 等包名）：不应按相对路径解析，
    // 否则会与同名本地文件产生错误跳转（false positive），交由专门的模块解析处理。
    return [];
  }

  if (candidates.length === 0) return [];

  // 2. 并发探测后缀与 index 文件；结果按探测顺序收集，保证 F12 列表顺序确定
  //    （若按 Promise 完成顺序 push，并发下顺序不确定，会破坏"精确扩展名优先"等语义）
  const knownExtList = getExtensionCandidates();
  const knownExts = new Set(knownExtList);
  const indexCandidates = getIndexCandidates();
  const seen = new Set<string>();
  const probePaths: string[] = [];
  const probeTasks: Promise<boolean>[] = [];

  // 去重在入队前完成（seen 先登记），避免并发下同一路径被重复探测
  const pushProbe = (targetPath: string) => {
    const key = vscode.Uri.file(targetPath).fsPath;
    if (seen.has(key)) return;
    seen.add(key);
    probePaths.push(targetPath);
    probeTasks.push(isFile(vscode.Uri.file(targetPath)));
  };

  for (const candidate of candidates) {
    const fsPath = candidate.fsPath;
    const lastDotIndex = fsPath.lastIndexOf('.');
    const lastSepIndex = Math.max(fsPath.lastIndexOf('/'), fsPath.lastIndexOf('\\'));

    const currentExt = lastDotIndex > lastSepIndex ? fsPath.slice(lastDotIndex) : '';
    // 仅当末尾扩展名是已知类型时才剥离，避免误伤 my.component 这类含点的文件名
    const baseNoExt = currentExt && knownExts.has(currentExt) ? fsPath.slice(0, lastDotIndex) : fsPath;

    // 按序登记探测任务：
    // - 已知扩展名：先精确匹配原路径，再回退到同基名其他扩展名（支持 .js -> .ts 等）
    // - 未知/无扩展名：依次追加已知扩展名，最后原样匹配
    if (currentExt && knownExts.has(currentExt)) {
      pushProbe(fsPath);
      for (const ext of knownExtList) {
        if (ext !== currentExt) pushProbe(baseNoExt + ext);
      }
    } else {
      for (const ext of knownExtList) pushProbe(baseNoExt + ext);
      pushProbe(fsPath);
    }

    // 目录导入：回退到目录下的 index 文件
    for (const indexFile of indexCandidates) {
      pushProbe(fsPath + indexFile);
    }
  }

  const existsList = await Promise.all(probeTasks);
  const results: vscode.Uri[] = [];
  probePaths.forEach((targetPath, i) => {
    if (existsList[i]) results.push(vscode.Uri.file(targetPath));
  });

  return results;
}

export class PathDefinitionProvider implements vscode.DefinitionProvider {
  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.LocationLink[] | undefined> {
    const lineText = document.lineAt(position.line).text;
    const found = extractImportString(position.line, lineText, position.character);
    if (!found) return undefined;
    const { rawPath, stringRange } = found;

    const targets = await resolveImportFileTargets(document, rawPath);
    if (targets.length === 0) return undefined;

    // 所有命中文件都返回：js / ts / 样式表 / 资源等由本 provider 自行跳转，
    // 不依赖 VS Code 内置 TS 语言服务（用户可能未配置 TS）；同名不同后缀的多个
    // 文件 VS Code 的 F12 会在多个结果间切换，因此无需替用户挑选其一。
    const targetRange = new vscode.Range(0, 0, 0, 0);
    return targets.map(targetUri => ({
      targetUri,
      targetRange,
      targetSelectionRange: targetRange,
      originSelectionRange: stringRange,
    }) satisfies vscode.LocationLink);
  }
}

export function registerPathDefinition(): vscode.Disposable {
  const provider = new PathDefinitionProvider();
  const selectors = JUMP_SUPPORTED_LANGS.map(language => ({ language, scheme: 'file' }));
  return vscode.languages.registerDefinitionProvider(selectors, provider);
}
