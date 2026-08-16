import { resolveUriArgument } from '@/core/fs';
import { removeConfiguredFolder } from '@/explorer/folders';

/** 从资源导航中移除根目录：同步更新 zeta.list.folders 配置，视图自动刷新 */
export default async function removeFolder(arg?: unknown): Promise<void> {
  const uri = resolveUriArgument(arg);
  if (!uri) return;

  await removeConfiguredFolder(uri);
}
