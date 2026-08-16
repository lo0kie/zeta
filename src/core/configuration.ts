import * as vscode from 'vscode';

type CustomTransformStep = { pattern: string; replacement: string; flags?: string };

type ConfigTypeMap = {
  caseCustom: Record<string, CustomTransformStep[]>;
  caseCycleOrder: string[];
  explorer: boolean;
  filterFolders: string[];
  folders: string[];
  runScriptAskArguments: boolean;
  tag: string;
  terminal: boolean;
};

// 配置键名与默认值的唯一事实来源，package.json 中的贡献声明与此保持一致
const configDefinitions = {
  caseCustom: { key: 'zeta.case.custom', default: {} as Record<string, CustomTransformStep[]> },
  caseCycleOrder: {
    key: 'zeta.case.cycleOrder',
    default: ['Camel Case', 'Kebab Case', 'Pascal Case', 'Snake Case', 'Constant Case'],
  },
  explorer: { key: 'zeta.show.explorer', default: true },
  filterFolders: { key: 'zeta.list.filterFolders', default: ['node_modules', '.vscode', '.git', '.svn'] },
  folders: { key: 'zeta.list.folders', default: [] as string[] },
  runScriptAskArguments: { key: 'zeta.runScript.askArguments', default: true },
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
    // 工作区内写入 Workspace 配置（按项目隔离，如 zeta.list.folders 不应跨窗口共享）；
    // 无工作区时回落到 Global，避免 update 因缺少 Workspace target 抛错
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration().update(configDefinitions[key].key, value, target);
  }

  // 快捷静态访问器，自带强类型
  static get CASE_CUSTOM() {
    return this.get('caseCustom');
  }
  static get CASE_CYCLE_ORDER() {
    return this.get('caseCycleOrder');
  }
  static get FILTER_FOLDERS() {
    return this.get('filterFolders');
  }
  static get FOLDERS() {
    return this.get('folders');
  }
  static get RUN_SCRIPT_ASK_ARGUMENTS() {
    return this.get('runScriptAskArguments');
  }
  static get TAG() {
    return this.get('tag');
  }
  static get TERMINAL() {
    return this.get('terminal');
  }
}
