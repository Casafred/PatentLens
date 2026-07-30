# Electron 打包维护规则

> 本规则为永久性规则，所有开发者在新增前端资源文件后必须遵守。

## 核心规则

### 1. 新增前端资源文件时，必须同步更新 package.json 的 build.files 配置

Electron 打包由 `electron-builder` 执行，打包文件列表在 [package.json](file:///package.json) 的 `build.files` 字段中配置。**只有显式列出的文件/目录才会被打进 asar 包**。

当你在 `src/` 下新增以下任意类型的文件时，必须检查并更新 `build.files`：

| 文件类型 | 当前打包配置 | 需要的操作 |
|---------|-------------|-----------|
| HTML 文件 | 逐个列出（web.html, index.html, popout.html） | 在 filter 数组中添加新文件名 |
| JS 文件（根目录） | 逐个列出（web-app.js, web-ai.js 等） | 在 filter 数组中添加新文件名 |
| JS 文件（子目录） | 按目录通配（scripts/agent/**, scripts/comparison/**） | 添加新的 `"scripts/新目录/**"` 条目 |
| CSS 文件 | `styles/**` 通配 | 无需操作（已被通配符覆盖） |
| 图片/字体 | 逐个列出或 `fonts/**` 通配 | 视情况添加 |

### 2. 打包前自检清单

每次执行 `npm run build:electron` 或 `npm run pack` 之前，必须确认：

- [ ] 所有 HTML 中 `<script src="...">` 引用的 JS 文件都在 `build.files` 中
- [ ] 所有 HTML 中 `<link href="...">` 引用的 CSS 文件都在 `build.files` 中
- [ ] 新增的子目录已用 `"scripts/新目录/**"` 形式添加到 filter 中
- [ ] 脚本版本号 `?v=XXXXXX` 已更新为最新版本（避免缓存问题）

### 3. 快速验证方法

```bash
# 打包后验证 asar 中是否包含所有必要文件
npx asar list dist-electron/win-unpacked/resources/app.asar | grep comparison

# 或在打包前用 diff 检查
# 列出 web.html 中所有引用的 JS 文件，对比 build.files 配置
grep -oP 'src="scripts/[^"]+\.js' src/web.html | sort -u
```

### 4. 版本号规范

- 所有脚本引用统一使用 `?v=YYMMDD` 格式的版本号（如 `?v=260729`）
- 每次发版时，更新所有脚本引用的版本号为当前日期
- **不要混用不同版本号**，避免部分文件被缓存、部分文件更新导致不一致

## 历史教训

- **2026-07-16**：新增智能比对功能（`scripts/comparison/` 目录下 6 个 JS 文件），但未在 `build.files` 中添加 `"scripts/comparison/**"`，导致打包后的 Electron 应用中 404 找不到这些文件，智能比对面板无法显示。
- 同一时期，comparison 脚本版本号停留在 `?v=260716`，而其他脚本已更新到 `?v=260729`，造成缓存不一致问题。
