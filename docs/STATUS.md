# 进行中的事

几个 AI 同时开发时用这张表对齐进度，规则见 `AGENTS.md` 第 7 节。
开工前先读；接手一件事先占一行；做完、合进 dev 后删掉这一行。已完成的事看 git 记录和 `docs/decisions/`。

| 事项 | 谁在做 | 分支 | 状态 | 下一步 / 卡在哪 |
|---|---|---|---|---|
| 阶段 C 验收 | Claude | dev | 自测通过（`docs/decisions/0014`） | 等用户在审片台看样片验收工程，确认后开 PR 合到 main |
| 右栏 · 字幕属性：常用参数、编辑范围、存为模板、动画选择；标题 / 卡片的样式参数（0015） | Codex | `feat/caption-inspector` | 未开工 | 只改 `inspector/caption.tsx`、`inspector/overlay.tsx`，需要的新文件放 `inspector/` 下 |
| 右栏 · 项目概览、主视频变速和音量、图片变换和入场出场动画（0015） | DeepSeek 4.1f | `feat/media-inspector` | 未开工 | 只改 `inspector/clip.tsx`、`inspector/image.tsx`，新建 `inspector/project.tsx` |
| 声音分离可行性实验（0015 第 6 条） | Grok | 不用分支 | 未开工 | 结果写 `local/notes/<日期>-voice-separation/`，不改仓库代码 |
| 全部字幕列表里逐句标高亮 | Claude | dev | 未开工 | `inspector/caption-list.tsx` |
| 恢复这一刀（剪辑点上恢复被剪掉的一段，字幕从历史里找回） | Claude | dev | 未开工 | core / node / 时间线剪辑标记 |
| 审查、合并各分支，跑全部测试 | Claude | dev | 持续 | 各分支做完后通知 |
