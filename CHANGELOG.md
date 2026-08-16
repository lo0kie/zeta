# Changelog

本文件自 1.5.0 起维护；更早版本的功能与修复见 README 与 git 历史。

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
- **颜色选择器**：JS/TS/JSX/TSX 字符串与 vue `<style>` 块内 hex/rgb/rgba 色块与拾色器
  - 模板字符串 `${...}` 插值屏蔽、注释与正则字面量跳过、大文件快速路径
- 命令：循环切换单词格式（`zeta.editor.cycleCase`，可配 `zeta.case.cycleOrder`）、切换引号（`zeta.editor.cycleQuotes`）、移除外层标签（`zeta.editor.unwrapTags`）、包裹为 console.log/try-catch/if、从导航中移除目录
- 资源导航：拖拽添加目录、根目录父目录副标题、子节点缓存
- 配置：`zeta.case.cycleOrder`、`zeta.runScript.askArguments`（关闭后选中脚本直接运行）

### 变更

- **`zeta.list.folders` 写入作用域由全局改为工作区**（打开工作区时）：不同项目的目录列表按项目隔离；无工作区时仍写全局。升级后首次在某项目添加/移除目录会产生"分叉"（见 README）
- 标签解析重写：HTML void 元素白名单、属性内引号与 `{...}` 表达式跳过（JSX `onClick={() => x > 5}` 不再错位）、`a < b` 比较符不误判
- 缓存体系统一为 `TtlCache`（TTL + 容量上限 + FIFO 淘汰），替代各模块手写缓存
- 样式解析引入文档级（按 `document.version`）与文件级缓存，样式文件保存即失效
- 弃用 `vscode.Uri.parse`（内部触发 Node `url.parse` 的 DEP0169 警告），改为手写 `text/uri-list` 解析

### 修复

- Mixin 补全丢失点号前缀（`.bordered(...)` 而非 `bordered(...)`）
- 模板字符串含 `${}` 时静态色值失去色块
- 注释剥离误杀 URL（`url('//font.com')`、`https://...` 变量丢失）
- `unwrapTags` 空标签多行解构时编辑范围重叠导致静默失败
- 引号拼接转换拆散字符串内的 `+`
- 非整行选区包裹时缩进叠加错位、if 条件选区偏移
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
