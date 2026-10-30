# 0011：阶段 C 收窄范围，先做样式模板库

日期：2026-10-29。修订 PLAN 阶段 C 的范围和验收。

## 背景

阶段 B 收尾时定了方向：手动环节够用就行，精力放在 AI 能用的能力上。
对照 PLAN 阶段 C 的清单检查现有代码，发现大部分已经在阶段 A / v0.7 做掉了：

- 高亮方式 `keyword / current / trail / sweep`、荧光笔 `marker`、关键词放大和强调动画（`highlight.anim`）；
- 逐字 / 逐词 / 整行出现，节奏 `spread / eachMs / totalMs`，识音后跟着语音走；
- 字幕快剪的操作：`caption.remove / merge / split`、`cut.removeCaptions`、`cut.removePauses`，AI 已经能直接用。

真正缺的是**模板库**：样式只能存在单个工程里，换一个工程就要重新编排。

## 决定

1. **样式模板库**（本次完成）：`~/MediaWorkspace/library/text-styles/<名字>.json`，
   内容是 `{ name, description, savedAt, style }`。内置样式（`caption-word-yellow`、`title-bar-yellow`）
   也列在库里，但不能覆盖、不能删除。
   - 套用模板 = 把样式复制进 `project.styles`（一次 `style.add`），之后模板改了旧工程不受影响（PLAN 5.1）。
     所以**工程格式不变**。
   - CLI：`mw styles`（列出）、`mw styles save <工程> <样式> [--as 名字] [--desc 说明] [--overwrite]`、
     `mw styles use <工程> <模板> [--as 样式 ID]`、`mw styles remove <模板>`。
   - MCP：`styles` 工具，`action = list / save / use / remove`；`guide` 里加了一条用法。
   - 界面：左栏「样式」页分「本工程」和「模板库」两段；本工程的样式可以一键存为模板
     （内置样式改过之后存成 `<名字>-mine`），模板库里的样式点「加入工程」。
   - 标题和字幕共用同一个 `TextStyle`，所以字幕模板库（F13）和标题模板库（F14）是同一个库。
2. **字幕快剪视图（F11）不做界面**：删句、合并、去停顿都是批注交给 AI，AI 用现有操作完成。
3. **样式编辑面板（F5）不做**：细节编排交给 AI（改 `style.update`），界面只负责挑选、套用、存模板。
4. 阶段 C 剩下的事，按顺序：
   1. 逐字出现的动画更顺滑（阶段 A 验收时提出）。需要先用样片对比，找出哪里不顺，再改 `core/animate`。
   2. 当前词色块 `activeBox`、下划线、渐变、发光：要改 `TextStyle`，属于格式变更（v5），按 AGENTS.md 第 6 条做。
   3. `docs/orchestration-guide.md` 第一版：给 AI 的编排和自查流程。

## 验收（替换 PLAN 阶段 C 原来的验收）

1. 在一个工程里编排一个字幕样式，存进模板库；在另一个工程里套用，预览和导出效果一样。（已通过单元测试和 CLI 实测）
2. AI 按批注删句、合并、去停顿后，导出成片的剪辑点正确。
3. 逐字动画用样片对比，用户认可顺滑。
