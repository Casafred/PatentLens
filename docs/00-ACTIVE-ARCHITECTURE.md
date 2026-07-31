# PatentLens 当前有效架构

> 状态：生效中  
> 基线：`main@e990b50769e042672772fd2ccc1d54a12095eaa9`  
> 更新日期：2026-07-31

## 结论

PatentLens 当前是 **Electron 桌面应用**，不是 Tauri 应用。所有新功能、缺陷修复、打包、调试和重构均应以 Electron 运行链路为准。

## 当前运行链路

```text
package.json (main: electron-main.js)
  -> electron-main.js
     -> 启动内置本地 HTTP 服务
     -> 创建 Electron BrowserWindow
     -> 注入 preload.js
     -> 加载 http://127.0.0.1:<port>/
        -> Electron 服务将 / 映射到 src/web.html
        -> src/web.html 加载 src/scripts/web-app.js 等渲染进程脚本
        -> preload.js 暴露 window.electronAPI
        -> renderer 通过 IPC / 本地 HTTP API 调用桌面能力
```

关键事实：

- 桌面主进程：`electron-main.js`
- 渲染进程安全桥：`preload.js`
- Electron 主页面：`src/web.html`
- 核心渲染逻辑：`src/scripts/web-app.js`
- 打包工具：`electron-builder`
- 开发命令：`npm run dev` / `npm start`
- 生产打包：`npm run build:electron`

## Tauri 目录的定位

`src-tauri/` 是历史实现和参考代码，不在当前 Electron 产品的启动、运行或打包主链路中。除非未来由项目负责人明确批准一次架构迁移，否则：

- 不修改 `src-tauri/`；
- 不为新功能补写 Rust/Tauri 对应实现；
- 不修复 Tauri 构建问题；
- 不新增 Tauri API、依赖或脚本；
- 不以“Tauri 与 Electron 双端同步”为验收条件。

前端目前仍存在少量 `isTauri`、`tauriInvoke` 和 `window.__TAURI_INTERNALS__` 历史兼容分支。这些代码不代表当前架构仍为双框架。处理原则是：不扩展；如要删除，必须作为独立的 Electron-only 清理任务，并先覆盖对应 Electron 路径的回归测试。

## 文档优先级

当旧文档与本文件冲突时，以本文件和根目录 `AGENTS.md` 为准。以下文档包含历史 Tauri 设计，不能作为当前实现依据：

- `docs/01-项目概述与技术选型.md`
- `docs/05-架构设计.md`
- `docs/06-开发者上手指南.md` 中的 Tauri 章节
- `src-tauri/` 内的配置与源码

## 修改决策表

| 需求 | 应修改位置 | 不应修改位置 |
|---|---|---|
| 桌面窗口、弹窗、下载、Cookie、系统能力 | `electron-main.js`、`preload.js` | `src-tauri/` |
| Renderer UI 与交互 | `src/web.html`、`src/styles/`、`src/scripts/` | Tauri Rust 命令 |
| Renderer 到桌面能力的调用 | `window.electronAPI` + Electron IPC | 新增 `tauriInvoke` |
| 本地代理/API | `electron-main.js` 的内置服务；必要时同步评估 `server.js` | Tauri HTTP/Rust 客户端 |
| Windows 打包 | `package.json#build`、electron-builder | `tauri.conf.json`、Cargo |

