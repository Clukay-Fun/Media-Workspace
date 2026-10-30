# 0012：文字装饰——渐变、发光、下划线、当前词色块（格式 v5）

日期：2026-10-30。对应 PLAN 阶段 C「当前词色块、下划线、渐变、发光」（0011 第 4 条第 2 项）。

## 背景

字幕和标题现在只有纯色填充、描边、阴影、背景框，高亮只能换色、放大、荧光笔。
口播常见的几种效果做不出来：正在念的词垫一块底色、关键词下面画线、渐变字、发光字。

## 决定

`TextStyle` 新增 6 个可选字段，默认都是 `null`，旧样式行为不变：

| 字段 | 作用 |
|---|---|
| `gradient: { colors: [2–4 个颜色] }` | 文字用竖直渐变代替 `fill`（`fill` 仍是卡拉 OK 扫色时没念到的颜色） |
| `glow: { color, blur }` | 文字外面一圈柔光 |
| `highlight.underline: { color, thickness, offset, drawMs }` | 关键词出现时，在字下面从左往右画一条线；`thickness`、`offset` 按字号的比例算 |
| `highlight.activeBox: { color, radius, padding: [上下, 左右] }` | 当前词色块：正在念的那个字 / 词（按 `animation.unit`）后面垫一块底色，任何 `mode` 都生效 |
| `highlight.gradient` | 高亮的字用渐变代替 `highlight.fill` |
| `highlight.glow` | 高亮的字发光 |

渲染（`composition/TextBlock`）：

- 荧光笔、下划线、色块画在文字后面的同一个装饰层上，跟文字用同一套逐字变换，所以放大、弹出时一起动。
- 色块按字号定高、对齐行框中心；一个词里的几个字各画一段，只有头尾留边距和圆角，相邻的多盖 0.5px 避免出现缝。
  用 DOM 拼而不是量字宽，渲染保持纯函数（AGENTS.md 3.4）。
- 渐变只做竖直方向：逐字渲染时每个字是一个 span，各自画一遍渐变，水平渐变会每个字重复一次。
- 发光用两层 `drop-shadow` 叠出来（中间亮、外面柔），画在最外面一层：有描边时在描边层，没有描边时在文字层。
- 色块和下划线不参与 lint 的文字框估算，色块的边距很小，影响可以忽略。

格式：`PROJECT_FORMAT_VERSION` 4 → 5，迁移只改版本号（新字段都是可选的，`TextStyle` 解析时补默认值）。

界面：不加编辑控件（0011：样式细节交给 AI）。左栏样式色卡会显示渐变和发光。
AI：`mw guide` 的 `textStyle` JSON Schema 自动带上新字段，`rules` 里加了一条用法。

## 验证

- `composition/TextBlock.test.tsx`：色块只跟当前字、下划线按进度画、渐变、发光的层级。
- `migrations` 测试：v4 工程升到 v5 样式原样保留。
- 用 Noto Sans SC 渲染截图检查四种效果同时开启时的样子（不进仓库）。
