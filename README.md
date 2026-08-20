# Zeta

VS Code 开发工具集：路径/样式导航、标签与结构编辑、命名转换、资源导航、脚本运行、颜色编辑。无遥测，纯本地处理（颜色转换基于 [culori](https://culorijs.org/)）。

## 功能特性

**路径与导入**

- 路径补全：`import` / `require` / `src=` / `href=` / `url(...)` 中补全文件与目录。支持 tsconfig/jsconfig `paths` 别名（`baseUrl`、多候选按存在性回退）、`index.less` 目录索引、SCSS `_partial` 约定；vue / html / 样式文件同样生效。
- 路径 / 导入跳转：F12 或 Ctrl+点击跳到 `import` / `@import` / `@use` 等引用的真实文件。支持 `@` 别名、`~/`、绝对与相对路径；同名不同后缀的文件全部列出供切换；单文件打开（无工作区）按项目根兜底解析。裸模块说明符（`react`、`@scope/pkg`、`pkg/subpath` 等）会解析 `node_modules` 里 `package.json` 的 `exports` / `main` / `module` 入口作为跳转候选。
- 样式导入链接：`@import '@/assets/tokens.module';` 整串带下划线，Ctrl+点击直接打开解析出的 `tokens.module.less`（绕开内置语言服务对别名导入返回的无后缀坏定义）。
- 导入悬浮：悬浮路径字符串显示解析出的真实文件，带可点击的「打开」链接。
- 调试导入解析：诊断命令，展示光标处导入字符串解析到的文件列表。

**样式**

- 样式补全：Less 变量与 Mixin、SCSS/Sass 变量与 `@mixin`、CSS 原生变量；`@import` / `@use` / `@forward` 递归展开（深度上限 `zeta.style.maxImportDepth`），聚合文件（`index.less`）二级符号可补全。支持 SCSS `@use 'x' as c` 命名空间——带 `as` 别名的文件变量仅在 `c.$var` 下提示，不再当全局裸变量干扰。
- 样式悬浮：悬浮 `.class` / `#id` 展示真实选择器规则（含嵌套/复合），悬浮变量展示解析值与定义位置。变量值里引用其他变量（`var(--x)` / `@y` / `$y`）时再展开一层实际值（如 `--brand: var(--primary)` 追加 `--primary = #ff9500`）。
- 语义着色：CSS 变量的 `var(--x)` 用法与 `--x:` 定义处均标记为变量（vue/html 的 `<style>` 块同样生效）。
- 颜色选择器：JS/TS/JSX/TSX 字符串字面量与 vue `<style>` 块内的色值显示色块，点击调起原生拾色器。基于 [culori](https://culorijs.org/)，支持 CSS Color 4 全格式（hex / rgb / hsl / hwb / lab / lch / oklab / oklch / color()），并在格式间循环转换。
  - vue `<style>` 块内若 `var(--x)` 引用的是纯色变量，会在整个 `var(--x)` 引用上显示色块，点开拾色器显示该变量的真实色值，可与普通色值一样调色并写回真实色值（会用选中的格式整体替换 `var(--x)` 引用）。

**代码编辑**

- 插入标签（`Alt+Shift+W`）：配置的标签包裹选区；Tab 依次：标签名改名（闭标签同步）→ 属性位 → 开标签后内容位。
- 移除外层标签：光标处向外移除最近的标签对，多行缩进自动回退。
- 修改单词格式（`Alt+Shift+E`）：内置 12 种格式，预览面板，支持多光标。
- 循环切换格式（`Alt+Shift+C`）：按 `zeta.case.cycleOrder` 顺序单键循环。
- 切换引号 / 模板与拼接互转：`'` / `"` / 模板字符串循环切换；字符串拼接链（`'a' + 'b'`）切换到模板时自动合并为模板字符串，含 `${...}` 表达式的模板（`` `hello ${name}` ``）切到单/双引号时反向拆成拼接（`'hello ' + name`），无表达式的纯文本模板保持原样。
- 选中当前字符串（`Alt+Shift+S`）：光标在字符串字面量内时选中内容（不含引号），支持多光标，注释/正则内不误选。
- 选中当前块：光标在括号块内时选中块内容（不含括号本身），按「最近括号」策略支持 `()` / `[]` / `{}`，混合嵌套与 Vue 动态属性（`:class="[...]"`）同样适用，多光标去重。
- 包裹 console.log / try-catch / if：空选区取整行；console 括号内 Tab 依次：内容整体编辑 → 第二参数位。

**资源导航**
侧边栏树视图展示 `zeta.list.folders` 配置的目录：

- 添加：标题栏按钮（系统目录选择器）或拖拽文件夹进视图；拖入文件会被拒绝并提示「仅支持拖入文件夹」（拖放反馈无法区分文件/目录，拖文件时仍显示可放置高亮，属平台限制）。
- 移除：根目录右键"从导航中移除"。
- 打开：行内按钮/右键在当前窗口、新窗口、终端中打开；HTML 文件可在浏览器打开。
- 文件操作：行内按钮/右键新建文件、新建文件夹、重命名、删除（确认后递归删除）、复制绝对/相对路径（相对第一个工作区根目录）。均基于 `workspace.fs`，兼容 remote/虚拟文件系统。
- 黑名单过滤（`zeta.list.filterFolders`）；根目录显示父目录副标题便于区分同名目录；符号链接目录/文件按位掩码正确归类（不误判为非常规类型而过滤）。

**运行辅助**

- 查找脚本运行（`Ctrl+Alt+Shift+R`）：从 package.json 选择脚本在终端运行，自动探测包管理器（`packageManager` 字段 → 锁文件 → npm）。
- 终端切换：状态栏图标显示终端数量，点击显示/收起终端面板。
- 显示全部命令：QuickPick 列出全部 zeta 命令（可搜索），选中即执行。

## 命令

全部命令以 `zeta.` 前缀注册，可在命令面板搜索标题或 id。

| 命令                             | 说明                                 |
| -------------------------------- | ------------------------------------ |
| `zeta.editor.wrapTags`           | 插入标签                             |
| `zeta.editor.unwrapTags`         | 移除外层标签                         |
| `zeta.editor.changeCase`         | 修改单词格式                         |
| `zeta.editor.cycleCase`          | 循环切换单词格式                     |
| `zeta.editor.cycleQuotes`        | 切换引号 / 模板与拼接互转            |
| `zeta.editor.selectString`       | 选中当前字符串                       |
| `zeta.editor.selectBlock`        | 选中当前块（最近括号）               |
| `zeta.editor.wrapConsole`        | 包裹为 console.log                   |
| `zeta.editor.wrapTryCatch`       | 包裹为 try/catch                     |
| `zeta.editor.wrapIf`             | 包裹为 if 语句                       |
| `zeta.editor.debugResolveImport` | 调试导入解析                         |
| `zeta.folder.runPackageScript`   | 查找脚本运行                         |
| `zeta.folder.openInTerminal`     | 在终端打开                           |
| `zeta.folder.openInWindow`       | 在当前窗口中打开                     |
| `zeta.folder.openInNewWindow`    | 在新窗口中打开                       |
| `zeta.file.openInBrowser`        | 在默认浏览器打开                     |
| `zeta.explorer.addFolder`        | 添加检索目录                         |
| `zeta.explorer.removeFolder`     | 从导航中移除                         |
| `zeta.explorer.refresh`          | 刷新视图                             |
| `zeta.explorer.newFile`          | 新建文件                             |
| `zeta.explorer.newFolder`        | 新建文件夹                           |
| `zeta.explorer.rename`           | 重命名                               |
| `zeta.explorer.delete`           | 删除                                 |
| `zeta.explorer.copyAbsolutePath` | 复制绝对路径                         |
| `zeta.explorer.copyRelativePath` | 复制相对路径                         |
| `zeta.terminal.toggle`           | 切换终端显示                         |
| `zeta.showCommands`              | 显示全部命令                         |
| `zeta.openResolvedImport`        | 打开解析的导入文件（供悬浮链接调用） |

## 快捷键

| 按键               | 命令             | 说明                             |
| ------------------ | ---------------- | -------------------------------- |
| `Alt+Shift+W`      | 插入标签         | Vue/HTML/JSX/TSX 中包裹选区      |
| `Alt+Shift+E`      | 修改单词格式     | 预览面板，12 种格式              |
| `Alt+Shift+C`      | 循环切换单词格式 | 按 `zeta.case.cycleOrder` 循环   |
| `Alt+Shift+S`      | 选中当前字符串   | 光标在字符串内时选中内容         |
| `Alt+Shift+Z`      | 选中当前块       | 光标在括号块内时选中块内容       |
| `Ctrl+Alt+Shift+R` | 查找脚本运行     | 选择 package.json 脚本在终端运行 |

## 配置

配置项以 `zeta.` 前缀注册，作用于资源导航、路径/样式解析、编辑命令。

| 键                                | 类型      | 默认值                                                                                                   | 说明                                                                                                                 |
| --------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `zeta.string.tag`                 | `string`  | `"div"`                                                                                                  | 插入标签时填充的标签                                                                                                 |
| `zeta.case.custom`                | `object`  | `{}`                                                                                                     | 自定义单词转换格式：键为格式名，值为转换步骤数组，每步依次执行 pattern(正则) → replacement(替换串，支持 `$1` 捕获组) |
| `zeta.case.cycleOrder`            | `array`   | `["Camel Case", "Kebab Case", "Pascal Case", "Snake Case", "Constant Case"]`                             | 循环切换格式（Alt+Shift+C）的顺序，可加入 `zeta.case.custom` 的格式名                                                |
| `zeta.list.folders`               | `array`   | `[]`                                                                                                     | 资源导航根目录；绝对路径或相对第一个工作区根的相对路径                                                               |
| `zeta.list.filterFolders`         | `array`   | `["node_modules", ".vscode", ".git", ".svn"]`                                                            | 资源导航中过滤的目录名关键字                                                                                         |
| `zeta.show.explorer`              | `boolean` | `true`                                                                                                   | 是否显示资源导航                                                                                                     |
| `zeta.show.terminal`              | `boolean` | `true`                                                                                                   | 是否显示状态栏终端切换按钮                                                                                           |
| `zeta.packageScript.askArguments` | `boolean` | `true`                                                                                                   | 运行脚本前是否询问追加参数（如 `--watch`）；关闭后选中脚本直接运行                                                   |
| `zeta.path.extensions`            | `array`   | `[".ts", ".js", ".vue", ".tsx", ".jsx", ".json", ".css", ".less", ".scss", ".sass", ".styl", ".stylus"]` | 路径跳转/补全尝试的文件后缀顺序（带点）；同名不同后缀按此顺序全部列出                                                |
| `zeta.path.baseDir`               | `string`  | `"src"`                                                                                                  | `@/` 别名与 `@/sub/path` 解析时映射的基准目录（默认为 `src`，可按项目改为 `lib`、`app` 等）                          |
| `zeta.path.maxCompletionEntries`  | `number`  | `200`                                                                                                    | 路径补全单目录候选上限，超出按目录优先截断                                                                           |
| `zeta.path.showHiddenFiles`       | `boolean` | `false`                                                                                                  | 路径补全是否显示以 `.` 开头的隐藏文件/目录                                                                           |
| `zeta.style.maxImportDepth`       | `number`  | `3`                                                                                                      | 样式补全/悬浮/跳转对 `@import` / `@use` / `@forward` 的递归展开深度上限                                              |

**配置写入作用域**：扩展写入的配置（资源导航目录、插入标签名、循环顺序等）在打开工作区时写入工作区配置（`.vscode/settings.json`，仅当前工作区生效），未打开工作区时写入全局配置——避免多窗口互相覆盖。对 `zeta.string.tag`、`zeta.case.cycleOrder` 这类偏个人偏好的项，若希望全局生效，请直接编辑全局 `settings.json`（或关闭工作区后再修改）。

**`zeta.list.folders` 的隔离**：写入工作区配置时按项目隔离，不同项目的目录列表互不影响。从 1.4.x 升级的用户：首次在某个项目里添加/移除目录后，该项目会从旧的全局列表"分叉"出自己的一份，之后不再跟随全局列表变化——这是预期的隔离行为。

## 开发

```bash
pnpm install
pnpm dev       # watch 构建
pnpm test      # 运行测试（vitest；当前 278 项）
pnpm build     # 产出 dist
pnpm package   # 打包 vsix
```

## License

[MIT](./LICENSE)
