export const JAVASCRIPT_PATH = /(?<quote>["'`]).+?(?<!\\)\k<quote>/;
export const LANGUAGES = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'];
export const DEFINED_EXPANDED_LANGS = ['vue', 'json'];

export interface ZetaConfig {
  alias: Record<string, string>;
  author: string;
  comment: boolean;
  description: boolean;
  explorer: boolean;
  exts: string[];
  fileSize: boolean;
  filterFolders: string[];
  folders: string[];
  memory: boolean;
  tag: string;
}

export const ConfigMapping: Record<keyof ZetaConfig, string> = {
  alias: 'zeta.list.alias',
  author: 'zeta.string.author',
  comment: 'zeta.show.comment',
  description: 'zeta.show.description',
  explorer: 'zeta.show.explorer',
  exts: 'zeta.list.exts',
  fileSize: 'zeta.show.fileSize',
  filterFolders: 'zeta.list.filterFolders',
  folders: 'zeta.list.folders',
  memory: 'zeta.show.memory',
  tag: 'zeta.string.tag',
};
