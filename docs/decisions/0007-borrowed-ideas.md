# 0007：借鉴同类项目的几个做法（工程格式 v3）

日期：2026-10-28

## 背景

用户转来一份「AI 剪视频技能」的调研，问有没有参考价值。逐个看过之后，挑出和本项目方向一致、能直接落地的几点，
趁界面（阶段 B 网页部分）还在做的时候先放进内核。

| 项目 | 协议 | 结论 |
|---|---|---|
| Remotion Koubo（口播模板） | CC BY-NC | **只借思路，不用代码**。场景写成代码、用 SRT 驱动、有增量渲染；几何断言式质检值得借鉴 |
| Ghost Editor | MIT | 字幕 / 叠加层避开人脸 |
| Open Edits | MIT | 卡拉 OK 式逐字扫色 |
| Barty-Bart motion-graphics | MIT | MG 组件分类，留给阶段 E 参考 |
| wjs-overlaying-video | MIT | 叠加层按字出现 |
| HyperFrames | Apache-2.0 | HTML 帧渲染引擎，记作 Remotion 之外的备选 |
| Video Alchemy、Claude Video Skills | — | 没找到可核实的仓库，不采用 |

本仓库是 MIT 协议，CC BY-NC 的代码不能进来；上表的 MIT 项目也只参考做法，没有复制代码。

## 决定

1. **叠加层按字锚定**（工程格式 v3）：`at: { caption, char, offsetMs }`，念到这句字幕第 `char` 个字（码点下标）时出现。
   - 有 `charStartMs`（`mw align`）时用识音时间，没有时按字数在整句里平均估算。
   - 这个字被剪掉时退回到整句开始，并给出 `ANCHOR_CUT` 警告；`char` 超出句子长度是 `TIME_RANGE` 错误。
   - 口播里「说到某个词，卡片弹出来」是最常见的需求，按字锚定之后剪切、变速都不用改。
2. **两种新的高亮方式**：
   - `highlight.mode: "sweep"`：卡拉 OK 式，颜色按念字进度从左往右扫过（逐字时间来自 `charStartMs`）。
   - `highlight.marker`：关键词下面画荧光笔色带，`drawMs` 内从左往右画出来，高度按字号比例（默认 0.45）。
3. **质检 `mw lint`**（`core/lint.ts`，纯函数）：不看像素，按工程数据估算每个元素在画面上占的区域。
   - `TEXT_TOO_SMALL`：字号小于 40（按 1080 宽）。
   - `TEXT_OUTSIDE_SAFE_AREA`：文字超出平台安全区，写明哪一边超了多少像素；字幕按样式合并，同一样式只报一条。
   - `CAPTION_OVERFLOW`：字幕估计要排的行数超过样式的 `maxLines`。
   - `OVERLAP`：同时出现的元素位置重叠（至少一方是文字）。
   - `FACE_COVERED`：每 0.5 秒取一次人脸，按主轨片段的缩放、位移换算到画面上，被盖住超过 25% 就报。
   - 文字宽度按「中文一个字号宽、其他 0.55 个」估算，不测字体；都是警告，不阻止导出。
   - 模板通过 `TemplateEntry.bounds` 声明自己占的区域（标题条：文字 + 底色横条）；没声明的模板不参与检查。
   - 样片 1029 上实测报出两条，都属实：标题条文字顶到 y≈129（安全区上边是 180），字幕满行时右边超出 8px。
4. **人脸检测 `mw faces`**（`node/faces.ts`）：用 macOS 自带的 Vision 框架，一段 Swift 脚本第一次运行时用 `swiftc`
   编译到 `~/MediaWorkspace/tools/`。从预览代理每 0.5 秒取一帧，结果存成 `cache/media/<指纹>.faces.json`，
   路径通过新操作 `asset.cache` 写进 `asset.cache.faces`。导入视频时自动检测。
   - 不引入模型和新依赖；其他系统上跳过（`skipped`），lint 里列出 `noFaceData`。
   - 样片 34 秒素材检测约 5 秒，68 个采样都检测到人脸。
5. **导入时检查烧录字幕**：导入视频时从 25% / 50% / 75% 三个位置各取画面下半部分，拼成一张
   `cache/media/<指纹>.subcheck.jpg`。MCP 的 `import` 直接把这张图返回给 AI，让 AI 看一眼素材里是否已经有字幕
   （有的话再叠字幕会重复）。不做 OCR。
6. **先列方案再动手**：`mw guide` 的规则里写明，较大的改动先列方案（剪哪里、加什么、用什么样式）给人确认；
   提交之后跑 `mw lint`。

接口：CLI `mw lint` / `mw faces`，MCP 工具 `lint` / `faces`，本地服务 `GET /api/lint`（`LintResponse`，界面可以按 `atMs` 在时间线上标出来）。

## 暂不做

- **增量渲染**（只重渲改动过的片段再拼接）：Remotion Koubo 按场景分段缓存。本项目的叠加层、字幕跨越剪辑点，
  转场也要两边的画面，分段边界不好定；现在单条 30 秒成片导出几十秒，还不是瓶颈。等阶段 D 有转场之后再评估。
- **HyperFrames 作为备选渲染引擎**：`compile` 输出的 `ResolvedTimeline` 就是渲染层的边界（PLAN 第 9 节），
  如果以后 Remotion 的授权或速度出问题，再评估换成 HyperFrames。
- **MG 卡片分类**：放到阶段 E，和第一批 MG 模板一起做。
