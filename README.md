# Xenon

Xenon 是一个轻量级桌面截图翻译工具：按下全局快捷键划选屏幕区域，应用会用 macOS Vision 框架做 OCR 文字提取，再交给大模型翻译，结果直接回填到主窗口。

## 功能

- **截图翻译**：全局快捷键划选屏幕区域，OCR 识别后自动翻译。
- **输入翻译**：快捷键唤起主窗口，输入文本即时翻译。
- **自动语言检测**：自动识别中、英、日、韩、德、法、西、俄、意、葡等语言，并智能选择目标语言。
- **多服务商支持**：兼容任意 OpenAI 兼容接口（OpenAI、DeepSeek、StepFun 等），可在偏好设置中配置多个服务商与模型。
- **全局快捷键**：输入翻译、截图翻译、偏好设置的快捷键均可自定义。

## 环境要求

- Node.js 22 及以上（`pnpm test` 依赖 Node 原生运行 TypeScript）
- pnpm
- 截图 OCR 功能目前仅支持 macOS（依赖系统 Vision 框架）

## 开发

### 安装

```bash
pnpm install
```

### 启动开发环境

```bash
pnpm dev
```

截图 / OCR 流程的诊断日志默认关闭，排查问题时以 `DEBUG_CAPTURE=1` 启动：

```bash
DEBUG_CAPTURE=1 pnpm dev
```

### 常用命令

```bash
pnpm lint        # ESLint
pnpm typecheck   # TypeScript 类型检查（主进程 + 渲染进程）
pnpm test        # 运行单元测试
pnpm format      # Prettier 格式化
pnpm build       # 类型检查 + 构建
pnpm build:ocr   # 重新编译 macOS Vision OCR 二进制（需 Xcode 命令行工具）
```

### 打包

```bash
pnpm build:mac    # macOS
pnpm build:win    # Windows
pnpm build:linux  # Linux
```

## 第三方资源

偶遇复习卡片中的人群插画与动画参考来源，请见 [第三方资源说明](THIRD_PARTY_NOTICES.md)。
