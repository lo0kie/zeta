// 离线测试用的 vscode 模块替身（CJS，被 esbuild external require，与测试进程共享类实例）。
// 配置与工作区根通过 globalThis 注入（见 helpers.mjs 的 setVscodeConfig / setWorkspaceRoot）。
const nodePath = require('node:path');

class Uri {
  constructor(fsPath) {
    this.fsPath = fsPath;
    this.path = fsPath.replace(/\\/g, '/');
    this.scheme = 'file';
  }
  static file(fsPath) {
    return new Uri(fsPath);
  }
  static joinPath(base, ...segs) {
    return new Uri(nodePath.join(base.fsPath, ...segs));
  }
  // 对应 vscode.Uri.with：返回新实例，原实例不变（当前只用到 scheme 替换，fsPath 保持）
  with(changes = {}) {
    const uri = new Uri(this.fsPath);
    if (changes.scheme !== undefined) uri.scheme = changes.scheme;
    if (changes.path !== undefined) uri.path = changes.path;
    return uri;
  }
  toString() {
    return 'file://' + this.path;
  }
}

class Location {
  constructor(uri, rangeOrPosition) {
    this.uri = uri;
    this.range = rangeOrPosition;
  }
}

class DocumentLink {
  constructor(range, target) {
    this.range = range;
    this.target = target;
  }
}

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
  translate(dl, dc) {
    return new Position(this.line + dl, this.character + dc);
  }
  compareTo(other) {
    if (this.line !== other.line) return this.line - other.line;
    return this.character - other.character;
  }
}

class SemanticTokensLegend {
  constructor(tokenTypes = [], tokenModifiers = []) {
    this.tokenTypes = tokenTypes;
    this.tokenModifiers = tokenModifiers;
  }
}

class SemanticTokensBuilder {
  constructor(legend) {
    this.legend = legend;
    this.tokens = [];
  }
  push(line, char, length, tokenType, tokenModifiers) {
    this.tokens.push({ line, char, length, tokenType, tokenModifiers });
  }
  build() {
    return { data: this.tokens };
  }
}

class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) {
      this.start = a;
      this.end = b;
    } else {
      this.start = new Position(a, b);
      this.end = new Position(c, d);
    }
  }
  get isEmpty() {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

// 与真实 VS Code 一致：Selection 是 Range 的子类（源码里 instanceof Range 的分发依赖这一点）
class Selection extends Range {
  constructor(anchor, active) {
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }
  get isSingleLine() {
    return this.anchor.line === this.active.line;
  }
}

class Color {
  constructor(red, green, blue, alpha) {
    this.red = red;
    this.green = green;
    this.blue = blue;
    this.alpha = alpha;
  }
}

class ColorInformation {
  constructor(range, color) {
    this.range = range;
    this.color = color;
  }
}

class ColorPresentation {
  constructor(label) {
    this.label = label;
  }
}

class CompletionItem {
  constructor(label, kind) {
    if (typeof label === 'object' && label !== null) {
      this.label = label.label;
      this.description = label.description;
    } else {
      this.label = label;
    }
    this.kind = kind;
  }
}

class CompletionList {
  constructor(items = [], isIncomplete = false) {
    this.items = items;
    this.isIncomplete = isIncomplete;
  }
}

class SnippetString {
  constructor(value) {
    this.value = value;
  }
}

class MarkdownString {
  constructor() {
    this.value = '';
  }
  appendMarkdown(text) {
    this.value += text;
    return this;
  }
  appendCodeblock(code, lang) {
    this.value += '\n```' + (lang || '') + '\n' + code + '\n```';
    return this;
  }
}

class Hover {
  constructor(contents, range) {
    this.contents = contents;
    this.range = range;
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
    this.description = undefined;
    this.contextValue = '';
  }
}

class EventEmitter {
  constructor() {
    this.event = () => ({ dispose() {} });
  }
  fire() {}
  dispose() {}
}

class WorkspaceEdit {
  constructor() {
    this.ops = [];
  }
  insert(uri, position, text) {
    this.ops.push({ type: 'insert', uri: uri.fsPath, position, text });
  }
  replace(uri, range, text) {
    this.ops.push({ type: 'replace', uri: uri.fsPath, range, text });
  }
}

module.exports = {
  Uri,
  Position,
  Range,
  Selection,
  Color,
  ColorInformation,
  ColorPresentation,
  CompletionItem,
  CompletionList,
  SnippetString,
  MarkdownString,
  Hover,
  TreeItem,
  EventEmitter,
  WorkspaceEdit,
  Location,
  DocumentLink,
  SemanticTokensLegend,
  SemanticTokensBuilder,
  CompletionItemKind: { File: 1, Folder: 2, Variable: 3, Function: 4, Color: 16 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  workspace: {
    fs: {
      stat: uri => {
        const st = require('node:fs').statSync(uri.fsPath);
        return { type: st.isDirectory() ? 2 : 1 };
      },
      readFile: async uri => require('node:fs').readFileSync(uri.fsPath),
      readDirectory: uri =>
        require('node:fs')
          .readdirSync(uri.fsPath, { withFileTypes: true })
          .map(e => [e.name, e.isDirectory() ? 2 : 1]),
    },
    getWorkspaceFolder: uri => {
      const wsRoot = globalThis.__zetaWsRoot;
      if (!wsRoot) return undefined;
      return uri.fsPath === wsRoot || uri.fsPath.startsWith(wsRoot + nodePath.sep)
        ? { uri: Uri.file(wsRoot) }
        : undefined;
    },
    getConfiguration: () => ({
      get: (key, fallback) => {
        const cfg = globalThis.__zetaCfg || {};
        if (key in cfg) return cfg[key];
        const short = key.startsWith('zeta.') ? key.slice(5) : key;
        return short in cfg ? cfg[short] : fallback;
      },
      update: async () => {},
    }),
    applyEdit: edit => {
      globalThis.__lastApply = edit.ops;
      return true;
    },
  },
  window: {
    showWarningMessage: async () => {},
    showErrorMessage: async () => {},
    showInformationMessage: async () => {},
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    showOpenDialog: async () => undefined,
    showWorkspaceFolderPick: async () => undefined,
    createStatusBarItem: () => ({ text: '', tooltip: '', command: '', show() {}, hide() {}, dispose() {} }),
    onDidOpenTerminal: () => ({ dispose() {} }),
    onDidCloseTerminal: () => ({ dispose() {} }),
    createTerminal: () => ({ show() {}, sendText() {}, dispose() {} }),
    terminals: [],
    createTreeView: () => ({ onDidChangeVisibility: () => ({ dispose() {} }), dispose() {} }),
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    registerTextEditorCommand: () => ({ dispose() {} }),
    executeCommand: async () => undefined,
  },
  languages: {
    registerCompletionItemProvider: () => ({ dispose() {} }),
    registerColorProvider: () => ({ dispose() {} }),
    registerHoverProvider: () => ({ dispose() {} }),
    registerDefinitionProvider: () => ({ dispose() {} }),
    registerDocumentLinkProvider: () => ({ dispose() {} }),
    registerDocumentSemanticTokensProvider: () => ({ dispose() {} }),
  },
  env: { openExternal: async () => true },
};
