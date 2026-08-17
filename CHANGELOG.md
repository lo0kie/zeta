# Changelog

本文件自 1.5.0 起维护。1.5.1 起的修复随版本累积记录；1.5.0 的修复见下方。更早版本的功能与修复见 README 与 git 历史。

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

运行脚本 (`src/commands/run-script.ts`)：

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

- **配置项**：`zeta.case.cycleOrder`、`zeta.runScript.askArguments`（关闭后选中脚本直接运行）

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
