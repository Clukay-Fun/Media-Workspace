# 写卡片模板

给写模板的 AI 和开发者看。格式和渲染规则见 `docs/decisions/0022`，所有模板都要遵守 AGENTS.md 规则 4（纯函数）。

## 目录

每个模板一个目录 `src/templates/<name>/`：

| 文件 | 内容 |
|---|---|
| `schema.ts` | props 的 zod schema（`z.strictObject`），类型用 `z.infer` 推导 |
| `layout.ts` | 排版：卡片区域、每段文字的样式（位置、字号）。组件和 bounds 都调它 |
| `component.tsx` | React 组件，只读 `TemplateProps` 和 `frame` |
| `bounds.ts` | 质检用的占位：`text`（文字框）和 `shapes`（底板等） |
| `meta.ts` | `TemplateMeta`：名字、说明、默认样式、尺寸、气质、`useFor`、`example` |

写完在 `src/templates/index.ts` 的 `TEMPLATES` 里注册；用到图片素材的，再写 `assets: (props) => [素材 ID]`。
参考 `text-card`。

## 尺寸

- `meta.sizes` 列出支持的尺寸。卡片的叠加层必须写 `size`（校验会查），`sizes` 为空的模板（标题条）不是卡片。
- 有卡片时字幕自动隐藏，卡片不用给字幕让位置。
- `small`：一块小卡（`cardBox("small")`，64%–84% 高度）；人名条这类矮的卡在这个区域里自己定高度。
- `half`：下半屏（52%–92% 高度），出现时主画面自动上移 180px（竖屏），模板不用管。
- `full`：整个画面，盖住标题条，底板要不透明。
- 字号、字数上限按 `docs/decisions/0022` 的表（1080×1920 时的像素）；实际像素一律用 `cardPx(px, width, height)`
  （或 `cardScale` 乘上去），不要自己写 `width / 1080`：它会乘统一的放大倍数，横屏也不会翻倍。字数上限写进 schema（`.max()`）。
- 组件从 `size` 拿到实际尺寸，用 `cardBox(size, width, height)` 算区域，不要自己写死像素。画布可能是竖屏也可能是横屏。

## 文字和动画

- 文字用 `TextBlock`，样式先过 `inCard(style, box, width, at)` 放进卡片，再按需要改字号、`maxLines`。
  字幕的逐字动画、高亮、描边都能直接用。
- 外框用 `CardFrame`：底板 + 统一的进出场（`enterFrom: "bottom"` 默认，`"left"` 从左滑入）。卡片内容放在它的 children 里一起动。
- 自己的动画按 `frame` 算（`ms = frame * 1000 / fps`），缓动用 `core/animate` 的 `ease`。
  不要用 `Math.random()`、`Date.now()`、CSS 动画、`useEffect`。
- 数字滚动、逐条出现这类动画，时长按 `durationInFrames` 留出退场的 200ms。

## 图片素材

props 里写素材 ID（比如 `image: "shot1"`），注册时 `assets: (p) => [p.image]`，组件里 `src(p.image)` 拿到地址，
用 Remotion 的 `<Img>` 画。没拿到地址（`undefined`）时不画图，不要报错。

## 测试

- 注册后 `pnpm test` 会自动跑通用检查（`templates/index.test.ts`）：meta 写全、`example` 能通过 schema、占位在画布里。
- 有自己的排版逻辑（比如条数多了换小字号）时，在模板目录里加 `layout.test.ts`。
- 改完跑 `pnpm test:e2e`，再用 `mw preview` 截几帧，竖屏 1080×1920 看小、半、全三种尺寸。
