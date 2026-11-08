# Media Workspace

本机运行的 AI 原生口播视频编排与审片工作台。AI 通过 CLI 或 MCP 操作结构化工程；人在本地网页中预览、微调、写批注，再导出 MP4 和封面。

> **开发状态 · 2026-11-02**：阶段 A–F 的核心能力已完成并验收。当前 `dev` 已包含素材裁切、9:16 / 16:9 画幅切换、视频号安全区校准和第三轮验收修复；仍在用新样片走完整流程，验收后再创建 `dev → main` PR。本项目仍处于开发和验收阶段，尚无稳定发布包。

- [开发计划](docs/PLAN.md) · [给 AI 的编排指南](docs/orchestration-guide.md) · [模板指南](docs/template-guide.md)
- [开发规范](AGENTS.md) · [设计决策记录](docs/decisions/)

## 概览

给一段原片和一份文稿，AI 可以在同一个工程里完成识音、字幕、剪辑、画面布局和卡片编排。审片者通过网页预览成片、点选元素、提交批注；AI 再读取批注继续修改。影响成片的工程修改会进入历史，可以撤销或恢复；原始素材保持只读。

工程数据由 CLI、MCP 和工作台共用。工作台只在本机监听，视频预览与最终导出使用同一套 Remotion 合成。

## 功能

### 编排与剪辑

- 导入视频、图片和音频；读取媒体信息，必要时生成标准化素材和预览代理。
- 从原片识音生成字幕；给文稿时按文稿校对，并报告识别不一致处。运行本地对齐后，逐字动画可以跟随实际语音时间。
- 按音频静音剪停顿，调整片段入出点、倍速、转场和关键帧；主轨保持连续，修改可撤销。
- 使用账号版式摆放人物、字幕和标题；按模板添加图片、画中画、卡片和片尾。
- 对主轨视频、画中画和图片设置素材裁切；支持 9:16 与 16:9 画幅转换。
- 导出 MP4、封面静帧，并可将工程与参考成片做画面和节奏对比。

### 审片与质检

- 本地网页实时预览、点选元素、查看时间线和属性。
- 写带时间点和目标元素的批注，交给 AI 继续处理；支持撤销、重做、历史查看和版本恢复。
- `lint` 检查字幕溢出、安全区、文字过小、元素遮挡、人脸遮挡和人物版式等问题。
- 画面比例切换会换算画布与元素布局；竖屏素材切到横屏时会提示留黑和近景风险，需预览确认。

### AI 接入

- `mw` CLI 和 MCP 共用同一套工程操作、校验与结果结构。
- MCP 提供工程初始化、素材导入、识音、编辑、预览、导出、批注等工具；`guide` 返回工具用法、字段和模板说明。
- Claude Code 与 Codex 可选接入批注 hook，让当前审片工程中的新批注出现在 AI 对话上下文里。

## 快速开始

### 环境

- Node.js 24.x、pnpm 10
- `ffmpeg` 和 `ffprobe`；处理 HDR 素材需要带 zimg / libplacebo 的构建
- 默认产品字体为阿里巴巴普惠体 3.0，字体文件不包含在仓库中

### 安装与打开工作台

```bash
pnpm install
pnpm web:build

# 新建工程并导入原片
pnpm mw init demo
pnpm mw import demo /绝对路径/口播原片.mov

# 启动本机审片台，默认地址为 http://127.0.0.1:5170
pnpm mw serve demo
```

主轨为空时，导入的视频会自动放到主轨。工程默认保存在 `~/MediaWorkspace/projects/`；也可以直接把工程目录路径传给 `mw` 命令。`MW_HOME` 可用于更改默认数据目录。

### 识音、预览和导出

识音模型只需下载一次（约 230 MB）。有文稿时将它传给 `transcribe`；没有文稿时省略 `--script`：

```bash
pnpm mw models --fetch
pnpm mw transcribe demo --script /绝对路径/文稿.txt
pnpm mw lint demo
pnpm mw preview demo --at 10000
pnpm mw export demo
```

识音和人脸检测都在本机执行。`mw --help` 和 `mw <命令> --help` 可查看完整参数；`pnpm mw guide` 查看给 AI 使用的编排说明。

### 接入 MCP

MCP 使用 stdio。请在 AI 客户端配置中填写当前 Node 和仓库的**绝对路径**：

```bash
# Claude Code
claude mcp add -s user media-workspace -- /绝对路径/node /绝对路径/media-workspace/bin/mw.mjs mcp
```

