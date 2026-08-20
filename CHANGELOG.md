# Changelog

本文件自 1.5.0 起维护。1.5.1 起的修复随版本累积记录；1.5.0 的修复见下方。更早版本的功能与修复见 README 与 git 历史。

## [1.8.1] - 2026-08-20

### 新增

- **`Alt+Shift+Z` 快捷键**：绑定「选中当前块」命令（与 `Alt+Shift+S` 选中字符串、`Alt+Shift+W` 包裹标签同族）。
- **状态栏当前文件大小**（`src/statusbar/file-size.ts`）：右侧显示活动编辑器文件的磁盘大小，跟随活动编辑器切换与保存刷新；未保存（`untitled`）或不可读文件自动隐藏，无点击与 hover 交互。
- **状态栏脚本运行按钮**（`src/statusbar/run-package-script.ts`）：左侧 npm 风格图标，点击执行 `zeta.folder.runPackageScript` 查找 `package.json` 脚本运行；受 `zeta.show.packageScript` 控制，无工作区时自动隐藏。

### 修复

- **import 链接缓存内存泄漏**（`StyleImportLinkProvider._linksCache`）：从裸 `Map` 换成 `TtlCache`（容量上限 + 惰性清理），并补上文档关闭时遗漏的 `clearLinkCache(doc.uri)` 清理——此前长会话中反复打开/关闭样式或 vue 文件会导致该缓存无界增长。
- **import 解析同层重复探测**：多个 import 指向同一目标时复用同一个解析 `Promise`，避免并发请求在 `probe-cache` 写入前全部穿透到 `stat`，减少多文件共享基础样式文件的重复 I/O。

### 变更

- **颜色写回固定顺序**：点色块调色时 `provideColorPresentations` 固定返回全部 8 种格式、不做任何基于原文的重排——既不「匹配原文排第一」（原文是 oklch 时 oklch 永远默认），也不「确认后自动前进」（该方案会与 VS Code 确认机制冲突，导致格式循环变化、颜色不变而闪烁）。格式由用户在下拉中手动选择，选什么写回什么。
- **vue `<style>` 变量引用色块**：`var(--x)` 引用纯色变量时，色块显示在**变量名**上（`var(` 之后），写回时用 `ColorPresentation.textEdit` 整体替换 `var(--x)` 为真实色值（避免留下 `var(#ff9500)` 非法 CSS）。可正常调色。
- **oklch/oklab 重复色块修复**：`LAB`/`LCH` 正则加 `(?<!ok)` 负向前瞻，避免在 `oklab(`/`oklch(` 内部误匹配子串 `lab(`/`lch(` 产生两个色块。
- **import hover 精简**：去掉冗余的纯文本「跳转目标: 路径」行，只保留可点击的「打开」链接。
- **`jsonc-parser` 替换手写 `stripJsonc`**：tsconfig/jsconfig 的 JSONC 容错解析改用微软官方 `jsonc-parser`，不再维护手写注释/尾逗号剥离正则；并修正「errors 非空不拒绝」——合法配置的尾随逗号/注释会产生 errors 但 value 已正确解析。
- **culori 按需引入（`culori/fn`）**：从默认入口改为 `culori/fn` 手动 `useMode` 注册实际用到的 7 个色彩空间，dist 体积 120.67 KB → 98.56 KB。
- **运行脚本命令/配置重命名（破坏性）**：`runScript` 统一改为更准确的 `runPackageScript`——命令 `zeta.folder.runScript` → `zeta.folder.runPackageScript`；配置 `zeta.runScript.askArguments` → `zeta.packageScript.askArguments`、`zeta.show.runScript` → `zeta.show.packageScript`。已有快捷键绑定与设置需相应更新。

### 重构

- 消除重复实现：抽取 `escapeSnippetText`（`edits.ts`）、`findTokenAt`（`quote.ts`）、`inHtmlComment` / `nonTemplateBlocks`（新增 `utils/vue-blocks.ts`）、`rgbToHex`（`color.ts`）、`maskCommentsAndStrings`（`text.ts`），替换 wrap-with / tags-wrap / cycle-quotes / template-to-concat / style-completion / style-color / style-definition / explorer-actions 中各自重复的代码。

## [1.7.0] - 2026-08-20

### 新增

