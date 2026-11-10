# 发布到 DSH 插件市场 / Publishing to the DSH plugin market

本文档对应仓库地址 `https://github.com/Lion2c/dsh-scissors`，npm 包名为 `dsh-scissors`。
仓库内的 `OWNER` 占位符已替换为 `Lion2c`，市场条目文件为 `catalog/lion2c--dsh-scissors.json`。

## 0. 检查清单

- [x] `package.json` 中 `author`、`repository`、`homepage`、`bugs` 已填写为 `Lion2c`
- [x] `README.md`、`LICENSE`、`catalog/lion2c--dsh-scissors.json` 已填写为 `Lion2c`
- [x] `package.json` 的 `dsh.bundle.patch` 非空，且 `cordis.patch.yml` 已提交
- [x] `node --check index.js && node --check client.js` 通过
- [x] `npm install && npm test` 通过；Windows 上再跑一次 `npm run test:native`
- [x] `npm.cmd pack --dry-run` 包含 `client.js`、`index.js`、`cordis.patch.yml`、`native/win/scissors.exe`、`selector.cs`、`locale/*.json`、`icon.svg`
- [x] 在真实 DSH 中装过一次，按钮、菜单、截图、附件都正常
- [ ] 仓库已加 GitHub topic：`dsh-plugin`

## 1. 本地准备（已完成）

本仓库已完成以下准备，无需重复：

- `OWNER` 已全部替换为 `Lion2c`
- `catalog/plugins/OWNER--dsh-scissors.json` 已重命名为 `catalog/plugins/lion2c--dsh-scissors.json`
- 已初始化 git 并完成首次提交

如果以后把仓库迁移到其他账号，重新替换 `Lion2c` 并重命名 catalog 文件即可。

## 2. 创建仓库并加 topic

```bash
git init
git add .
git commit -m "feat: dsh-scissors screenshot button for the composer"
git branch -M main
git remote add origin https://github.com/Lion2c/dsh-scissors.git
git push -u origin main
```

然后给仓库加 topic（网页或 GitHub CLI）：

```bash
gh repo edit Lion2c/dsh-scissors --add-topic dsh-plugin
```

`dsh-plugin` topic 是插件市场做无损发现的关键；没有它，仓库可能不会被收录。

## 3. 发布 npm 包

```bash
npm login
npm publish --access public
```

Windows 上如果 `npm` 被 PowerShell 执行策略拦截，使用 `npm.cmd`：

```powershell
npm.cmd publish --access public
```

发布后确认 registry 上的版本和内容：

```bash
npm view dsh-scissors version
npm view dsh-scissors dist.tarball
```

插件市场只从 npm 生成安装命令。没有 npm 包时条目仍可被收录，但只会是“仅浏览”。

## 4. 提交插件市场条目

市场仓库：<https://github.com/imsai-sh/awesome-deepseek-harness-plugins>

规则要点：

- 每个插件只加一个 `catalog/plugins/*.json` 文件。
- 一个 PR 只允许新增一个条目，不能改 README、脚本或工作流。
- 文件名由 id 生成：`Lion2c/dsh-scissors` → `lion2c--dsh-scissors.json`（小写、非字母数字转 `-`）。
- `description.en` / `description.zh` 都必填，保持事实、简洁。
- `added` 用提交当天日期（`YYYY-MM-DD`）。
- 条目 schema：`catalog/schema/plugin.schema.json`。

操作：

```bash
# fork 并克隆市场仓库
git clone https://github.com/Lion2c/awesome-deepseek-harness-plugins.git
cd awesome-deepseek-harness-plugins
cp D:\AIProjects\OpenCode\dsh-scissors\catalog\lion2c--dsh-scissors.json catalog/plugins/
git checkout -b add-dsh-scissors
git add catalog/plugins/lion2c--dsh-scissors.json
git commit -m "Add dsh-scissors"
git push origin add-dsh-scissors
```

然后在 GitHub 上向 `imsai-sh/awesome-deepseek-harness-plugins:main` 发 PR。

当前仓库内的条目内容如下：

```json
{
  "$schema": "../schema/plugin.schema.json",
  "id": "Lion2c/dsh-scissors",
  "name": "dsh-scissors",
  "repository": "https://github.com/Lion2c/dsh-scissors",
  "category": "ui",
  "description": {
    "en": "Adds a scissors button beside the composer's + button. Capture a screen region directly or hide the main window first; the PNG becomes a normal image attachment in the message box.",
    "zh": "在输入框 + 按钮右侧添加剪刀按钮。可直接框选屏幕区域，或先隐藏主窗口再截图；PNG 会作为普通图片附件放入输入框。"
  },
  "added": "2026-11-10"
}
```

PR 合并后，市场会自动同步到 deepseek1024.com，并自动重建 README；不需要再手动改市场仓库的其他文件。

## 5. 发布后验证

```bash
# 在干净 profile 中安装
dsh plugin --profile web add dsh-scissors

# 确认安装来源
dsh plugin --profile web why dsh-scissors

# 启动并检查按钮
dsh web
```

同时打开市场页面，确认条目、版本、安装命令和仓库链接都正确。

## 6. 版本更新

1. 修改代码并测试。
2. 更新 `package.json` 的 `version`。
3. `npm.cmd publish`。
4. 如描述或分类变化，单独发一个市场 PR 更新对应 JSON。

市场条目按仓库 id 唯一；发新版不需要重复添加条目。
