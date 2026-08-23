# scripts/

本目录是 monorepo 的脚本集合。文件路径被 `build-windows-installer.ps1`、CI（`.github/workflows/ci.yml`）和各 `package.json` 用相对路径硬编码引用，**不要移动文件**。需要新建脚本时请放入对应分组，并在下方索引登记。

## 一、npm 插件交付链（`npx beauticode-dsh`）

插件本体在 `integrations/deepseek-harness/`，这里只放打包/发布脚本：

- `pack-dsh-plugin.mjs` —— 打包并（可选）发布 `beauticode-dsh` 到 npm。
  - `npm run plugin:pack` 仅打包到 `artifacts/dsh-plugin/`
  - `npm run plugin:publish` 打包后发布

## 二、Windows 安装包交付链（Release）

- `build-windows-installer.ps1` —— 主构建脚本：编译 TS → 暂存运行时 → 下载校验 Node.js → 调 Inno Setup 产出安装包（`npm run installer:windows`，输出到 `artifacts/windows/installer/`）。
- `install-dsh-plugin.ps1` —— 安装时把 DSH 插件写入用户 profile（README「从源码运行」也会调用）。
- `install-desktop-shortcut.ps1` —— 安装桌面快捷方式（仅 CI 做语法校验，未在主流程调用）。
- `codex-launch.ps1` —— Codex Desktop 拉起辅助脚本（被 `start-beauticode.ps1` 引用）。
- `start-beauticode.ps1` —— 宿主选择器入口（打开后让用户选 DSH 或 Codex）。
- `start-beauticode-engine.ps1` —— 引擎启动脚本。
- `integration-note.zh.txt` —— 安装包内置的中文集成说明（被 `build-windows-installer.ps1` 暂存）。

## 三、运行 / 测试 / 通用工具

- `beauticode.mjs` —— beautiCode CLI 主入口（`npm run bc` / `npm run discover`）。
- `live-smoke.mjs` —— 真机冒烟测试（`npm run smoke:live`，需 `--port <cdpPort>`）。
- `test-runner.mjs` —— 各包 `npm test` 复用的测试运行器。
- `copy-renderer-assets.mjs` —— `adapter-codex` 构建时复制渲染器资源。

## 约定

- 新增脚本如需被安装包暂存，记得加入 `build-windows-installer.ps1` 的 `relativeFile` 列表。
- 新增 PowerShell 脚本需在 `.github/workflows/ci.yml` 的「Parse PowerShell launchers」矩阵里登记。
- 新增 `.mjs` 入口需在 CI「Parse JavaScript entry points」步骤补 `node --check`。
