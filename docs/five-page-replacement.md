# 五页面替换开发计划

> 状态：执行中（2026-11-09）。基线 `0963a01`。
> 设计稿只在本机下载目录，不进入仓库，不放进 `docs/`。
> 本文件是这五页的执行计划。产品总计划仍以 `docs/PLAN.md` 为准。

把下载文件夹中的五份 HTML 设计稿转成真实 React 页面。设计稿只提供外观和交互参考。真实数据继续来自工程、Store、API、Remotion 和时间线。

| 页面 | 设计稿 | 落点 |
|---|---|---|
| 播放器 V7 | `~/Downloads/播放器_浅色精简版_V7.html` | 中央播放器外观和控件 |
| 字幕属性面板 V2 | `~/Downloads/字幕属性面板_静态设计稿_V2.html` | 字幕检查器 |
| 标题属性面板 | `~/Downloads/标题属性面板.html` | 标题 / 卡片检查器 |
| 视频属性面板 V1 | `~/Downloads/视频属性面板_静态设计稿_V1.html` | 视频片段检查器中的裁切、变速、音量 |
| 默认项目属性面板 V1 | `~/Downloads/默认项目属性面板_静态设计稿_V1.html` | 无选中时的项目属性 |

2026-11-09 已确认这五个文件都能在本机打开（HTML 以 `<!doctype html>` 开头）。播放器稿 274 行，其余四份 100–154 行。播放器稿内嵌了示例静帧，体积大，仍然只留在下载目录。

## 执行约束

这些约束在写页面之前就已经核对过，后续批次都要遵守。

1. 不开 GitHub PR。每一批走：功能分支 → 审查 → 合入 `dev` → 删除该工作分支。
2. 每一批使用独立工作目录（git worktree）和独立分支。`docs/STATUS.md` 只在主目录 `media-workspace` 里改。
3. 主目录 `media-workspace` 当前停在 `dev` / `0963a01`，工作树有未提交改动（`AGENTS.md`、`docs/PLAN.md`、`docs/STATUS.md`、`docs/orchestration-guide.md`、`stage.tsx`、`timeline.tsx`、`top-bar.tsx`、`store.ts`、`styles.css`，以及未跟踪的 `.vscode/`、`docs/opentake-standard-comparison.md`）。这些改动属于正在进行的其他事项，本计划不暂存、不丢弃、不放进自己的提交。
4. 因此字体合入和页面替换都在新工作目录里做，从已提交的 `dev` 拉分支。合回 `dev` 时，主目录必须能接受这次合并，且不能覆盖上述未提交文件。主目录还脏着时，不在主目录执行 `git merge`。
5. 页面替换不修改原始素材，不修改工程格式。`src/core/schema.ts`、`src/core/ops.ts`、`src/core/compile.ts` 默认不动。确有字段不够时，先在 `docs/STATUS.md` 登记高风险任务，再改格式、迁移和测试。
6. 界面改工程的唯一路径：本地草稿 → 现有助手（`caption.update`、`item.update`、`styleEditOps`、`planAspect`）→ `useStore.getState().submit(ops, label)` → `POST /api/ops`（带 `baseRevision`）→ revision / history → SSE `/api/events`。不直接写 `project.json`。
7. 只属于界面会话的状态留在组件里：滚动、页签、未提交输入、悬停、循环播放。循环播放不写入 `project.json`。「不再提醒」只写入 `editor.json`。
8. 新样式挂在 `.mw-player-v7`、`.mw-inspector-*` 或 CSS Module 下面。不新增裸的 `.panel`、`.tabs`、`.stage`、`.footer`、`.btn`，这些类名已经在工作台里使用。
9. 播放器强调色用设计稿浅色主题的 `#7054f6`。检查器暖橙用设计稿的 `#e9a33c` 一带。两套颜色各自保留。
10. 内容字体走现有字体加载。不把青鸟华光打进包，也不把它写成已授权。
11. 预览和导出继续共用 `Main`（`src/node/render.ts`）。不换成设计稿里的 `<video>`，不用 iframe，不复制设计稿里的示例数组和独立计时循环。
12. 测试只用临时 `MW_HOME`。不写 `~/MediaWorkspace/projects/`。
13. 每批完成前按改动范围跑命令，并如实记录哪些通过、哪些没跑。涉及播放器、字体、媒体、模板或渲染时跑 `pnpm test:e2e`。涉及网页时再跑 `pnpm web:build`。
14. 设计稿里点了没有真实效果的控件，显示「未支持」「当前只读」或「需要单独扩展」，并禁用。不做假开关。

