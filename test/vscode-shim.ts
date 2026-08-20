import * as fs from 'node:fs';
import * as nodePath from 'node:path';

// ─────────────────────────────────────────────────────────────
// vscode 模块测试替身（shim）。
// 定位：只实现被测代码实际用到的 API，「够用就好」，不追求与真实 vscode 完全一致。
// 通过 vitest alias（'vscode' → 本文件）与 src / 测试共用同一实例，instanceof 生效。
//
// 全局注入契约（由 test/helpers.ts 的 setConfig / makeWorkspace 写入，cleanup 清理）：
//   - globalThis.__zetaCfg    配置注入（setConfig），getConfiguration().get/update 读写它
//   - globalThis.__zetaWsRoot 工作区根（makeWorkspace），getWorkspaceFolder 用它判断归属
//   - globalThis.__lastApply  applyEdit 写入的编辑操作数组，测试读取它断言编辑行为
//
// 范围说明：workspace.fs 只实现 stat / readFile / readDirectory 三个方法，
// 与 helpers.ts 的 countFs 类型签名保持一致；若需计数其他 fs 方法，先补 shim 再扩类型。
// ─────────────────────────────────────────────────────────────

let _terminals: unknown[] = [];
let _extensions: unknown[] = [];
let _activeTextEditor: unknown = undefined;

export class Uri {
  public fsPath: string;
  public path: string;
  public scheme: string;

  constructor(fsPath: string) {
    this.fsPath = fsPath;
    this.path = fsPath.replace(/\\/g, '/');
    this.scheme = 'file';
  }

  static file(fsPath: string): Uri {
    return new Uri(fsPath);
  }

  static joinPath(base: Uri, ...segs: string[]): Uri {
    return new Uri(nodePath.join(base.fsPath, ...segs));
  }

  // 用于 createColorSwatchUri 的 data: URI（以及 file: 等）；解析 scheme 与 path 便于 toString
  static parse(value: string): Uri {
    const uri = new Uri(value);
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/.exec(value);
    if (m) {
      uri.scheme = m[1];
      uri.path = m[2];
      uri.fsPath = m[2];
    }
    return uri;
  }

  with(changes: { scheme?: string; path?: string } = {}): Uri {
    const uri = new Uri(this.fsPath);
    if (changes.scheme !== undefined) uri.scheme = changes.scheme;
    if (changes.path !== undefined) uri.path = changes.path;
    return uri;
  }

  toString(): string {
    // 尊重 with({ scheme }) 修改：scheme 不再是摆设（如 untitled 方案输出 untitled://...）
    return `${this.scheme}://${this.path}`;
  }
}

export class Location {
  constructor(
    public uri: Uri,
    public range: Range | Position
  ) {}
}

export class DocumentLink {
  constructor(
    public range: Range,
    public target?: Uri
  ) {}
}

export class Position {
  constructor(
    public line: number,
    public character: number
  ) {}

  translate(dl: number, dc: number): Position {
    return new Position(this.line + dl, this.character + dc);
  }

  compareTo(other: Position): number {
    if (this.line !== other.line) return this.line - other.line;
    return this.character - other.character;
  }
}

export class Range {
  public start: Position;
  public end: Position;

  constructor(start: Position, end: Position);
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    let startPos: Position;
    let endPos: Position;
    if (a instanceof Position) {
      startPos = a;
      endPos = b as Position;
    } else {
      startPos = new Position(a, b as number);
      endPos = new Position(c!, d!);
    }
    // 对齐真实 VS Code：start <= end（anchor/active 中较小者在前）
    this.start = startPos.compareTo(endPos) <= 0 ? startPos : endPos;
    this.end = startPos.compareTo(endPos) <= 0 ? endPos : startPos;
  }

  get isEmpty(): boolean {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

export class Selection extends Range {
  public anchor: Position;
  public active: Position;

  constructor(anchor: Position, active: Position);
  constructor(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number);
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    super(a as any, b as any, c as any, d as any);
    if (a instanceof Position) {
      this.anchor = a;
      this.active = b as Position;
    } else {
      this.anchor = new Position(a, b as number);
      this.active = new Position(c!, d!);
    }
  }

  get isReversed(): boolean {
    return this.anchor.compareTo(this.active) > 0;
  }

  get isSingleLine(): boolean {
    return this.anchor.line === this.active.line;
  }
}

export class Color {
  constructor(
    public red: number,
    public green: number,
    public blue: number,
    public alpha: number
  ) {}
}

export class ColorInformation {
  constructor(
    public range: Range,
    public color: Color
  ) {}
}

export class ColorPresentation {
  public additionalTextEdits?: TextEdit[];
  public textEdit?: TextEdit;
  constructor(public label: string) {}
}

