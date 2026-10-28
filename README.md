# Media Workspace

本地运行的 AI 原生口播编排工作台：AI 通过 CLI / MCP 修改结构化工程，人在本地网页里预览、微调、导出。

- 开发计划：[docs/PLAN.md](docs/PLAN.md)
- 开发规范：[AGENTS.md](AGENTS.md)

> 状态：阶段 A 已验收（2026-10-28，`dev` 分支，暂未合并到 `main`）。验收记录见 [docs/decisions/0004](docs/decisions/0004-phase-a-acceptance.md)。

## 本地使用（阶段 A：CLI）

需要 Node 24、pnpm 10、ffmpeg。

```bash
pnpm install
pnpm fonts:check            # 普惠体放进 assets/fonts/alibaba-puhuiti-3/；测试字体用 pnpm fonts:fetch-test 下载
./bin/mw.mjs --help         # 或者 pnpm link --global 之后直接用 mw
./bin/mw.mjs guide          # 给 AI 看的操作和样式说明
./bin/mw.mjs models --fetch # 下载识音模型（约 230MB，只需一次）；之后 mw align <工程> 让逐字动画跟着语音走
```

### 工作台和 AI 接入（阶段 B，开发中）

```bash
./bin/mw.mjs serve <工程>   # 本地工作台，默认 http://127.0.0.1:5170（网页需要先 pnpm web:build）
pnpm web:dev                # 开发审片台（/api 代理到 mw serve）；VITE_MW_MOCK=1 时不连服务端，用示例工程
./bin/mw.mjs mcp            # MCP stdio 服务
```

在 Claude Code 里接入 MCP（Codex 等其他 AI 应用同理，命令是 `<仓库路径>/bin/mw.mjs mcp`）：

```bash
claude mcp add media-workspace -- node <仓库路径>/bin/mw.mjs mcp
```

工程默认放在 `~/MediaWorkspace/projects/`，可以用 `MW_HOME` 修改；识音模型放在 `~/MediaWorkspace/models/`。

## 授权说明

- 本仓库的代码采用 [MIT 协议](LICENSE)。
- 本项目依赖 [Remotion](https://www.remotion.dev) 渲染视频。**Remotion 有自己的授权条款，不随本仓库的 MIT 协议一起授予。**
  个人和小团队通常可以免费使用，公司和商业服务可能需要购买 Remotion 的授权，请自行阅读
  [Remotion License](https://www.remotion.dev/license)。
- 识音使用 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)（Apache-2.0）和 SenseVoice 模型，模型**不包含在本仓库中**，
  由 `mw models --fetch` 从 sherpa-onnx 的发布页下载，请遵守模型自身的协议。
- 默认字体阿里巴巴普惠体**不包含在本仓库中**，请从官方渠道下载，并遵守其使用协议。