## 批次登记

每一批开始前，在主目录 `docs/STATUS.md` 占一行，写明：

- 事项名称
- 执行人
- 工作目录
- 分支
- 独占文件
- 验收标准
- 当前阻塞点

合入 `dev` 并删掉工作分支之后，删掉这一行。下一批开始前再占下一行。`STATUS.md` 里已有未提交的其他行，本计划的提交不能把那些行一起提交。

## 阶段 0：基线和字体策略

### 目标

固定开发基线，先让字体策略进入后续批次使用的分支，避免页面替换和字体改造同时改同一批文件。

### 字体提交审查（2026-11-09）

`4d5f8f1` 是 `e22d17e` 的祖先，`e22d17e` 是 `0d30654` 的祖先，`0963a01` 是 `0d30654` 的祖先。本地与 `origin` 分支名为 `codex/font-authorization-clearance`，已检出在 `media-workspace-font-audit`。那个目录已被该分支占用，不在那里提交。

`0963a01..0d30654` 共 5 个提交、24 个文件、+1229/−93。不改 `schema.ts`、`ops.ts`、`compile.ts`，不改工程格式，不改原始素材。

| 提交 | 内容 | 审查结论 |
|---|---|---|
| `ca7748e` | 运行时索引项目字体和系统字体 | 后两个提交的前置，必须一起带上 |
| `0c2a122` | 字库键带上来源 | 同上 |
| `4d5f8f1` | 只改 `docs/STATUS.md` 一行 | 记录字库清单完成，无运行时行为 |
| `e22d17e` | 缺字体改为非阻塞 | 改字体解析、渲染、lint、store；缺字体不再挡住预览 |
| `0d30654` | 字体授权清理流程 | 新增 `font-warning-modal.tsx`，并改样式编辑器、顶栏、store、样式 |

与主目录未提交文件重叠、因此不能在主目录合并的路径：`docs/STATUS.md`、`docs/orchestration-guide.md`、`src/web/components/top-bar.tsx`、`src/web/store.ts`、`src/web/styles.css`。阶段 1 还会再改 `stage.tsx` 和 `styles.css`，这两份在主目录里同样是脏的。

合入方式：在新工作目录把 `0d30654` 合并进从当前 `dev` 拉出的功能分支。这一次合并包含上表 5 个提交。合并前再看一眼 diff，确认仍然不碰工程格式。

### 阶段 0 命令

在字体合入后的工作目录运行：

```bash
pnpm check
pnpm test
pnpm test:e2e
```

### 阶段 0 结束标准

- 字体策略 5 个提交已经在本批功能分支上，审查结论写在本节。
- 上述测试已跑，结果记在本批提交说明或本地笔记里。
- 五个设计稿都能打开，且没有进入仓库。
- 已确认本计划的页面替换不修改原片，也不修改工程格式。
- 主目录未提交文件保持原样。

合入 `dev` 本身要等主目录能干净接受合并。在那之前，功能分支就是阶段 1 的起点，并在状态表里写明这个阻塞。

## 阶段 1：播放器 V7

### 目标

只改中央播放器的外观和控件。保留 `@remotion/player` 和 `Main`。不新建第二套播放状态。

### 文件

主要修改：

- `src/web/components/stage.tsx`（同一时间只允许一个会话改）
- `src/web/styles.css`（新规则放在 `.mw-player-v7` 下）
- 新增 `src/web/components/player-chrome-v7.tsx`

配合阅读，默认不改行为：