export class TextEdit {
  constructor(
    public range: Range,
    public newText: string
  ) {}
  static replace(range: Range, newText: string): TextEdit {
    return new TextEdit(range, newText);
  }
}

export class CompletionItem {
  public label: string;
  public description?: string;
  public kind?: number;
  public sortText?: string;
  public range?: Range;
  public insertText?: string | SnippetString;
  public detail?: string;
  public documentation?: string | MarkdownString;
  public command?: unknown;

  // 兼容 vscode 的两种 label 形态：纯字符串，或 { label, description } 对象
  // （对应真实 API 的 CompletionItemLabel，路径补全等会用对象形态携带 description）；
  // 只挑 label/description 两个字段，其余 CompletionItemLabel 字段（detail 等）被测代码未用到
  constructor(label: string | { label: string; description?: string }, kind?: number) {
    if (typeof label === 'object' && label !== null) {
      this.label = label.label;
      this.description = label.description;
    } else {
      this.label = label;
    }
    this.kind = kind;
  }
}

export class CompletionList {
  constructor(
    public items: CompletionItem[] = [],
    public isIncomplete = false
  ) {}
}

export class SnippetString {
  constructor(public value: string = '') {}
}

export class MarkdownString {
  public value: string = '';
  public isTrusted: boolean = false;
  public supportHtml: boolean = false;

  constructor(value: string = '') {
    this.value = value;
  }

  appendMarkdown(text: string): MarkdownString {
    this.value += text;
    return this;
  }

  appendCodeblock(code: string, lang: string = ''): MarkdownString {
    this.value += '\n```' + lang + '\n' + code + '\n```';
    return this;
  }
}

export class Hover {
  constructor(
    public contents: MarkdownString | string,
    public range?: Range
  ) {}
}

export class TreeItem {
  public description?: string;
  public contextValue: string = '';
  public tooltip?: string;
  public command?: unknown;
  public resourceUri?: Uri;

  constructor(
    public label: string,
    public collapsibleState?: number
  ) {}
}

export class EventEmitter<T = unknown> {
  public event: (listener: (e: T) => unknown) => { dispose: () => void };

  constructor() {
    this.event = () => ({ dispose() {} });
  }

  fire(_data?: T): void {}
  dispose(): void {}
}

export class WorkspaceEdit {
  public ops: Array<{
    type: 'insert' | 'replace';
    uri: string;
    position?: Position;
    range?: Range;
    text: string;
  }> = [];

  insert(uri: Uri, position: Position, text: string): void {
    this.ops.push({ type: 'insert', uri: uri.fsPath, position, text });
  }

  replace(uri: Uri, range: Range, text: string): void {
    this.ops.push({ type: 'replace', uri: uri.fsPath, range, text });
  }
}

export const CompletionItemKind = {
  File: 1,
  Folder: 2,
  Variable: 3,
  Function: 4,
  Color: 16,
} as const;

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
} as const;

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
} as const;

export const workspace = {
  fs: {
    // 仅实现被测代码用到的三个方法（见文件头「范围说明」），返回值对齐 FileType：目录 2 / 文件 1
    stat: (uri: Uri) => {
      const st = fs.statSync(uri.fsPath);
      return { type: st.isDirectory() ? 2 : 1 };
    },
    readFile: async (uri: Uri) => fs.readFileSync(uri.fsPath),
    readDirectory: (uri: Uri): [string, number][] =>
      fs.readdirSync(uri.fsPath, { withFileTypes: true }).map(e => [e.name, e.isDirectory() ? 2 : 1]),
    // 写操作（资源导航的新建/重命名/删除等）：
    writeFile: async (uri: Uri, content: Uint8Array) => {
      fs.writeFileSync(uri.fsPath, content);
    },
    createDirectory: async (uri: Uri) => {
      fs.mkdirSync(uri.fsPath, { recursive: true });
    },
    rename: async (oldUri: Uri, newUri: Uri) => {
      fs.renameSync(oldUri.fsPath, newUri.fsPath);
    },
    delete: async (uri: Uri, options?: { recursive?: boolean }) => {
      fs.rmSync(uri.fsPath, { recursive: options?.recursive ?? false, force: true });
    },
  },
  getWorkspaceFolder: (uri: Uri) => {
    const wsRoot = (globalThis as any).__zetaWsRoot;
    if (!wsRoot) return undefined;
    return uri.fsPath === wsRoot || uri.fsPath.startsWith(wsRoot + nodePath.sep)
      ? { uri: Uri.file(wsRoot) }
      : undefined;
  },
  getConfiguration: () => ({
    // 双重查找：先按完整键（'zeta.xxx'），查不到剥掉 'zeta.' 前缀再试——
    // 兼容 setConfig({ 'zeta.list.folders': ... }) 与 setConfig({ list.folders: ... }) 两种注入写法
    get: (key: string, fallback?: unknown) => {
      const cfg = (globalThis as any).__zetaCfg || {};
      if (key in cfg) return cfg[key];
      const short = key.startsWith('zeta.') ? key.slice(5) : key;
      return short in cfg ? cfg[short] : fallback;
    },
    // 写入注入配置（等效真实 vscode 的 update 持久化），供 appendConfiguredFolders 等回读
    update: async (key: string, value: unknown) => {
      const cfg = (globalThis as any).__zetaCfg || ((globalThis as any).__zetaCfg = {});
      cfg[key] = value;
    },
  }),
  applyEdit: (edit: WorkspaceEdit): boolean => {
    (globalThis as any).__lastApply = edit.ops;
    return true;
  },
  get workspaceFolders(): { uri: Uri; name: string; index: number }[] | undefined {
    const wsRoot = (globalThis as any).__zetaWsRoot;
    return wsRoot ? [{ uri: Uri.file(wsRoot), name: 'root', index: 0 }] : undefined;
  },
  onDidChangeConfiguration: () => ({ dispose() {} }),
  onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
  onDidCloseTextDocument: () => ({ dispose() {} }),
  onDidSaveTextDocument: () => ({ dispose() {} }),
  onDidOpenTextDocument: () => ({ dispose() {} }),
  onDidCreateFiles: () => ({ dispose() {} }),
  onDidDeleteFiles: () => ({ dispose() {} }),
  onDidRenameFiles: () => ({ dispose() {} }),
};