```toml
# Codex：~/.codex/config.toml
[mcp_servers.media-workspace]
command = "/绝对路径/node"
args = ["/绝对路径/media-workspace/bin/mw.mjs", "mcp"]
startup_timeout_sec = 60
```

在仓库中运行 `pnpm mw guide` 可查看操作规则。工作台的批注 hook 随仓库提供：Claude Code 使用 `.claude/settings.json`，Codex 使用 `.codex/hooks.json`。Codex hook 目前仍是实验功能；如需持续等待新批注，可运行 `pnpm mw comments <工程> --wait`。

### 字体

项目字体仍放在 `assets/fonts/`（不进 Git），可运行 `pnpm fonts:check` 做严格文件检查。工作台运行时会通过 `/api/fonts` 索引项目字体和本机系统字体；`?refresh=1` 可手动刷新目录。目录项包含字体族名、来源（`project` / `system`）、字重、可用和可导出标记，不返回本机绝对路径。

工程样式保存字体族名或旧注册 ID，不保存系统字体路径。旧注册 ID 优先解析；`Songti SC` 这类系统族名在当前机器可直接交给预览/导出环境解析。授权 A/B/C 只作为证据提示，未知项不会被写成商用批准；策略记录见 [`docs/decisions/0033-runtime-font-discovery.md`](docs/decisions/0033-runtime-font-discovery.md)。

预览、导出和 lint 使用非阻断字体解析：找不到主字体时按项目字体、系统字体和 CSS 后备栈继续渲染，并在 `fontWarnings` 中返回请求字体、实际回退字体和受影响元素。lint 的字体提示不会阻止导出；文字宽度仍是估算值，以预览和导出结果为准。严格的 `pnpm fonts:check` 继续在缺文件时失败。

将阿里巴巴普惠体 3.0 放入 `assets/fonts/alibaba-puhuiti-3/` 后运行 `pnpm fonts:check`。测试字体可通过 `pnpm fonts:fetch-test` 下载；它不替代产品默认字体。

## 当前边界

- 目前只支持 9:16 和 16:9。画幅转换会换算已有布局，但不会自动生成新的横屏构图。
- `mw frame` 根据检测到的人脸为片段计算固定位置，不做逐帧跟踪或随人物移动的自动重构图。
- 人脸检测命令 `mw faces` 目前仅支持 macOS。
- 项目在本机运行，不提供云端协作、账号系统或桌面应用安装包。
- 音频波形用于查看，不提供波形编辑。

## 工程与代码

工程目录通常包含：

```text
<name>.mwproj/
  project.json     # 渲染和剪辑数据
  editor.json      # 参考线、缩放等工作台状态
  review.json      # 审片批注
  history/         # 可回退的历史版本
  captions/        # 导入字幕的副本
  cache/           # 代理、波形和预览图
  renders/         # 导出视频和封面
```

工程格式当前为 v9。原始素材不改写；可生成的中间文件与成片都放在工程目录中。`MW_HOME` 可更改工程与全局库的位置，识音模型默认放在 `~/MediaWorkspace/models/`。

| 路径 | 内容 |
|---|---|
| `src/core/` | 工程 schema、操作、编译、校验、质检和时间线计算 |
| `src/templates/` | 标题、字幕和卡片模板 |
| `src/composition/` | Remotion 预览与导出合成 |
| `src/web/` | 本地审片台 |
| `src/node/` | 媒体处理、存储、识音和导出动作 |
| `src/server/`、`src/mcp/` | 本地 API 与 MCP 服务 |
| `docs/` | 开发计划、使用指南与设计决策 |

开发检查：

```bash
pnpm web:dev
VITE_MW_MOCK=1 pnpm web:dev  # 用示例工程预览界面，不连接服务端
pnpm check
pnpm test
pnpm test:e2e
```

## 授权

- 本仓库代码采用 [MIT 协议](LICENSE)。
- 视频渲染依赖 [Remotion](https://www.remotion.dev)，其授权条款独立于本仓库的 MIT 协议；使用前请阅读 [Remotion License](https://www.remotion.dev/license)。
- 识音使用 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 与 SenseVoice 模型；模型不包含在仓库中，下载和使用时请遵守各自协议。
- 项目字体二进制不包含在仓库中，请从官方渠道获取并遵守其使用协议；系统字体只在本机运行时使用，不随工程分发。