- `src/web/store.ts`
- `src/web/app.tsx`
- `src/web/components/canvas-guides.tsx`
- `src/web/components/crop-editor.tsx`
- `src/web/components/layout-editor.tsx`

现有底栏是 `stage.tsx` 里的 `PlayerFooter`，样式类是 `.player-footer`。在它上面换外观，保留已经接到 Store 的播放 / 暂停。分辨率读数如果 V7 底栏没有位置，就留在播放器状态区，避免画布尺寸从界面消失。

工作目录从已提交代码拉出，不包含主目录里 `stage.tsx` 的未提交删改。那些删改留在主目录。

### 外观

浅色主题（设计稿第 53 行起，V7 在第 182 行）：

- 工作台浅灰底，白色圆角播放器卡片，细边框和轻阴影。
- 画面区浅灰底、小圆角。
- 紫色进度条（`#7054f6`），白色滑块。
- 紫色批注标记，直径约 16px，位于进度条下方并留出空隙。
- 底栏约 108px：播放/暂停、循环、`当前 / 总时长`、批注图钉、全屏。
- 高度适应工作台中间区域。设计稿用 `100dvh` 是因为它自己占满浏览器窗口。工作台内部继续用现有网格的可用高度，不把 `100dvh` 套进中间栏。

### 播放控制

复用 Store：`playing`、`setPlaying`、`frame`、`seek`、`seekNonce`、`timeline.durationInFrames`、`timeline.fps`。时间文字用现有 `timecode()`。

要实现：

- 播放 / 暂停
- 当前时间 / 总时间
- 点击进度条定位
- 拖动进度条定位
- 循环播放，只作为本次界面会话状态
- 全屏
- 保留 `app.tsx` 里已有的键盘快捷键，不再注册第二套全局按键

### 批注

- 标记来自 `review.json` 的真实批注，位置用 `atMs`。
- 点击标记跳到该时间并打开批注。
- 新增批注继续走现有 `addComment()` / `/api/comments`。
- 不复制设计稿里的 `notes` 数组，不复制它的 `requestAnimationFrame` 计时。

### 分割

进度条右键「在此分割」必须调用：

```text
useStore.getState().splitAtPlayhead()
```

调用前先把播放头 seek 到右键处的时间。不能只在 DOM 里画一条橙色竖线。

### 本阶段不做

- 区间批注（设计稿里的 Shift 拖选）
- 把视频拖进预览区并替换当前工程
- 设计稿自己的 `<video>` 和示例静帧
- 第二套键盘事件
- 第二套播放时间状态
- 悬停缩略图。现有工程没有给进度条用的静帧接口，就不做这个预览

### 验收

必须实际看到：

- 竖屏预览、横屏预览
- 播放 / 暂停
- 点击进度条、拖动进度条
- 时间线拖动播放头后，播放器时间跟着走
- 批注标记、新增批注
- 画布点选、裁切
- 全屏、已有快捷键
- 右键分割真的切开片段
- 外部 MCP 修改后页面经 SSE 刷新
- 导出画面与预览一致（同一套 `Main`；抽帧用 `preview` / `renderStill`，本阶段不为了对照而导出完整 MP4，除非这一条验收明确要求成片）

命令：

```bash
pnpm check
pnpm test
pnpm test:e2e
pnpm web:build
```

完成后：截图放在 `local/notes/<日期>-player-v7/`，提交，能合则合入 `dev` 并删除本批分支和状态行。主目录仍脏时，提交留在功能分支，状态行写明未合入原因。

## 阶段 2：视频属性面板和项目属性面板

### 目标

先做数据结构已经明确的视频面板和项目面板。视频面板是现有裁切、变速、音量的外观替换，不是把整个片段检查器换成设计稿。

### 文件

- `src/web/components/inspector/clip.tsx`
- `src/web/components/inspector/project.tsx`
- `src/web/components/inspector/crop.tsx`
- `src/web/components/inspector/anims.tsx`
- `src/web/styles.css`

`clip.tsx` 还负责画中画、画中画动画、主轨转场、视频关键帧和恢复剪切。这些块留在原处，只给裁切、变速、音量换皮。音频片段不显示裁切。

