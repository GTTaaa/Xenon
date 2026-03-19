# Repository Guidelines

## 项目结构与模块组织

项目采用 Electron + Vite + React + TypeScript。主进程代码位于 `src/main`，预加载脚本位于 `src/preload`，渲染进程界面位于 `src/renderer/src`。静态资源主要放在 `src/renderer/src/assets`，打包图标与平台配置位于 `build` 和 `resources`。构建产物输出到 `out`，不要手动修改该目录内容。

## 构建、测试与开发命令

- `pnpm install`：安装依赖，并触发 `electron-builder install-app-deps`。
- `pnpm dev`：启动本地开发环境，包含 Electron 主进程与渲染进程热更新。
- `pnpm lint`：运行 ESLint 检查整个仓库。
- `pnpm typecheck`：分别校验 Node 端与 Web 端 TypeScript 类型。
- `pnpm build`：先执行类型检查，再构建应用。
- `pnpm build:mac` / `pnpm build:win` / `pnpm build:linux`：生成对应平台安装包。

## 代码风格与命名规范

统一使用 2 空格缩进、LF 换行、UTF-8 编码，遵循 `.editorconfig`。Prettier 配置为单引号、无分号、`printWidth: 100`；提交前执行 `pnpm format`。TypeScript 与 React 组件文件使用 `PascalCase`，函数、变量使用 `camelCase`，资源文件名使用小写或连字符形式，例如 `wavy-lines.svg`。新增代码应沿用现有模块边界，不要把主进程逻辑写入渲染进程。

## 测试要求

当前仓库尚未配置自动化测试框架，也没有 `tests` 目录。提交功能改动前，至少运行 `pnpm lint` 和 `pnpm typecheck`。如果新增复杂逻辑，优先补充可落地的测试方案，并将测试文件与目标模块放在同层或新建 `src/**/__tests__` 目录，命名建议使用 `*.test.ts` 或 `*.test.tsx`。

## 提交与合并请求规范

现有提交历史采用 Conventional Commits，例如 `feat: initialize Electron app with React and TypeScript`。后续请继续使用 `feat:`、`fix:`、`refactor:`、`docs:` 等前缀，主题行聚焦单一变更。提交合并请求时应说明改动目的、影响范围、验证命令；涉及界面变更时附上截图。

## 配置与安全提示

应用打包配置集中在 `electron-builder.yml` 与 `electron.vite.config.ts`。修改窗口权限、预加载暴露能力或外链打开策略时，优先检查 `src/main/index.ts` 和 `src/preload/index.ts`，避免直接扩大渲染进程权限。
