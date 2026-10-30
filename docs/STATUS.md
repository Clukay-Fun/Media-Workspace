# 进行中的事

几个 AI 同时开发时用这张表对齐进度，规则见 `AGENTS.md` 第 7 节。
开工前先读；接手一件事先占一行；做完、合进 dev 后删掉这一行。已完成的事看 git 记录和 `docs/decisions/`。

| 事项 | 谁在做 | 目录 / 分支 | 状态 | 下一步 / 卡在哪 |
|---|---|---|---|---|
| 阶段 D 第二批：图片和画中画循环动画（格式 v6，0017） | Claude | `media-workspace` / dev | 进行中 | — |
| 阶段 D 第二批：转场界面（0017） | Codex | `media-workspace-codex` / `feat/transition-ui` | 待开工 | — |
| 声音分离可行性实验（0015 第 6 条） | Grok | `media-workspace/local/notes/`，不用分支 | 实验做完，结论：先不做 | 这段样片没有背景音乐，测不出分离效果；要有带背景音乐的样片再复测 |
| 审查、合并各分支，跑全部测试 | Claude | `media-workspace` / dev | 持续 | 各分支做完后通知 |