无选中时，`review-sidebar.tsx` 的属性页继续显示项目概览和章节，章节不因这次换皮消失。

默认不改 `schema.ts`、`ops.ts`、`compile.ts`。

### 视频：裁切

复用 `CropField`、`startCrop`、`CropOverlay`、`CropToolbar`、`finishCrop`、`cropAspects`、`cropForAspect`。

比例保留现有六项：自由、画布、9:16、1:1、4:3、16:9，以及重置、在画面中调整。设计稿如果少了「自由」，实现仍然保留它。

规则：

- 裁切比例不是工程画幅。不用 `canvas.update` 代替素材裁切。
- 拖动时只更新草稿，点完成时提交一次。
- 轨道锁定时禁用。
- 素材没有尺寸时显示明确原因（现有 `CROP_DIMENSIONS`），不给一个无效裁切框。

### 视频：变速

复用 `item.update({ speed })`。

- 显示当前倍速。
- 显示变速后的真实时长 `(outMs - inMs) / speed`。
- 新输入保持 schema 的 0.1–10。设计稿滑杆如果只到 0.5–2，不把 schema 收窄。
- 旧工程里超出 0.1–10 的值原样显示，不在打开面板时自动截断。

保持音调：工程里没有对应字段。控件禁用，并写明未支持。不做假切换。

### 视频：音量

复用 `item.update({ gainDb })`。

- 显示真实 dB。
- 滑杆和数字框共用一份草稿。
- 松手、回车或失焦时提交一次。
- 拖动过程中不按像素提交 revision。
- 新输入保持 schema 的 −60 到 +20。设计稿若只画到 +12，不把上限改成 +12。

### 项目面板

可以真实展示，数据来自当前工程和预览，不用设计稿示例：

- 工程名称、工程路径、时长、画布尺寸、比例、帧率
- 素材数量、字幕数量
- 是否有代理缓存

第一版只允许编辑 9:16 和 16:9，调用 `planAspect()`。只改宽高会造成布局错位，所以不这么做。现有 `ASPECTS` 就是这两项；当前比例不是这两项时，显示实际比例并保持只读。帧率是 1–120 的正整数，默认 30，不是 24/25/30/60 的枚举。

以下控件若出现在设计稿里，显示未支持、当前只读或需要单独扩展，并禁用：

- 工程重命名、工程搬迁
- HLG / PQ / HDR、浮点链接、自由层级、全局代理模式
- 时间线名称
- 1:1、4:3、任意分辨率、任意帧率

没有 `colorSpace`、保持音调、重命名操作或工程搬迁 API，就不新增这些字段。

### 验收

- 裁切六种比例（含自由）和重置
- 在画面里调整裁切，拖动不产生多次 revision，完成后一次提交
- 变速、音量
- 锁轨后不能改
- 旧工程超范围倍速或音量不被面板自动改写
- 9:16 与 16:9 互换，撤销后回到原画幅
- 提交失败时输入还在
- MCP 修改后网页同步
- 导出与预览一致

命令与阶段 1 相同：`pnpm check`、`pnpm test`、`pnpm test:e2e`、`pnpm web:build`。

## 阶段 3：字幕属性面板

### 目标

字幕检查器改为四个页：字幕、编辑、样式、动效。真实字幕编辑、样式提交、字幕列表和时间定位都保留。

### 文件

- `src/web/components/inspector/caption.tsx`
- `src/web/components/inspector/text-style-editor.tsx`
- `src/web/components/inspector/caption-list.tsx`
- `src/web/components/inspector/anims.tsx`
- `src/web/styles.css`

建议新增：

- `src/web/components/inspector/caption-tabs.tsx`
- `src/web/components/inspector/font-warning.tsx`
- `src/web/components/inspector/style-scope-control.tsx`

阶段 5 会用到字体分支里已经新增的 `src/web/components/font-warning-modal.tsx`。阶段 3 不另写一套缺字体弹窗。

### 字幕页

显示搜索框、序号、字幕文字、成片时间、当前选中。点击一条就定位到它。

