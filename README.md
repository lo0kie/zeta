# Zeta

一个轻量的 VS Code 工具集：资源导航、标签包裹、命名格式转换、npm 脚本运行。打包后无运行时第三方依赖。

## 功能

### 资源导航

侧边栏树视图，展示 `zeta.list.folders` 中配置的目录，支持目录黑名单过滤。未配置时点击提示项可直接调起系统目录选择器，选完自动写入配置。目录行悬停可快捷在终端打开、在当前/新窗口打开；HTML 文件可在默认浏览器打开。

### 插入标签（Alt+Shift+W）

在 Vue / HTML / JSX / TSX 中用配置的标签（默认 `div`）包裹选中内容，自动处理多行缩进，插入后选中标签名，可直接输入改名。

### 修改单词格式（Alt+Shift+E）

选中文本后弹出面板：主标题为转换结果预览，副标题为格式名。内置 Upper、Lower、Camel、Pascal、Snake、Constant、Kebab、Header、Title、Sentence、Dot、Path 十二种格式，支持多光标。

可通过 `zeta.case.custom` 自定义格式，多个步骤依次执行：

```json
"zeta.case.custom": {
  "Vue Kebab": [
    { "pattern": "([a-z])([A-Z])", "replacement": "$1-$2" },
    { "pattern": "[\\s_]+", "replacement": "-" }
  ]
}
```

### 查找脚本运行（Ctrl+Alt+Shift+R）

从当前上下文定位 `package.json`，选择脚本后在对应目录的终端中执行 `npm run <script>`。

## 配置

| 键                        | 类型      | 默认值                                        | 说明                                               |
| ------------------------- | --------- | --------------------------------------------- | -------------------------------------------------- |
| `zeta.string.tag`         | `string`  | `"div"`                                       | 插入标签命令使用的标签名                           |
| `zeta.case.custom`        | `object`  | `{}`                                          | 自定义转换格式，键为格式名，值为步骤数组           |
| `zeta.list.folders`       | `array`   | `[]`                                          | 资源导航检索的根目录，相对路径基于工作区根目录解析 |
| `zeta.list.filterFolders` | `array`   | `["node_modules", ".vscode", ".git", ".svn"]` | 资源导航中过滤的目录名关键字                       |
| `zeta.show.explorer`      | `boolean` | `true`                                        | 是否显示资源导航视图                               |

## 开发

```bash
pnpm install
pnpm dev      # watch 构建
pnpm build    # 产出 dist
pnpm package  # 打包 vsix
```

## License

MIT
