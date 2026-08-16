import * as vscode from 'vscode';

type CustomTransformStep = { pattern: string; replacement: string; flags?: string };

type ConfigTypeMap = {
  caseCustom: Record<string, CustomTransformStep[]>;
  explorer: boolean;
  filterFolders: string[];
  folders: string[];
  tag: string;
  terminal: boolean;
};

// 配置键名与默认值的唯一事实来源，package.json 中的贡献声明与此保持一致
const configDefinitions = {
  caseCustom: { key: 'zeta.case.custom', default: {} as Record<string, CustomTransformStep[]> },
  explorer: { key: 'zeta.show.explorer', default: true },
  filterFolders: { key: 'zeta.list.filterFolders', default: ['node_modules', '.vscode', '.git', '.svn'] },
  folders: { key: 'zeta.list.folders', default: [] as string[] },
  tag: { key: 'zeta.string.tag', default: 'div' },
  terminal: { key: 'zeta.show.terminal', default: true },
} satisfies { [K in keyof ConfigTypeMap]: { key: string; default: ConfigTypeMap[K] } };

export class Configuration {
  public static get<K extends keyof ConfigTypeMap>(key: K): ConfigTypeMap[K] {
    const { key: configKey, default: fallback } = configDefinitions[key];
    const value = vscode.workspace.getConfiguration().get<ConfigTypeMap[K]>(configKey);

    // 用户把配置改成错误类型时回落到默认值，避免脏值流入业务逻辑
    if (Array.isArray(fallback)) {
      return (Array.isArray(value) ? value : fallback) as ConfigTypeMap[K];
    }
    if (typeof fallback === 'object') {
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value) ? value : fallback
      ) as ConfigTypeMap[K];
    }
    return (typeof value === typeof fallback ? value : fallback) as ConfigTypeMap[K];
  }

  public static async set<K extends keyof ConfigTypeMap>(key: K, value: ConfigTypeMap[K]): Promise<void> {
    await vscode.workspace
      .getConfiguration()
      .update(configDefinitions[key].key, value, vscode.ConfigurationTarget.Global);
  }

  // 快捷静态访问器，自带强类型
  static get CASE_CUSTOM() {
    return this.get('caseCustom');
  }
  static get FILTER_FOLDERS() {
    return this.get('filterFolders');
  }
  static get FOLDERS() {
    return this.get('folders');
  }
  static get TAG() {
    return this.get('tag');
  }
  static get TERMINAL() {
    return this.get('terminal');
  }
}