export const window = {
  showWarningMessage: async (..._args: unknown[]): Promise<unknown> => undefined,
  showErrorMessage: async (..._args: unknown[]): Promise<unknown> => undefined,
  showInformationMessage: async (..._args: unknown[]): Promise<unknown> => undefined,
  showQuickPick: async (..._args: unknown[]): Promise<unknown> => undefined,
  showInputBox: async (..._args: unknown[]): Promise<unknown> => undefined,
  showOpenDialog: async (..._args: unknown[]): Promise<unknown> => undefined,
  showWorkspaceFolderPick: async (..._args: unknown[]): Promise<unknown> => undefined,
  showTextDocument: async (..._args: unknown[]): Promise<unknown> => undefined,
  createStatusBarItem: (..._args: unknown[]) => ({
    text: '',
    tooltip: '',
    command: '',
    show() {},
    hide() {},
    dispose() {},
  }),
  onDidOpenTerminal: (..._args: unknown[]) => ({ dispose() {} }),
  onDidCloseTerminal: (..._args: unknown[]) => ({ dispose() {} }),
  createTerminal: (..._args: unknown[]) => ({
    show() {},
    sendText(..._cmd: unknown[]) {},
    dispose() {},
  }),
  createTreeView: (..._args: unknown[]) => ({
    onDidChangeVisibility: () => ({ dispose() {} }),
    dispose() {},
  }),
  // terminals / extensions.all / activeTextEditor 用可变后备 + getter 暴露：vitest 里可直接
  // `vi.spyOn(vscode.window, 'terminals', 'get').mockReturnValue([...])` 打桩只读属性
  get terminals() {
    return _terminals;
  },
  get activeTextEditor() {
    return _activeTextEditor;
  },
  // 选区/激活编辑器变化监听：shim 仅返回可 dispose 的空订阅，测试用 spyOn 捕获回调再手动触发
  onDidChangeTextEditorSelection: () => ({ dispose() {} }),
  onDidChangeActiveTextEditor: () => ({ dispose() {} }),
};

export const commands = {
  registerCommand: (..._args: unknown[]) => ({ dispose() {} }),
  registerTextEditorCommand: (..._args: unknown[]) => ({ dispose() {} }),
  executeCommand: async (..._args: unknown[]): Promise<unknown> => undefined,
};

export const extensions = {
  // 同 window.terminals：可变后备，供 vi.spyOn(vscode.extensions, 'all', 'get') 打桩
  get all() {
    return _extensions;
  },
};

export const languages = {
  registerCompletionItemProvider: (..._args: unknown[]) => ({ dispose() {} }),
  registerColorProvider: (..._args: unknown[]) => ({ dispose() {} }),
  registerHoverProvider: (..._args: unknown[]) => ({ dispose() {} }),
  registerDefinitionProvider: (..._args: unknown[]) => ({ dispose() {} }),
  registerDocumentLinkProvider: (..._args: unknown[]) => ({ dispose() {} }),
  registerDocumentSemanticTokensProvider: (..._args: unknown[]) => ({ dispose() {} }),
};

export const env = {
  openExternal: async (..._args: unknown[]): Promise<boolean> => true,
  clipboard: {
    // 记录最后一次写入，测试断言用
    _lastWrite: undefined as string | undefined,
    writeText: async (text: string) => {
      (globalThis as any).__zetaClipboard = text;
    },
  },
};
