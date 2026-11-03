# 进行中的事

几个 AI 同时开发时用这张表对齐进度，规则见 `AGENTS.md` 第 7 节。
开工前先读；接手一件事先占一行；做完、合进 dev 后删掉这一行。已完成的事看 git 记录和 `docs/decisions/`。

| 事项 | 谁在做 | 目录 / 分支 | 状态 | 下一步 / 卡在哪 |
|---|---|---|---|---|
| 审查、合并各分支，跑全部测试 | GPT Sol | `media-workspace` / dev | 持续 | 各分支做完后通知 |
| 第三轮：用新样片走一遍全流程验收，验收通过后合并 dev → main（裁切、画幅已完成） | GPT Sol | `media-workspace` / dev | 进行中 | 画幅见 docs/decisions/0030 |
| 阶段 G：MCP 可见制作流程、文字方案审定与 Codex/DS 验收 | GPT Sol | `media-workspace` / dev | 双客户端 MCP 实测及网页自动刷新独立核查完成；阶段 G 仍进行中 | Codex revision 11、DS revision 10 均保留人工历史且未导出 MP4；Sol 用独立临时工程实测 MCP 改画幅后 Chrome 审片台无需重载即更新并显示 AI 改动提示。DSH 自身没有浏览器控制工具，不能由 DS 目视。`caption.reflow` 重复 ID 已在工作区修复，通过 `pnpm check`、362 个单测及 DS 只读审查；待相关代码与文字分支整合。记录见本地 `2026-11-03-g-codex-mcp-test/`、`2026-11-03-g-dsh-mcp-test/` |
| 阶段 G：字幕与标题样式选择、预览及 1029 实片核对 | DeepSeek | `media-workspace-deepseek` / `feat/phase-g-text-style` | Sol 审查通过，待提交 | 搜索同类限制和 16:9 真实行宽已复核；提交前复跑 `pnpm check`、366 个单测、16 个 e2e 均通过。等负责人明确要求提交后合入 dev；字体核查由 Luna/Grok 分担、Sol 复核 |
| 阶段 G：其余字体商用授权证据 | Grok | `media-workspace` / dev；`local/notes/2026-11-03-font-audit/` | 补核报告已交，未闭环项保留未知 | `authorization-followup.md` 已记录版本、官方来源和未解决项；11 家族证据闭环，其余 22 家族至少一项未知；待公开清单合入后释放此行 |
| 阶段 G：字体授权公开清单 | GPT Luna；GPT Sol 复核 | `media-workspace` / dev；`docs/font-licenses.md` | 33 家族清单已交，Sol 复核通过，待提交 | ID 与源码 33/33 对齐；授权和缺字分离、未知项明确。Sol 已补两条 Wayback 存档链接、Fandol COPYING 链接，并澄清合集目录来源；`git diff --check` 通过，待负责人明确要求提交 |
