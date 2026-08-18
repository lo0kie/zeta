import { dirname, isFile } from '@/core/fs';
import { TtlCache } from '@/core/ttl-cache';
import * as vscode from 'vscode';

/** 路径别名：key 如 '@/*'，targets 为按顺序尝试的候选 target（如 ['./src/*', './types/*']） */
export interface PathAlias {
  key: string;
  targets: string[];
}

/** tsconfig/jsconfig 中解析出的别名上下文 */
export interface AliasContext {
  configUri: vscode.Uri;
  aliases: PathAlias[];
  baseUrl?: string;
}

const ALIAS_CACHE_TTL_MS = 5000;

// 缓存 key 为「起始文件所在目录」，避免每次击键都向上逐级查找并重新读盘解析配置
const aliasContextCache = new TtlCache<AliasContext | undefined>(ALIAS_CACHE_TTL_MS);

/** tsconfig/jsconfig 是 JSONC：剥离注释与尾随逗号后再 JSON.parse */
function stripJsonc(content: string): string {
  const noComments = content.replace(/"(?:\\.|[^"\\\r\n])*?"|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*/g, match =>
    match.startsWith('/') ? '' : match
  );
  return noComments.replace(/("(?:\\.|[^"\\\r\n])*?")|,\s*([\]}])/g, (match, str, brace) => (str ? str : brace));
}

/** 读取 compilerOptions 的 paths 与 baseUrl（配置缺失或解析失败时返回 undefined） */
async function readPathAliases(configUri: vscode.Uri): Promise<{ aliases: PathAlias[]; baseUrl?: string } | undefined> {
  try {
    const raw = await vscode.workspace.fs.readFile(configUri);
    const config = JSON.parse(stripJsonc(new TextDecoder().decode(raw))) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, unknown> };
    };
    const { baseUrl, paths } = config?.compilerOptions ?? {};
    if (!paths) return undefined;
    const aliases = Object.entries(paths).flatMap(([key, values]) => {
      if (!Array.isArray(values)) return [];
      const targets = values.filter((value): value is string => typeof value === 'string');
      return targets.length > 0 ? [{ key, targets }] : [];
    });
    return { aliases, baseUrl };
  } catch {
    return undefined;
  }
}

/** 从当前文件向上查找最近的 tsconfig.json / jsconfig.json */
async function findNearestConfigFile(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
  let dir = dirname(uri);
  while (true) {
    // 同一层的两个候选并行探测（tsconfig 优先），层与层之间保持串行
    const results = await Promise.all(
      ['tsconfig.json', 'jsconfig.json'].map(async name => {
        const candidate = vscode.Uri.joinPath(dir, name);
        return (await isFile(candidate)) ? candidate : undefined;
      })
    );
    const hit = results.find(Boolean);
    if (hit) return hit;

    const parent = dirname(dir);
    if (parent.toString() === dir.toString()) break;
    dir = parent;
  }
  return undefined;
}

/**
 * 从当前文件向上查找「项目根」：最近的 tsconfig.json / jsconfig.json / package.json 所在目录。
 * 用于没有 workspace folder（单文件打开等）时，为 @/ 别名、/ 绝对路径、~/ 提供解析基准。
 */
export async function findProjectRootUri(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
  let dir = dirname(uri);
  while (true) {
    const results = await Promise.all(
      ['tsconfig.json', 'jsconfig.json', 'package.json'].map(async name => {
        const candidate = vscode.Uri.joinPath(dir, name);
        return (await isFile(candidate)) ? candidate : undefined;
      })
    );
    const hit = results.find(Boolean);
    if (hit) return dir;

    const parent = dirname(dir);
    if (parent.toString() === dir.toString()) break;
    dir = parent;
  }
  return undefined;
}

/** 取当前文件对应的别名上下文：向上找最近配置并解析，带 TTL 缓存（含"未找到"负缓存） */
export async function getAliasContext(documentUri: vscode.Uri): Promise<AliasContext | undefined> {
  const dirKey = dirname(documentUri).toString();
  if (aliasContextCache.has(dirKey)) return aliasContextCache.get(dirKey); // 负缓存也命中（值为 undefined）

  let context: AliasContext | undefined;
  const configUri = await findNearestConfigFile(documentUri);
  if (configUri) {
    const parsed = await readPathAliases(configUri);
    if (parsed) {
      context = { configUri, ...parsed };
      // 最长 key 优先，构建上下文时排一次（上下文本身按目录 TTL 缓存），
      // 避免每次补全请求在 resolveAliasCandidates 里重复排序
      if (context.aliases.length > 1) context.aliases.sort((a, b) => b.key.length - a.key.length);
    }
  }

  aliasContextCache.set(dirKey, context);
  return context;
}

/**
 * 把单个候选 target 与子路径拼成相对路径：
 * 通配符 target（'./src/*'）用子路径替换 *；无通配符 target（'src'）直接追加子路径。
 * 用函数式 replace 避免子路径里的 $ 被当作替换模式。
 */
function resolveAliasTarget(target: string, subPath: string): string {
  if (target.includes('*')) return target.replace('*', () => subPath);
  return subPath ? `${target}/${subPath}` : target;
}

/**
 * 别名前缀匹配 + 子路径拼接，返回按配置顺序排列的全部候选目录（不做存在性检查）。
 * 调用方按自身语义判断：路径补全浏览选目录、@import 解析选文件。
 *
 * @param rawPath 用户输入的完整别名路径（如 '@/components/Button'），用于匹配 key
 * @param subPathSource 用于派生子路径的原文：路径补全传「最后一个 / 之前的目录前缀」，
 *                      样式 @import 传完整导入路径（需要保留文件名）
 */
export async function resolveAliasCandidates(
  documentUri: vscode.Uri,
  rawPath: string,
  subPathSource: string
): Promise<vscode.Uri[] | undefined> {
  const context = await getAliasContext(documentUri);
  if (!context || context.aliases.length === 0) return undefined;

  // 别名已在 getAliasContext 构建时按最长 key 优先排好，这里直接查找不再重复排序。
  // 通配符 key（'@/*'）按前缀匹配；非通配符 key（'@'）按精确或子路径前缀匹配，
  // 让 "@": ["src"] 这类配置也能承接 '@/...' 的补全。
  const matched = context.aliases.find(({ key }) => {
    if (key.endsWith('/*')) return rawPath.startsWith(key.slice(0, -1));
    // 新增：如果别名显式以 / 结尾（如 "@components/"），使用精确前缀匹配
    if (key.endsWith('/')) return rawPath.startsWith(key);
    return rawPath === key || rawPath.startsWith(key + '/');
  });
  if (!matched) return undefined;

  const prefix = matched.key.endsWith('/*') ? matched.key.slice(0, -1) : matched.key;
  const subPath = subPathSource.startsWith(prefix) ? subPathSource.slice(prefix.length).replace(/^\/+/, '') : '';

  // paths 的 target 相对 baseUrl 解析（无 baseUrl 时相对 tsconfig 所在目录）
  const base = context.baseUrl
    ? vscode.Uri.joinPath(dirname(context.configUri), context.baseUrl)
    : dirname(context.configUri);
  return matched.targets.map(target => vscode.Uri.joinPath(base, resolveAliasTarget(target, subPath)));
}
