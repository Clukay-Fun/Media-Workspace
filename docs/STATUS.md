# 进行中的事

几个 AI 同时开发时用这张表对齐进度，规则见 `AGENTS.md` 第 7 节。
开工前先读；接手一件事先占一行；做完、合进 dev 后删掉这一行。已完成的事看 git 记录和 `docs/decisions/`。

| 事项 | 谁在做 | 目录 / 分支 | 状态 | 下一步 / 卡在哪 |
|---|---|---|---|---|
| 审查、合并各分支，跑全部测试 | GPT Sol | `media-workspace` / dev | 持续 | 各分支做完后通知 |
| 第三轮：用新样片走一遍全流程验收，验收通过后合并 dev → main（裁切、画幅已完成） | GPT Sol | `media-workspace` / dev | 进行中 | 画幅见 docs/decisions/0030 |
| 阶段 G：MCP 可见制作流程、文字方案审定与 Codex/DS 验收 | GPT Sol | `media-workspace` / dev | 已合入 dev，待负责人决定是否进入 main | Codex revision 11、DS revision 10 均保留人工历史且未导出 MP4；Chrome 临时工程验证 MCP 提交后网页无需重载即更新。文字分支与 `caption.reflow` 修复已合入 dev，`pnpm check`、366 单测、16 e2e、`pnpm web:build` 通过；DS 工作树与分支已清理，本地验收笔记已保留。字体 33 家族清单已入 dev，22 家族仍有未知授权项，不能当作商用结论。记录见本地 `2026-11-03-g-codex-mcp-test/`、`2026-11-03-g-dsh-mcp-test/` |
