# 进行中的事

几个 AI 同时开发时用这张表对齐进度，规则见 `AGENTS.md` 第 7 节。
开工前先读；接手一件事先占一行；做完、合进 dev 后删掉这一行。已完成的事看 git 记录和 `docs/decisions/`。

| 事项 | 谁在做 | 目录 / 分支 | 状态 | 下一步 / 卡在哪 |
|---|---|---|---|---|
| 审查、合并各分支，跑全部测试 | Claude | `media-workspace` / dev | 持续 | 各分支做完后通知 |
| 第三轮：裁切界面（预览里拖裁切框、选中框按裁切后的范围），之后画幅 9:16 / 16:9 | Claude | `media-workspace` / dev | 进行中 | 核心几何用 `core/crop.ts` 的 `cropLayout` |
| 第三轮第 4 批：时间线（视频块分三层、锁定封条、拖动调层级、「＋」新增轨道、去横线、工具栏变矮、方向键微调） | Grok 4.7 | `media-workspace-grok` / `feat/r3-timeline-2` | 进行中 | 任务见 `local/notes/2026-11-01-round3/PLAN.md`（主目录） |
