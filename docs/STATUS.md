# 进行中的事

几个 AI 同时开发时用这张表对齐进度，规则见 `AGENTS.md` 第 7 节。
开工前先读；接手一件事先占一行；做完、合进 dev 后删掉这一行。已完成的事看 git 记录和 `docs/decisions/`。

| 事项 | 谁在做 | 目录 / 分支 | 状态 | 下一步 / 卡在哪 |
|---|---|---|---|---|
| 阶段 E：卡片框架、封面、默认片尾、编排规则（0021） | Claude | `media-workspace` / dev | 四个 AI 一句话验收完成，验收发现的问题已修（0024） | 先不合 main，阶段 F 验收后一起由 dev 开 PR |
| 阶段 F：账号版式、识音出字幕 + 文稿校字、字幕按词换行、`mw frame`（0025） | Claude | `media-workspace` / dev | 版式格式已合（887ce5b） | 下一步 mw transcribe、文稿校字 |
| 按音频静音剪停顿；`mw compare` 和参考成片对比（0025） | Codex | `media-workspace-codex` / `feat/silence-compare` | 开工 | — |
| 工作台编辑、保存账号版式和参考线（0025） | Claude | `media-workspace` / dev | 排队 | 在识音、校字之后做 |
| 量用户成片：字幕每行字数、断行、人物位置、标题条和字幕位置（0025） | Grok | `media-workspace/local/notes/`，不用分支 | 开工 | — |
| 声音分离可行性实验（0015 第 6 条） | Grok | `media-workspace/local/notes/`，不用分支 | 实验做完，结论：先不做 | 这段样片没有背景音乐，测不出分离效果；要有带背景音乐的样片再复测 |
| 审查、合并各分支，跑全部测试 | Claude | `media-workspace` / dev | 持续 | 各分支做完后通知 |
