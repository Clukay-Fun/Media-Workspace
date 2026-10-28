# Media Workspace

本地运行的 AI 原生口播编排工作台：AI 通过 CLI / MCP 修改结构化工程，人在本地网页里预览、微调、导出。

- 开发计划：[docs/PLAN.md](docs/PLAN.md)
- 开发规范：[AGENTS.md](AGENTS.md)

> 状态：阶段 A 自测通过，等待验收（`dev` 分支）。验收记录见 [docs/decisions/0004](docs/decisions/0004-phase-a-acceptance.md)。

## 本地使用（阶段 A：CLI）

需要 Node 24、pnpm 10、ffmpeg。

```bash
pnpm install
pnpm fonts:check            # 普惠体放进 assets/fonts/alibaba-puhuiti-3/；测试字体用 pnpm fonts:fetch-test 下载
./bin/mw.mjs --help         # 或者 pnpm link --global 之后直接用 mw
./bin/mw.mjs guide          # 给 AI 看的操作和样式说明
```

工程默认放在 `~/MediaWorkspace/projects/`，可以用 `MW_HOME` 修改。

## 授权说明

- 本仓库的代码采用 [MIT 协议](LICENSE)。
- 本项目依赖 [Remotion](https://www.remotion.dev) 渲染视频。**Remotion 有自己的授权条款，不随本仓库的 MIT 协议一起授予。**
  个人和小团队通常可以免费使用，公司和商业服务可能需要购买 Remotion 的授权，请自行阅读
  [Remotion License](https://www.remotion.dev/license)。
- 默认字体阿里巴巴普惠体**不包含在本仓库中**，请从官方渠道下载，并遵守其使用协议。
