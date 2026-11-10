# dsh-scissors

给 DeepSeek Harness（DSH）输入框加一个剪刀按钮：点一下，框选屏幕区域，截图直接变成输入框里的图片附件。

A scissors button for the DeepSeek Harness composer. Click it, drag a region on screen, and the PNG becomes an ordinary image attachment in the message box.

## 功能 / Features

- 按钮位于输入框 `+` 按钮右侧，图标与 DSH 自带的 16×16 线性图标一致。
- 点击后弹出锚定在按钮上的菜单，提供两种截图方式：
  - **截图**：直接框选屏幕区域。
  - **截图（隐藏主窗口）**：先隐藏 DSH 主窗口，截完自动恢复并聚焦；取消、失败、超时也会恢复。
- 截图以标准草稿图片附件加入输入框，跟粘贴图片完全一样：可预览、可删除、可随消息一起发送。
- 菜单支持鼠标和键盘：`↑` / `↓` / `Home` / `End` 切换，`Enter` 执行，`Esc` 关闭并把焦点还给按钮，点击菜单外部关闭。
- 中英文界面跟随 DSH 语言设置。
- 截图只在本机处理；插件不会上传、缓存或记录截图内容。

## 平台支持 / Platform support

| 平台 | 区域选择 | 隐藏主窗口 | 依赖 |
| --- | --- | --- | --- |
| Windows | ✅ 内置 WinForms 选择器 | ✅ | .NET Framework（Windows 10/11 自带；发布包已附带编译好的 `scissors.exe`） |
| macOS | ✅ `screencapture -i` | ✅ 通过 System Events | 系统自带 `screencapture`；录屏需要“屏幕录制”权限，隐藏窗口需要“自动化”权限 |
| Linux | ✅ 自动选择可用后端 | ✅ X11（`xdotool`） | `grim` + `slurp`、`gnome-screenshot`、`spectacle`、`scrot` 或 `maim`；隐藏窗口需要 `xdotool` |

Windows 已做完整的真机验证（含隐藏/恢复窗口）。macOS 与 Linux 路径按系统工具实现，未在真机上做发布前验证；如果遇到问题欢迎提 issue。

## 安装 / Install

从插件市场或 npm 安装（把 `desktop` 换成你实际使用的 profile；Web 版通常是 `web`）：

```bash
dsh plugin --profile desktop add dsh-scissors
```

然后重启 DSH（桌面版重新打开应用，命令行版重新启动 `dsh web`）。

本地开发时可以把目录链接进 profile：

```bash
git clone https://github.com/Lion2c/dsh-scissors.git
dsh plugin --profile desktop add link:D:/path/to/dsh-scissors
```

Windows 路径同样可以写成 `link:D:/AIProjects/dsh-scissors`。

安装后重启 DSH（或重新加载窗口），输入框 `+` 右侧就会出现剪刀按钮。

卸载：

```bash
dsh plugin --profile desktop remove dsh-scissors
```

## 使用 / Usage

1. 点击剪刀按钮。
2. 在弹出的菜单里选择一种方式：
   - **截图**：窗口保持原样，直接框选。
   - **截图（隐藏主窗口）**：DSH 窗口先隐藏，屏幕冻结后框选；完成后窗口自动恢复。
3. 按住鼠标左键拖出矩形区域，松开即完成。
4. 按 `Esc` 取消本次截图；Windows 选择器也支持右键取消。
5. 截图会作为图片附件出现在输入框上方；按正常方式发送消息即可。

菜单打开时也可以只用键盘：`↑` / `↓` 选择，`Enter` 确认，`Esc` 取消。

## 隐私与安全 / Privacy & security

- 截图通过当前 DSH Web 服务传输，不经过任何第三方服务器。
- 服务端路由位于 `/.dsh-scissors`，只接受同源请求，并要求自定义请求头 `x-dsh-scissors: capture`。
- 截取的图片只存在于本次请求和当前会话的草稿附件中；插件不记录截图内容、不上传、不做遥测（仅在服务端出错时写一条 DSH 错误日志）。
- 隐藏窗口是可选操作，且由用户每次显式选择；插件不会在用户不知情时隐藏窗口。
- Windows 选择器源码在 `native/win/selector.cs`，发布包同时附带预编译的 `scissors.exe`，可自行审计或重新编译。

## 故障排查 / Troubleshooting

**按钮不出现**
- 确认插件已装进当前 profile：`dsh plugin --profile web why dsh-scissors`。
- 重启 DSH 或刷新窗口。
- 查看 DSH 启动日志中是否有 `dsh-scissors` 相关错误。

**提示“当前平台不支持截图”**
- Windows：确认 `native/win/scissors.exe` 存在，或系统里有 `csc.exe` 可编译选择器。
- macOS：确认 `/usr/sbin/screencapture` 存在，并在“系统设置 → 隐私与安全性 → 屏幕录制”里允许 DSH。
- Linux：安装任一支持的后端，例如 `sudo apt install grim slurp`；隐藏窗口还需要 `xdotool`（仅 X11）。

**“截图（隐藏主窗口）”不可用或失败**
- macOS 需要在“隐私与安全性 → 自动化”中允许 DSH 控制 System Events。
- Linux Wayland 会话下通常无法隐藏任意窗口；插件会回退为普通截图或提示不支持。

**截图成功但没有出现在输入框**
- 输入框可能处于发送/上传中，附件会被丢弃并提示“输入框正忙”。
- 尝试先清空输入框再截图。

**重装后仍是旧版本**
- DSH 会缓存客户端模块；完全退出并重新启动 `dsh web`。

## 开发 / Development

```bash
# 安装测试依赖
npm install

# 单元 / 冒烟测试（Host 路由 + 浏览器端 SSR）
npm test

# Windows 原生选择器测试：会弹出全屏选择器并移动鼠标
npm run test:native
```

`npm run test:native` 只适用于 Windows，覆盖 Esc 取消、真实鼠标拖拽出图、隐藏/恢复前台窗口。它会短暂接管鼠标和屏幕，建议单独运行。

目录结构：

```
index.js                 Host 端：HTTP 路由、平台探测、截图后端
client.js                Browser 端：按钮、菜单、Toast、附件注入
cordis.patch.yml         Bundle patch，安装时插入插件
locale/{en,zh}.json      插件市场展示文案
icon.svg                插件图标
native/win/selector.cs   Windows 区域选择器源码
native/win/build.ps1    重新编译脚本
native/win/scissors.exe 预编译选择器
test/                    路由、客户端和 Windows 原生选择器测试
catalog/                 插件市场条目（提交 PR 用）
```

重新编译 Windows 选择器（需要 .NET Framework 的 `csc.exe`）：

```bash
powershell -ExecutionPolicy Bypass -File native/win/build.ps1
```

Host 端注册两个路由：

- `GET /.dsh-scissors/health`：返回 `supported`、`hideSupported`、`platform`、`backend`、`busy`。
- `POST /.dsh-scissors/capture`：请求体 `{ "hide": true | false }`，返回 `{ image, mime, name }` 或 `{ cancelled: true }`。

## 发布 / Publishing

见 [PUBLISHING.md](./PUBLISHING.md)。仓库已按 `Lion2c/dsh-scissors` 配置好；接下来需要发布 npm 包、给仓库加上 `dsh-plugin` topic，并向插件市场提交 catalog 条目。

## License

[MIT](./LICENSE)
