# 0003：参考 Hypit 和 OpenMontage 的设计

日期：2026-10-28 · 状态：已采纳（用户同意）

## 背景

用户让评估两个项目对本项目有没有参考价值：

- [hypit-ai/hypit](https://github.com/hypit-ai/hypit)：TypeScript。AI 写一种专门的标记语言（SVML），调用生成模型和逐词对齐，在无头浏览器里渲染，批量模仿爆款视频。
- [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) 的 `motion-graphics` 技能：Python 编排，用网页加 GSAP 做 10 秒以内的动态图形。

## 协议

- Hypit：改过的 Apache 2.0，衍生作品必须沿用同一协议，且不能商业分发。和本仓库的 MIT 不兼容。
- OpenMontage：AGPL-3.0，和 OpenChatCut 一样（D1）。

**结论：两个项目都只借鉴设计思路，不复制代码、文档和 schema 原文。**

## 采纳的思路

| 来源 | 思路 | 落在哪里 |
|---|---|---|
| Hypit caption-fine | 不认识的样式属性直接报错 | D25：工程格式严格校验（阶段 A） |
| Hypit 字体 | 字体必须对应具体文件，带后备字体，不退回系统字体 | D26：字体栈（阶段 A） |
| Hypit caption-fine | 字幕提前出现、延后消失，相邻字幕直接切换或允许重叠 | TextStyle `timing`（阶段 A 加字段，阶段 C 做界面） |
| Hypit caption-fine | 高亮方式（只亮当前 / 念过的留亮）、当前词色块、下划线、渐变、发光 | 阶段 C |
| Hypit Studio | 样式属性按「位置、外观、时间」分组，面板按分组自动生成 | 阶段 C 样式面板 |
| Hypit Studio | 拖动规则：移动保持时长；拖开头保持结尾；拖结尾保持开头；一次拖动一次提交 | 阶段 B，core 纯函数 |
| OpenMontage | 动画分入场、强调、出场；每个动画标注情绪 | PLAN 5.4 动画预设库；`mw guide` |
| OpenMontage | MG 按内容分类（数字、图表、金句、人名条、新闻卡片、标志） | 阶段 E 第一批模板 |
| OpenMontage | AI 先列方案再动手；渲染后自查，只修一轮，修的时候不改时长 | 阶段 C `docs/orchestration-guide.md` |

## 不采纳

- Hypit 的标记语言、构建图、模型服务接入、生成模型流程：和「剪映式编辑 + AI 改同一份工程」的定位不同，也违反 v1 非目标。
- OpenMontage 的 HTML + GSAP 渲染：已经选定 Remotion（D2）。