数据来自 `preview.timeline.captions`。时间用编译后的 `c.from`。源时间 `startMs` / `endMs` 不拿来当画面上的时间。不用设计稿里的示例句子。

### 编辑页

支持：文案、字体、字号、字重、填充色、高亮色、字间距、行间距、水平对齐、位置、最大宽度。

规则：

- 输入时只改本地草稿。
- 失焦、回车或确认时提交。Escape 恢复。
- 锁轨时禁用。
- 改字之后，「已对齐 / 估算」必须仍反映真实的 `charStartMs` 状态。
- 文本改变导致逐字时间失效时，明确提醒。

设计稿里的斜体、删除线没有 `TextStyle` 字段，放在样式页的禁用项里，不在编辑页做成有效按钮。粗体对应字重。下划线只在高亮样式已有下划线 / 记号时接通，否则禁用。

### 样式页

可以接到已有字段：

- 描边 `stroke`
- 背景 `box`
- 发光 `glow`（颜色、模糊）
- 阴影 `shadow`
- 填充色上已经表达的透明度（`#RRGGBBAA`）

禁用，因为没有字段或没有实现：

- 整体混合透明度（`TextStyle` 没有 opacity）
- 斜体、删除线
- 背景独立偏移
- 发光角度、发光范围

不能把字幕不支持的透明度写进不存在的字段。

### 动效页

使用 `TextStyle.animation.in`、`out`、`unit`、`stagger`、`inSlot`。

至少支持：

| 设计稿名称 | 写入 |
|---|---|
| 无 | `in = null` |
| 逐词淡入 | `unit: word`，fade 300、ease-out，`stagger: { fraction: 0.75 }`，`inSlot: 0.6` |
| 跟随语音 | `unit: word`，fade 220，`stagger: "spread"`，`inSlot: 0.8`；没有 `charStartMs` 时显示「按句长估算」 |
| 整行淡入 | `unit: line`，fade 200，`stagger: "spread"` |

fade、slide、blur、zoom、bounce 中已经实现的预设可以点。没有实现的预设显示禁用，点击后工程不变。

### 修改范围

三个范围分开：

- 仅当前字幕：`styleEditOps` 的 `item`
- 应用到所有引用同一字幕样式的元素：`shared`
- 全部字幕

`shared` 不是全部字幕。全部字幕要：

1. 收集字幕元素。
2. 排除锁定轨。
3. 先统计并显示影响数量。
4. 一次生成原子 ops。
5. 可以撤销。
6. 失败时不留下部分提交。

## 阶段 4：标题和卡片属性面板

### 目标

标题 / 卡片检查器改为：编辑、标题模板、样式、动效。

### 文件

- `src/web/components/inspector/overlay.tsx`
- `src/web/components/inspector/text-style-editor.tsx`
- `src/web/styles.css`

`src/templates/` 只在现有 props 无法表达设计稿字段时才改。默认不改。

### 模板字段

编辑时保留旧 props，只替换目标字段，经 `item.update` 提交，并用该模板的 schema 校验。

| 模板 | 编辑字段 |
|---|---|
| `title-bar` | `lines[]`（1–3 行） |
| `text-card` | `title`、`body` |
| `quote` | `text`、`source` |
| `bullet-list` | `title`、`items[]`、`atMs` |
| `big-number` | 数字、前缀、后缀、说明 |
| `name-bar` | 按该模板 schema 的字段 |
| `tip-bar` | 按该模板 schema 的字段 |
| `screenshot` | 保留现有图片编辑器 |

禁止 `item.update({ set: { text: ... } })`。Overlay 没有统一的 `text` 字段。

### 标题模板网格

设计稿里的「金黄描边」「暖色标题」「简约白字」等是 `TextStyle` 外观预设，只改样式，不改 `overlay.template`。

如果以后确实要更换结构模板，同一次提交里必须处理：props 转换、原字段保留、schema 校验、旧工程兼容、撤销、导出。本阶段不把网格做成结构模板切换。