- **资源导航文件操作**（`src/explorer/actions.ts`）：新建文件 / 新建文件夹 / 重命名 / 删除 / 复制绝对路径 / 复制相对路径，均基于 `workspace.fs`（兼容 remote / 虚拟文件系统），支持多级子目录自动创建父目录、名称合法性校验、删除前模态确认。侧边栏行内按钮与右键菜单均可触发。
- **模板字符串转拼接**（`zeta.editor.templateToConcat`）：把含 `${...}` 表达式的模板字符串反向拆成字符串拼接（`` `hello ${name}` `` → `'hello ' + name`），无表达式的纯文本模板保持原样，多光标各自处理、同模板去重。
- **裸模块跳转**：`import react from 'react'`、`pkg/subpath`、`@scope/pkg` 等裸模块说明符会解析 `node_modules` 中 `package.json` 的 `exports` / `main` / `module` 入口作为 F12 / Ctrl+点击跳转候选（支持 `pkg`、`pkg/subpath`、`@scope/pkg`、`@scope/pkg/subpath` 与 workspace / project 两级 `node_modules` 探测）。
- **SCSS 命名空间补全**：`@use 'x' as c` 后，该文件 SCSS 变量仅在 `c.$var` 下提示，不再当全局裸变量干扰补全。
- **变量一层解引用**：悬浮样式变量时，若其值引用了其他变量（`var(--x)` / `@y` / `$y`），再展开一层实际值（如 `--brand: var(--primary)` 追加 `--primary = #ff9500`）。
- **`zeta.path.baseDir` 配置**：`@/` 别名与 `@/sub/path` 解析映射的基准目录，默认 `src`，可按项目改为 `lib`、`app` 等。

### 变更

- **颜色写回保持原格式**：点色块调色时，`provideColorPresentations` 识别原文格式（hex / rgb / hsl / hwb / lab / lch / oklab / oklch）并排到列表第一，避免「调个色相格式却被强制转成 hex」。
- **vue `<style>` 变量引用色块**：`var(--x)` 引用纯色变量时在整个引用上显示色块，拾色器显示真实色值，可与普通色值一样调色并写回真实色值（用选中的格式整体替换 `var(--x)` 引用）。
- **Vue 标签插入误触修复**：`zeta.editor.wrapTags` 在 vue 文档中若任一选区落在 `<script>` / `<style>` 块内则整体不触发（此前会在 TS 代码上包一层 HTML 标签破坏语法），仅在 `<template>` 区生效。
- **JSX Fragment 支持**：标签扫描识别 `<>` / `</>` 空名 Fragment，正确配对（此前 `</>` 被误判为 selfClosing 而永不配对）。
- **灰度色 NaN 修复**：纯灰/黑白等无饱和度的颜色，写回 `lch` / `oklch` / `hwb` 时色相归 0，不再产出 `NaN` 非法 CSS。
- **符号链接位掩码处理**：`FileType` 是位掩码枚举（`SymbolicLink=64`），符号链接目录/文件（type 65/66）按位判断归类，不再被误判为非常规类型而静默过滤。

### 修复

- 文档关闭即清理其选区循环状态（`cycle-case.ts` 的 `clearCycleState`），避免长期会话中 key 无界积累。

### 重构

- 颜色扫描收敛：`scanPlainText` 的 hex / rgb / hsl 三段重复 while 循环与 `scanColor4` 合并为单个 `scanPattern`（模式 + 捕获组→颜色 的解析），新增格式只需加一行；hex 生成提取为共享 `toHexString` 消除变量分支与主流程重复。

### 测试（开发基础设施，无运行时变更、不涉及版本号）

- 新增性能基准：`parseStyleFile`（补全/悬浮/跳转公共底层）1MB 文本单遍扫描 < 300ms，防复杂度回潮；`pnpm test:perf` 增至 5 项。
- 新增 `pnpm check` 脚本，串联 `typecheck` + `test` + `test:perf`，一条命令完成类型检查与单元/性能测试。

## [1.6.0] - 2026-08-19

### 新增

- **选中当前块**（`zeta.editor.selectBlock`）：光标位于某括号块内时，选中该块内容（不含括号本身）。按「最近括号」策略在 `()` / `[]` / `{}` 中取包含光标的最内层一对；支持混合嵌套、多光标去重；字符串 / 正则 / 注释内的括号不参与配对。Vue 动态属性（`:class="[...]"` 等）的值是 JS 表达式，其内部的 `[]` / `{}` / `()` 可正常选中，仅属性值里的字符串字面量按字符串处理。

### 变更

