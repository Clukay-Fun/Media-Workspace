# 进行中的事

几个 AI 同时开发时用这张表对齐进度，规则见 `AGENTS.md` 第 7 节。
开工前先读；接手一件事先占一行；做完、合进 dev 后删掉这一行。已完成的事看 git 记录和 `docs/decisions/`。

| 事项 | 谁在做 | 目录 / 分支 | 状态 | 下一步 / 卡在哪 |
|---|---|---|---|---|
| 审查、合并各分支，跑全部测试 | Claude | `media-workspace` / dev | 持续 | 各分支做完后通知 |
| 第三轮第 3 批：属性栏重排（字幕属性、动画选项卡、关键帧说明，去掉锁定 / 质检 / 出现时间箭头，侧栏常驻） | Gemini 3.8 | `media-workspace-gemini` / `feat/r3-inspector-2` | 进行中 | 任务见 `local/notes/2026-11-01-round3/PLAN.md`（主目录） |
| 第三轮第 6 批：画面裁切，工程格式 v8（schema、迁移、渲染、MCP） | GPT-6 Luna（Codex） | `media-workspace-codex` / `feat/r3-crop` | 进行中 | 同上 |
| 第三轮第 1 批：时间线（字幕拖动不重叠、删除按钮和右键菜单、片段倍速显示） | Grok 4.7 | `media-workspace-grok` / `feat/r3-timeline` | 进行中 | 同上 |
