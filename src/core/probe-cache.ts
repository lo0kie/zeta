/**
 * 文件探测（stat）结果 TTL 缓存。
 *
 * 背景：resolveImportFileTargets（路径跳转/悬浮/文档链接）与 resolveImportUri（样式导入链展开）
 * 会对一条导入路径做 20+ 次并发 stat 探测，且每次请求全量重来。这里统一缓存「解析结果」，
 * 含空结果负缓存（路径不存在时避免反复探测），TTL 2s（与资源导航读盘缓存策略一致）。
 *
 * 失效：文件创建/删除/重命名时由调用方 clearProbeCache() 整体清空（缓存量小、TTL 短，整体清空
 * 成本极低且绝对正确，无需目录级精确失效）。
 */
import { TtlCache } from '@/core/ttl-cache';
import * as vscode from 'vscode';

const PROBE_CACHE_TTL_MS = 2000;

const probeCache = new TtlCache<readonly vscode.Uri[]>(PROBE_CACHE_TTL_MS);

/**
 * 解析结果缓存 key：文档 uri + 原始路径 + 扩展名配置指纹。
 * 扩展名配置（zeta.path.extensions）影响探测候选列表，必须纳入 key，
 * 否则「改配置后同路径复用旧探测结果」会出错。
 */
export function probeKey(documentUri: vscode.Uri, rawPath: string, configFingerprint = ''): string {
  return `${documentUri.toString()}::${rawPath}::${configFingerprint}`;
}

export function getCachedProbe(key: string): readonly vscode.Uri[] | undefined {
  return probeCache.get(key);
}

export function setCachedProbe(key: string, uris: readonly vscode.Uri[]): void {
  probeCache.set(key, uris);
}

/** 文件系统变化（create/delete/rename）时整体清空；测试 setup/teardown 也可调用防污染 */
export function clearProbeCache(): void {
  probeCache.clear();
}