- 颜色系统接入 [culori](https://culorijs.org/)：颜色补全 / 悬浮 / 转换支持 CSS Color 4 全格式（`hwb` / `lab` / `lch` / `oklab` / `oklch` / `color()` / `rgb(...)` 等），不再局限于 hex/rgb/hsl。类型改用官方 `@types/culori`（4.x，与 culori v4 匹配），移除手写 `declare module` 声明。
- 样式悬浮与补全的展示统一（`src/providers/style-markdown.ts` 共享渲染）：变量与 mixin 以代码块展示「定义的样子」（`scope name: value;`），代码块语言 id 跟随来源文件（less/scss/css）；多个命名空间（`:root` / `.dark` 等）全部展示。纯色变量在代码块下方追加色块预览行（`![](...)` + 色值），色块之间真正换行；阴影/渐变等含颜色片段但整体非纯色的复杂值不误渲染色块。
- `.gitignore` 精简为精准匹配当前工作文件的规则，移除无关脚手架模板与重复项。

### 测试（开发基础设施，无运行时变更、不涉及版本号）

- 测试文件全量纳入 `tsc --noEmit` 类型检查并清零（此前 122 处错误）：`helpers.ts` 新增 `hoverText` / `noopToken` / `noopEdit` 助手；shim 的 `getConfiguration().update` 改为写入注入配置（此前为 noop，`appendConfiguredFolders` 等回读类用例无法通过）；16+ 个测试文件的 mock 类型与断言规范化（无 `any`、无对 vscode API 直接赋值）
- Vitest 并发执行：`maxWorkers` 由 1 提升至 8（32 核实测，全量 25.6s → 9.1s；16 会拖垮性能基准，故取 8）
- 测试套件精简：经多轮审查由 259 项收敛至 222 项日常 + 4 项性能——删除跨文件逐字重复（cycleQuotes 等）、碎片化重复用例与未调用死代码（`makeChecker` / `linkInfo`），合并同构用例（splitWords、变量悬浮、resolveImportUri、appendConfiguredFolders 去重等）
- 断言质量：恒真弱断言（`Array.isArray(x) || x`）改为明确断言；`activate` 订阅数由 `>= 8` 改为精确计数 `17 + 21 + 1`；命令注册数 `21` 改为以 `expectedCommands` 为单一数据源；`normSep` 重复实现改为复用 helpers 导入；`||` 兼容两种结果的模糊断言改为按索引精确断言
- 性能基准分离：`performance.test.ts` 从日常全量排除（挂钟断言在 CI / 共享 runner 上有抖动风险），新增 `pnpm test:perf` 独立运行（`vitest.perf.config.mts`，继承主配置）
- 新增补盲测试：`registerTextEditorCommand` 异常捕获、`Editor.apply()` 失败提示、`activate` 的 `setContext('zeta.htmlId', [...])` 参数断言、QuickPick ESC 取消不执行命令

## [1.5.2] - 2026-08-18

### 新增

路径 / 导入跳转（`src/providers/path-definition.ts`）：

- 定义 provider 覆盖 js / ts / jsx / tsx / vue / html / css / less / scss / sass / stylus / json 全部文件类型，解析相对 `./`、父级 `../`、省略 `./` 的子路径、`@` 别名（tsconfig paths）、`~/`、绝对路径
- 同名不同后缀的多个文件全部返回（VS Code F12 在多个结果间切换），目录导入回退 index 文件
- 无工作区（单文件打开）时，按最近的 tsconfig / jsconfig / package.json 所在目录兜底解析 `@/`、`/`、`~/`
- 返回 `LocationLink` 并带 `originSelectionRange`：Ctrl+悬停的下划线覆盖整个导入字符串，不再被 `/ @ .` 截断成单个单词

样式导入链接（`src/providers/style-import-link.ts`）：

- less / css / scss / sass / stylus 中 `@import` / `@use` / `@forward` / `@require` 与引号形式 `url(...)` 生成可点击的 DocumentLink，指向解析出的真实文件（绕开内置 css-language-features 返回的"无后缀缺失路径"坏定义）

导入悬浮（`src/providers/import-hover.ts`）：

- 任意受支持语言里悬浮路径字符串，追加可点击的「打开 <解析文件>」链接（`zeta.openResolvedImport`）与纯文本跳转目标；外部 URL 与裸包名不触发

诊断命令 `zeta.editor.debugResolveImport`：

- 展示光标处导入字符串的解析结果（工作区、命中的文件列表），命中时提供「打开第一个」按钮

用户可配置化：

- 新增 `zeta.path.extensions`（路径跳转/补全尝试的文件后缀顺序）、`zeta.path.maxCompletionEntries`（补全候选上限）、`zeta.path.showHiddenFiles`（是否补全隐藏文件）、`zeta.style.maxImportDepth`（样式 @import 递归展开深度上限）四个配置项

### 性能与健壮性

- 终端（`src/commands/terminal.ts`）：`disposeSame` 增加实例 Map 追踪——用户在终端内重命名后仍能按创建名精确销毁，不再依赖 `name` 文本比对
- 路径跳转（`src/providers/path-definition.ts`）：后缀探测改 `Promise.all` 并发，结果按探测顺序收集（保序），降低 F12 磁盘 I/O 延迟
- 目录拖拽（`src/explorer/provider.ts`）：`isDirectory` 校验并发化，消除拖拽大量项时的串行 stat 卡顿
- 路径补全（`src/providers/path-completion.ts`）：缓存全量目录列表 + 按输入前缀内存过滤 + `CompletionList.isIncomplete`，大目录不再因截断丢失有效候选
- 偏移换算（`src/utils/edits.ts`）：`positionAt` 用原生 `indexOf` 跳跃数换行，替代逐字符遍历
- 拖拽路径解析（`src/core/fs.ts`）：`decodeURIComponent` 失败时降级把原字符串当路径使用，不再静默丢弃（部分文件管理器编码不规范）
- 样式缓存失效（`src/providers/style-completion.ts`）：`clearStyleFileCache` 由全量 `docParseCache.clear()` 改为按「被导入文件 → 导入方」反向索引精准失效，保存任意样式文件只清受影响文档（含传递依赖链，沿导入链 BFS 逐级向上），大项目打开很多样式文件时不再每次保存全量重算

### 修复

- 裸模块说明符（`import react from 'react'`）不再被当作相对路径解析，避免与同名本地文件产生错误跳转
- 带已知扩展名的导入（`./foo.tsx`，实际文件为 `./foo.ts`）不再直接放弃，先精确匹配再回退同基名其他扩展名（NodeNext 风格 `.js` → `.ts`）
- 含点的文件名（`my.component`）不再被误拆为扩展名

### 维护与一致性

- 样式能力注册的语言列表收敛为单一来源 `src/providers/style-languages.ts`：补全 / 链接覆盖全部样式语言 + vue；符号解析系（hover / definition / semantic）只注册 CSS 系语法（stylus 的赋值与缩进语法未适配，硬注册会产生错误跳转与悬浮），子集差异原因在文件头注释显式说明
- `COLOR_VALUE_PATTERN` / `createColorSwatchUri` 下沉至 `src/utils/color.ts`（补全与悬浮共用，消除逐字重复，避免后续修改遗漏一处）
- 状态栏终端切换（`src/statusbar/terminal-toggle.ts`）：移除 `?.()` 可选链防御——`engines.vscode ^1.85.0` 已保证 `onDidOpenTerminal` / `onDidCloseTerminal` / `onDidChangeConfiguration` 存在，防御属于死代码
- 引号扫描（`src/utils/quote.ts`）：文件头补充「已知限制」注释（TSX 泛型 `<T>`、复杂三元表达式里的 `/` 可能误判为正则；误判仅影响后续字符串 token 提取，不改变文本内容）

### 测试

- 测试套件由 150 增至 241 项全部通过；新增 path-definition（23 例，覆盖解析分支/守卫/探测/无工作区兜底）、style-import-link（8 例）、import-hover（5 例）、color/case/quote/edits/fs/tag 等纯函数边界用例，以及三级依赖链缓存失效用例（main → a → b → c，修改最底层文件后全部引用方缓存须失效）
- 测试脚手架（`test/helpers.mjs`）：移除从未使用的 `mockInsertSnippet` 死代码；顶层持有 shim 引用，消除 `insertSnippet` 兜底分支构造 `vscode.Range` 时的裸引用隐患

## [1.5.1] - 2026-08-18

全量代码审查（覆盖 `src/` 全部 35 个 TS 文件与构建脚本）中复现并修复的缺陷，含边界场景回归。测试套件由 136 增至 150 项全部通过。

### 修复

标签解析 (`src/utils/tag.ts`)：

- `<div/>`（无空格自闭合）被误判为非自闭合，污染 `unwrapTags` 配对栈导致后续解包错位 — 修正自闭合判定为 `text[j] === '/'`
- 新增 HTML 注释跳过与 `script`/`style` 块感知，避免块内内容被当作标签配对

插入标签命令 (`src/commands/tags-wrap.ts`)：

- 配置标签名未做 Snippet 转义（如 `div$` 生成 `${1:div$}` 破坏 Tabstop 占位符）— 对标签名与属性统一 `escapeSnippetText`
- 空白配置回退为 `div`，并修复 `indexOf(-1)` 越界导致的尾随空格残留

引号 / 字符串扫描 (`src/utils/quote.ts`)：

- `)` / `]` 后的 `/` 被误判为正则开始（如 `(a) / 2`），吞掉后续字符串 token 使 `cycleQuotes`、颜色装饰失效 — 重写 `looksLikeRegexStart` 的除法判定（回溯关键字）
- 新增 `getNextQuote` / `getAttrNameBeforeEqual` / `isVueDynamicAttr` / `transformAttrQuotes`、`VUE_ATTR` 扫描模式，以及 `\r\n` 与 `$` 的转义处理

路径补全 (`src/providers/path-completion.ts`)：

- 绝对路径 `/src` 无尾斜杠时补全根目录错误 — 回退为 `searchDir` 语义，`/src`、`/src/`、`/src/ap` 三态均补全体目录
- 纯相对路径分支误触发裸说明符补全（如 `from 'lodash'`）— 增加 `searchDir && !rawPath.startsWith('@')` 守卫

包裹命令 (`src/commands/wrap-with.ts`)：

- `indentBody` 在 Windows CRLF 下丢失行尾 — 按文档实际行尾（`\r\n` / `\n`）拼接
- `expandToFullLines` 选中末尾空行多算一行 — 修正 `range.end` 行号逻辑

路径别名 (`src/core/path-alias.ts`)：

- `stripJsonc` 第二遍正则误删字符串内的 `,}` — 捕获组仅删除无字符串包裹的尾随分隔符

样式补全 / 定义 (`src/providers/style-completion.ts`、`src/providers/style-definition.ts`)：

- `splitTopLevelParams` 被字符串内的 `;` 干扰（`$a: "x;y", $b: 2` 误合并为单参数）— 新增 `findTopLevelSeparator`，分隔符只判定顶层（忽略字符串 / 括号 / 花括号）
- `style-definition` 跨行正则（`\s*` / `[^{};]*`）误报 — 改用 `[ \t]*` / `[^{};\n]*` 并加 `g` 标志；`@mixin` 关键字补全

文件系统 (`src/core/fs.ts`)：

- `findRootUri` 在 Windows 下大小写敏感比较失败 — 新增 `isSameUri`（win32 下 `fsPath.toLowerCase()` 比较）

运行脚本 (`src/commands/run-package-script.ts`)：

- `detectPackageManager` 改用 `isSameUri` 比较（Windows 大小写不敏感）
- 脚本名含空格时加引号包裹、剥离 BOM（前序修复）

循环大小写 (`src/commands/cycle-case.ts`)：

- 单字符样本不前进、无变化格式未跳过，导致循环卡死或空编辑 — 跳过无变化的格式，一圈均无变化则放弃

编辑器批量编辑 (`src/core/editor.ts`)：

- 批量 `insert` / `replace` 短数组访问 `undefined` — 回退空串 `second[index] ?? ''`

终端 (`src/commands/terminal.ts`)：

- `disposeSame` 重命名场景只销毁一个同名终端 — 改为销毁全部同名终端

构建脚本：

- `compress-images.mjs` 源目录缺失时崩溃 — 增加存在性检查并友好退出
- `generate-all-code.mjs` `TARGET_EXTENSIONS` 遗漏 `.js`（与 `LANG_MAP` 不一致）— 补齐

### 测试

- 测试套件由 136 增至 150 项全部通过
- 新增 / 改写用例：标签自闭合 `<div/>`、除法后字符串扫描、CRLF 包裹、绝对路径三态补全、JSONC 字符串内尾逗号、Mixin 字符串内分号分隔、tags-wrap 转义与空白回退、cycle-case 数字 / 跳过 / 单字符、terminal 多同名销毁、editor 批量数组、Windows 大小写 `isSameUri`

## [1.5.0] - 2026-08-17

### 新增

- **路径补全**：`import`/`require`/`src=`/`href=`/`url(...)` 中的文件与目录补全

- tsconfig/jsconfig `paths` 别名解析（JSONC 注释、`baseUrl`、多候选按存在性回退、最长 key 优先）

- `index.less` 目录索引与 SCSS `_partial`（`_theme.scss`）解析

- 大目录候选截断（200 项、目录优先）、目录列表 2s 缓存

- **样式补全**：Less 变量/Mixin、SCSS/Sass 变量（`$var`）与 `@mixin`、CSS 变量

- `@import`/`@use`/`@forward` 递归展开（最多 3 层、防循环），聚合文件二级符号可补全

- Mixin 参数支持嵌套括号、分号分隔、引号内分隔符

- **样式悬浮**：`.class`/`#id` 真实规则（含复合/跨行选择器组、嵌套、注释与字符串感知）、变量解析值

- **颜色选择器**：JS/TS/JSX/TSX 字符串与 vue `<style>` 块内 hex/rgb/rgba/hsl/hsla 色块与拾色器

- 支持 hex / rgb / hsl 三系统格式循环转换

- 模板字符串 `${...}` 插值屏蔽、注释与正则字面量跳过、大文件快速路径

- **代码包裹与 Snippet 增强**（`zeta.editor.wrapConsole` / `zeta.editor.wrapTryCatch` / `zeta.editor.wrapIf`）：
- 支持多选区连续 Tabstop 顺序导航（依次按 Tab 跳转至各处占位符）

- `wrapWithConsole` 自动清理选区尾部分号与空白，光标准确定位于右括号左侧

- `wrapWithIf` 默认高亮选中 `true` 条件占位符

- **命令扩展**：循环切换单词格式（`zeta.editor.cycleCase`，可配 `zeta.case.cycleOrder`）、切换引号（`zeta.editor.cycleQuotes`）、移除外层标签（`zeta.editor.unwrapTags`）、从导航中移除目录

- **资源导航**：拖拽添加目录、根目录父目录副标题、子节点缓存

- **配置项**：`zeta.case.cycleOrder`、`zeta.packageScript.askArguments`（关闭后选中脚本直接运行）

### 变更

- **`zeta.list.folders` 写入作用域由全局改为工作区**（打开工作区时）：不同项目的目录列表按项目隔离；无工作区时仍写全局。升级后首次在某项目添加/移除目录会产生“分叉”（见 README）

- 标签解析重写：HTML void 元素白名单、属性内引号与 `{...}` 表达式跳过（JSX `onClick={() => x > 5}` 不再错位）、`a < b` 比较符不误判

- 缓存体系统一为 `TtlCache`（TTL + 容量上限 + FIFO 淘汰），替代各模块手写缓存

- 模块解耦与抽象：
- 抽离 `src/utils/color.ts` 独立承载 RGB/HEX/HSL 解析与转换纯算法

- 抽离 `mergeOverlappingRanges`、`indentUnit` 等通用编辑工具至 `src/utils/edits.ts`

- 消除 `escapeRegExp` 等工具函数的重复声明

- 样式解析引入文档级（按 `document.version`）与文件级缓存，样式文件保存即失效

- 弃用 `vscode.Uri.parse`（内部触发 Node `url.parse` 的 DEP0169 警告），改为手写 `text/uri-list` 解析

### 修复

- 多光标包裹（console / try-catch / if）在 Windows CRLF 换行及多行场景下的坐标漂移问题

- `wrapWithConsole` 包裹整行时残留尾部分号导致语法错误

- `cycleCase` 多选区同行变换长度变化时后续选区累计偏移

- Mixin 补全丢失点号前缀（`.bordered(...)` 而非 `bordered(...)`）

- 模板字符串含 `${}` 时静态色值失去色块

- 注释剥离误杀 URL（`url('//font.com')`、`https://...` 变量丢失）

- `unwrapTags` 空标签多行解构时区间判定重叠导致静默失败

- 引号拼接转换拆散字符串内的 `+`

- 单个 `.`/`..`/`@` 触发补全时覆盖前缀自身

- 多光标下 `applyEdit` 失败无用户提示（现显示警告）

- 保存被导入的样式文件后，引用方补全/悬浮仍用旧缓存（TTL 窗口内）

### 性能

- 路径/样式/颜色/悬浮高频路径接入文档级、文件级、目录级分层缓存

- 别名候选探测与导入路径探测并行化（`Promise.all`）

- 补全候选目录优先排序后截断，避免大目录渲染与通信开销

- 别名列表在上下文构建期排序，去掉每次击键的重复排序

- 无颜色大文件快速路径、选择器扫描 `includes` 剪枝

## [1.4.x] 及更早

初始版本与功能演进：资源导航、插入标签、修改单词格式、查找脚本运行（含包管理器探测）、终端切换、在浏览器打开、打开文件夹等。细节见 git 历史与 README。
