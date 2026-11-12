# Xenon 宣传短片

使用 HyperFrames 制作的 Xenon 产品介绍短片，约 32.5 秒，1920×1080，30fps，简体中文。

## 结构

- `index.html`：根合成，声明配色与字体变量，按时间挂载七个场景。
- `compositions/`：钩子、流式译文、结构保留、工作区、模型设置、主张、结尾七个场景。
- `assets/`：真实产品截图、应用图标与中文字体。
- `SPEC.md`：镜头、字号、颜色、运动曲线与验收帧。
- `STORYLINES.md`：三条故事线及最终选择。
- `REVIEW.md`：审阅记录、已知取舍与下一步。

## 命令

```bash
npm run dev      # 打开 Studio 预览
npm run check    # 检查合成、运行时、布局、动效与对比度
npm run render   # 渲染 MP4 到 out/
```

首次渲染前确认本机 Chrome 与 ffmpeg 可用。当前版本没有音轨；如需音乐，在 `index.html` 中增加 `<audio>` 并按 `data-start` 对齐动作点。
