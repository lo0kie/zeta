import * as vscode from 'vscode';
import { ConfigMapping, ZetaConfig } from './constants';

export class Configuration {
  private static getWorkspaceConfig() {
    return vscode.workspace.getConfiguration();
  }

  public static get<K extends keyof ZetaConfig>(key: K): ZetaConfig[K] {
    const configPath = ConfigMapping[key];
    // 强制断言返回值，因为 package.json 中已有 default 保底
    return this.getWorkspaceConfig().get<ZetaConfig[K]>(configPath)!;
  }

  public static async set<K extends keyof ZetaConfig>(key: K, value: ZetaConfig[K]): Promise<void> {
    const configPath = ConfigMapping[key];
    await this.getWorkspaceConfig().update(configPath, value, vscode.ConfigurationTarget.Global);
  }

  // 快捷静态访问器，保持以前的调用习惯，但自带强类型
  static get ALIAS() {
    return this.get('alias');
  }
  static get AUTHOR() {
    return this.get('author');
  }
  static get COMMENT() {
    return this.get('comment');
  }
  static get DESCRIPTION() {
    return this.get('description');
  }
  static get EXPLORER() {
    return this.get('explorer');
  }
  static get EXTS() {
    return this.get('exts');
  }
  static get FILE_SIZE() {
    return this.get('fileSize');
  }
  static get FILTER_FOLDERS() {
    return this.get('filterFolders');
  }
  static get FOLDERS() {
    return this.get('folders');
  }
  static get MEMORY() {
    return this.get('memory');
  }
  static get TAG() {
    return this.get('tag');
  }
}
