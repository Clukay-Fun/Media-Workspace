# 进行中的事

几个 AI 同时开发时用这张表对齐进度，规则见 `AGENTS.md` 第 7 节。
开工前先读；接手一件事先占一行；做完、合进 dev 后删掉这一行。已完成的事看 git 记录和 `docs/decisions/`。

| 事项 | 谁在做 | 目录 / 分支 | 状态 | 下一步 / 卡在哪 |
|---|---|---|---|---|
| 阶段 C 验收 | Claude | `media-workspace` / dev | 自测通过（`docs/decisions/0014`） | 等用户在审片台看样片验收工程，确认后开 PR 合到 main |
| 右栏 · 字幕属性：常用参数、编辑范围、存为模板、动画选择；标题 / 卡片的样式参数（0015） | Codex | `media-workspace-codex` / `feat/caption-inspector` | 审查后返工（PR #1） | 要改：取色器拖动时每一下都提交一次；数字框按 Esc 会提交。改完再审 |
| 声音分离可行性实验（0015 第 6 条） | Grok | `media-workspace/local/notes/`，不用分支 | 待用户试听 | 笔记在 `local/notes/2026-10-30-voice-separation/`，请听 `audio/` |
| 审查、合并各分支，跑全部测试 | Claude | `media-workspace` / dev | 持续 | 各分支做完后通知 |