样式页和动效页的禁用规则与阶段 3 相同：没有字段就不写。修改范围是「仅当前标题 / 卡片」「同一结构模板」「全部标题」。全部标题同样排除锁定轨、统计数量、一次原子提交。字幕样式不能被这次操作改到。

### 验收

逐个打开并改一个字段：`title-bar`、`text-card`、`quote`、`bullet-list`、`big-number`、`name-bar`、`tip-bar`、`screenshot`。

检查：文字还在，未编辑的 props 还在，字幕样式没被改，卡片遮挡检查不回归，锁轨生效，切换 9:16 / 16:9 后文字仍可读，导出与预览一致。

## 阶段 5：字体和授权提示

依赖阶段 0 已经把字体 5 个提交合进本批分支。先读 `font-warning-modal.tsx`、`text-style-editor.tsx`、`store.ts` 里已有的字体提示，在上面补设计，不另起一套弹窗。

### 字体选择器

显示：项目字体、系统字体、字重、能否用于导出、授权状态。

授权状态只用这四档：已确认、未知、需付费、未登记。

选择器旁必须有这句：「仅供参考，不构成法律意见。」

### 缺字体弹窗

显示：缺哪个字体、受影响的字幕 / 标题 / 模板、实际使用的回退字体。动作是：替换、继续回退、稍后处理。

### 替换

通过 `styleEditOps()`、`style.update`、`useStore.submit()`。支持仅当前元素、当前样式共享，以及撤销和重做。

「不再提醒」只写 `editor.json`，不写进工程渲染数据。

## 阶段 6：整体集成验收

用临时工程，至少包含：主视频、画中画、字幕、标题、卡片、批注、关键帧、转场、片尾、一个缺失字体、一条锁定轨道，以及一次 MCP 外部修改。不用设计稿示例数据，不写用户的 `~/MediaWorkspace/projects/`。

顺序：

1. 打开无选中的项目属性。
2. 选中主视频，测裁切、倍速、音量。
3. 选中字幕，编辑文字。
4. 改字体、字号、颜色。
5. 切换动画。
6. 选择全部字幕并看到影响数量。
7. 选中标题和卡片。
8. 按模板改不同字段。
9. 触发缺字体警告。
10. 选择回退字体。
11. 撤销和重做。
12. 用 MCP 修改同一工程。
13. 确认网页经 SSE 刷新。
14. 锁定轨道后尝试修改，确认被拒绝。
15. 添加批注。
16. 导出 MP4。
17. 抽取关键帧与预览对比。

真实工程命令：

```bash
pnpm mw lint <工程>
pnpm mw preview <工程> --sheet
pnpm mw export <工程>
```

`--sheet` 默认 12 帧。单帧问题用 `preview --at <毫秒>`，不必为此再导出完整 MP4。阶段 6 的第 16 步才导出 MP4。

## 交付标准

五页都落地时必须同时满足：

- 五个 HTML 已转成真实 React 视图。
- 没有 iframe，没有设计稿假数据。
- Remotion 预览仍然有效，预览和导出共用 `Main`。
- 能点的控件都有真实业务效果；不支持的控件明确禁用。
- 工程修改都走 ops，revision、history、undo、redo 还在。
- AI、MCP 和网页改的是同一份工程。
- 锁轨、批注、时间线、片尾、封面、关键帧不回归。
- 真实临时工程有截图和导出抽帧，截图放在 `local/notes/`，不放进 `docs/`。
- 每一批在合入 `dev` 之后才开始下一批。主目录脏文件挡住合并时，停在功能分支并写明阻塞，不把两批叠在一次未审查的大提交里。
- 不创建 GitHub PR。

## 实际顺序

```text
字体策略合入功能分支（阶段 0）
  ↓
阶段 1：播放器 V7 → 审查 → 能合则合入 dev
  ↓
阶段 2：视频 / 项目面板 → 审查 → 能合则合入 dev
  ↓
阶段 3：字幕面板 → 审查 → 能合则合入 dev
  ↓
阶段 4：标题 / 卡片面板 → 审查 → 能合则合入 dev
  ↓
阶段 5：字体弹窗和授权提示
  ↓
阶段 6：临时工程综合验收
```
