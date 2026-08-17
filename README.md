# Zeta

一体化的 VS Code 开发工具集：资源导航、标签与代码结构操作、命名格式转换、智能路径/样式补全、颜色编辑、脚本运行。**零运行时依赖、无遥测、纯本地**。

## 安装即生效（无需调用命令）

以下能力注册后自动工作，无需快捷键或命令：

- **路径补全** — 在 `import` / `require` / `src=` / `href=` / `url(...)` 中补全文件与目录路径。支持 tsconfig/jsconfig 的 `paths` 别名（含 `baseUrl`、多候选回退）、`index.less` 目录索引、SCSS `_partial` 约定，`.vue` / `.html` / CSS 里同样生效。
- **样式补全** — Less 变量（`@var:`）与 Mixin（`.name(...)`）、SCSS/Sass 变量（`$var:`）与 `@mixin`、CSS 原生变量（`--var`）。导入关系递归展开（`@import` / `@use` / `@forward`），聚合文件（`index.less`）里的二级符号也能补全。
- **样式悬浮** — 悬浮 `.class` / `#id` 展示真实选择器声明（含嵌套与复合选择器），悬浮 Less/SCSS/CSS 变量展示解析值与其定义位置。
- **颜色选择器** — JS/TS/JSX/TSX 字符串字面量与 vue `<style>` 块内的 hex / rgb / rgba 色值显示色块，点击调起原生拾色器，支持写回 hex 或 rgb/rgba。

## 命令与快捷键

| 快捷键             | 命令                                | 说明                                                                                         |
| ------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `Alt+Shift+W`      | 插入标签                            | Vue/HTML/JSX/TSX 中用配置的标签包裹选区，插入后选中标签名可直接改名                          |
| —                  | 移除外层标签                        | 光标所在位置向外移除最近的标签对（含多行缩进回退）                                           |
| `Alt+Shift+E`      | 修改单词格式                        | 弹面板：主标题预览转换结果，内置 12 种格式，支持多光标                                       |
| `Alt+Shift+C`      | 循环切换单词格式                    | 在 `zeta.case.cycleOrder` 配置的格式间单键循环（默认 Camel→Kebab→Pascal→Snake→Constant）     |
| —                  | 切换引号                            | 单引号 / 双引号 / 模板字符串循环切换，字符串拼接链自动合并为模板                             |
| `Ctrl+Alt+Shift+R` | 查找脚本运行                        | 定位 package.json 选择脚本在终端运行，自动探测包管理器（packageManager 字段 → 锁文件 → npm） |
| —                  | 包裹为 console.log / try-catch / if | 选区（空选区取整行）包进对应结构，光标落在待编辑位置                                         |
| —                  | 在默认浏览器打开                    | 编辑器标题栏 / 右键 / 资源导航中打开 HTML                                                    |
| —                  | 终端切换                            | 状态栏终端图标：显示当前终端数量，点击显示/收起终端面板                                      |

### 资源导航

侧边栏树视图展示 `zeta.list.folders` 配置的目录：

- **添加**：视图标题栏按钮（调起系统目录选择器）或直接**拖拽**工作区/文件管理器的文件夹进视图
- **移除**：根目录右键"从导航中移除"
- **打开**：行内按钮/右键在当前窗口、新窗口、终端中打开；HTML 文件可在浏览器打开
- 支持黑名单过滤（`zeta.list.filterFolders`），根目录显示父目录副标题便于区分同名目录

## 配置

| 键                            | 类型      | 默认值                                                                       | 说明                                                   |
| ----------------------------- | --------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| `zeta.string.tag`             | `string`  | `"div"`                                                                      | 插入标签命令使用的标签名                               |
| `zeta.case.custom`            | `object`  | `{}`                                                                         | 自定义转换格式：键为格式名，值为转换步骤数组           |
| `zeta.case.cycleOrder`        | `array`   | `["Camel Case", "Kebab Case", "Pascal Case", "Snake Case", "Constant Case"]` | 循环切换格式的顺序，可加入 `zeta.case.custom` 的格式名 |
| `zeta.list.folders`           | `array`   | `[]`                                                                         | 资源导航根目录；相对路径基于工作区根目录解析           |
| `zeta.list.filterFolders`     | `array`   | `["node_modules", ".vscode", ".git", ".svn"]`                                | 资源导航过滤的目录名关键字                             |
| `zeta.show.explorer`          | `boolean` | `true`                                                                       | 是否显示资源导航视图                                   |
| `zeta.show.terminal`          | `boolean` | `true`                                                                       | 是否显示状态栏终端切换按钮                             |
| `zeta.runScript.askArguments` | `boolean` | `true`                                                                       | 运行脚本前是否询问追加参数（关闭后选中即运行）         |

> **`zeta.list.folders` 的作用域**：在打开工作区时写入**工作区配置**（按项目隔离，不同项目的目录列表互不影响）；未打开工作区时写入全局配置。从 1.4.x 升级的用户：首次在某个项目里添加/移除目录后，该项目会从旧的全局列表"分叉"出自己的一份，之后不再跟随全局列表变化——这是预期的隔离行为。

## 开发

```bash
pnpm install
pnpm dev       # watch 构建
pnpm test      # 运行测试（node:test，无需额外依赖）
pnpm build     # 产出 dist
pnpm package   # 打包 vsix
```

## License

[MIT](./LiCENSE)
