# AGENTS.md：本仓库的开发规范

本文件写给在本仓库里**写代码**的 AI（Codex、Claude Code 等）和人类开发者。
（给 AI **操作工作台、编排视频**用的规则在 `docs/orchestration-guide.md`，和本文件是两回事。）

总体计划见 `docs/PLAN.md`。不确定的地方以 PLAN.md 为准，PLAN.md 也没写的，先问再做。

## 1. 环境与版本

| 项目 | 规定 |
|---|---|
| Node | 24.x（`.nvmrc`，`engines: ">=24 <25"`） |
| 包管理 | pnpm 10（在 `packageManager` 字段里锁定版本）。不要用 npm、yarn、bun 安装依赖 |
| 依赖版本 | 全部**精确锁定**（`.npmrc`：`save-exact=true`）。所有 `remotion` 和 `@remotion/*` 包必须是同一个版本，升级时一起升 |
| TypeScript | 7.x，`strict` + `noUncheckedIndexedAccess`，只用 ESM |
| 运行 TS | 开发时用 `tsx`；不用路径别名，全部写相对路径（webpack、Vite、tsx 三套打包环境都要能直接识别） |
| 代码检查和格式化 | Biome 2（不引入 ESLint、Prettier）。缩进 2 空格，行宽 100，双引号 |
| 测试 | Vitest，测试文件和源码放在一起：`foo.ts` 对应 `foo.test.ts` |
| 外部工具 | ffmpeg / ffprobe。代码里通过 `MW_FFMPEG`、`MW_FFPROBE` 环境变量查找，默认从 PATH 里找。处理 HDR 素材需要带 zimg / libplacebo 的版本（如 Homebrew 的 `ffmpeg-full`），见 PLAN.md 第 7 节 |
| 字体 | 产品默认用阿里巴巴普惠体 3.0，放在 `assets/fonts/alibaba-puhuiti-3/`，**不进仓库**。测试和 CI 一律用开源的 Noto Sans SC（`pnpm fonts:fetch-test` 下载），不能让测试依赖普惠体 |
| 识音模型 | SenseVoice（sherpa-onnx 格式），`mw models --fetch` 下载到 `~/MediaWorkspace/models/`（`MW_MODELS_DIR`），**不进仓库**。单元测试不能依赖模型；需要模型的 e2e 测试在没有模型时跳过 |
| 本地数据 | 工程默认放在 `~/MediaWorkspace/projects/`，用 `MW_HOME` 修改。测试只能使用临时目录，不能读写用户的真实工程 |

初始锁定的主要依赖版本（2026-10-28 核对，阶段 A 初始化时写进 package.json）：
remotion 系列 4.0.539 · react 19.3 · zod 4.x（和 Remotion 用的大版本一致）· @modelcontextprotocol/sdk 1.32 ·
hono 4.13 · vite 8.3 · vitest 5.0 · @biomejs/biome 2.6 · tsx 4.23 · cac 7.1 · zustand 5.0 · tailwindcss 4.3

## 2. 目录与模块边界

```
src/
  core/         同构纯 TS：schema、ops、validate、lint、compile、srt、time
  templates/    每个模板一个目录：schema.ts / component.tsx / meta.ts / fixtures.ts
  composition/  Remotion 合成组件（Root、Main），只依赖 core 和 templates
  node/         store（原子写入、锁、历史）、media（probe、标准化）、render、fonts
  cli/          mw 命令
  server/       Hono：REST、SSE、媒体服务（阶段 B）
  mcp/          MCP stdio 服务（阶段 C）
  web/          Vite + React 工作台（阶段 B）
scripts/        生成测试素材、下载字体等脚本
docs/           计划、格式说明、决策记录（docs/decisions/NNNN-标题.md）
```

**依赖方向只能这样**（Biome 的 `noNodejsModules` 和 `noRestrictedImports` 规则会强制检查）：

- `core` 不能 import 任何 Node 模块，也不能 import 项目里的其他目录。
- `templates`、`composition`、`web` 不能 import Node 模块和 `node/`。
- `cli`、`mcp`、`server` 可以使用 `node/` 和 `core`，但**不能各自实现业务逻辑**。同一个操作只能写在 core 或 node 里，三个外壳只负责参数解析和输出格式。

## 3. 硬性规则

1. **project.json 只能通过 `node/store` 写入**：先加锁，再检查 revision 和轨道锁定，然后校验，备份上一版到 history，写临时文件、fsync、rename。任何其他代码都不能直接写这个文件。界面上的每一次修改也必须转成 ops 提交，不能绕过。`editor.json` 只保存编辑器状态，不能把任何影响渲染的数据放进去。
2. **时间换算只能在 `core/compile` 和 `core/time` 里做**。其他地方不能自己把毫秒换算成帧。吸附、裁剪、分割这类时间线计算放在 `core` 里写纯函数，界面只负责调用和显示。
3. **原始素材只读**。不能修改、移动、覆盖用户的媒体文件，生成的文件一律放在工程的 `cache/` 下。
4. **模板组件必须是纯函数**：只由 props 和 `useCurrentFrame()` 驱动，不能使用 `Math.random()`、`Date.now()`、网络请求或全局状态。
5. **不能把 schema 和类型写两份**：类型一律从 Zod schema 推导（`z.infer`），JSON Schema 一律用 `z.toJSONSchema` 生成。
6. 修改工程格式时必须同时：增加 `version`、在 `core/migrations/` 里写迁移、补充测试，并在 `docs/decisions/` 里记录原因。
7. 渲染、媒体处理出错时，要返回带 `code` 的结构化错误（见 PLAN.md 5.3 节），不能只抛出一段字符串。
8. 不要引入 PLAN.md 里列为非目标的功能和依赖（数据库、时间线库、Electron 等）。识音只用 `node/asr` 里的 sherpa-onnx（D27），不要另外引入 Whisper、Python 或在线识别服务。

## 4. 代码风格

- 标识符、文件名、错误码、commit 类型用英文；注释、文档、界面文字、给用户看的错误信息用中文。
- 文件名用 kebab-case（`resolve-anchor.ts`），React 组件用 PascalCase 导出。
- 注释只写「为什么这样做」，不要逐行复述代码。
- 优先使用小的纯函数，少用 class。除非 SDK 要求，不写单例。

## 5. Git 规范

- `dev` 是日常开发分支，所有开发都提交到 `dev`（较大的改动可以从 `dev` 拉出 `feat/…` 分支，完成后合并回 `dev`）。
- `main` 只放经过验收的版本：每个阶段验收通过后，由 `dev` 通过 PR 合并到 `main`。不要直接往 `main` 提交。
- Commit 用 Conventional Commits 格式，scope 用目录名，描述可以写中文：
  `feat(core): 支持按字幕 ID 锚定叠加层`
- 不提交以下内容：媒体文件、渲染结果、`*.mwproj/`、字体二进制、`.env`（见 `.gitignore`）。
- AI 只有在用户明确要求时才能 commit 或 push。

## 6. 完成标准

一项改动完成之前，必须在本地通过：

```
pnpm check        # biome check + 类型检查
pnpm test         # Vitest
pnpm test:e2e     # 改到渲染、媒体、模板时必须跑
```

汇报结果时要如实说明：跑了哪些测试，哪些通过、哪些失败、哪些没跑。

## 7. 多个 AI 协作和本地笔记

本仓库可能同时有几个 AI（Claude Code、Codex 等）在开发。各家 AI 的记忆互相看不到，**协作信息只放在仓库里**。

- **进度**：`docs/STATUS.md`，进 git。开工前先读；要做一件事，先在表里占一行（谁、哪个分支）；
  提交时顺手更新状态；做完、合进 dev 后删掉这一行。已经做完的事看 git 记录和 `docs/decisions/`，不在这里重复。
  别人占着的事不要动，有冲突先问用户。
- **本地笔记**：带样片截图的分析、对比图、实验记录放 `local/notes/<日期>-<主题>/`（`README.md` + 图片，相对路径引用）。
  `local/` 在 `.gitignore` 里，不会进仓库。需要公开的结论写进 `docs/decisions/`，只写文字和数字。
- **不要把样片相关的图放进 `docs/`**：仓库是公开的，样片和从样片截出来的图都是用户的私有内容。
- **每个写代码的 AI 用自己的工作目录**（git worktree，由 Claude 统一创建和删除），不要在别人的目录里切分支、提交：
  `media-workspace`（Claude，dev）、`media-workspace-codex`（Codex），
  当前对应关系见 `docs/STATUS.md` 的「目录」一列。同一个目录同一时间只能有一个 AI 写代码。
- 分支合进 dev 后，Claude 马上删除对应的工作目录和分支；删之前先把那个目录里的 `local/notes/` 挪到主目录的 `local/notes/`（`git worktree remove` 会连同被忽略的文件一起删掉）。临时目录和生成的文件用完就删。
- `docs/STATUS.md` 只在主目录 `media-workspace`（dev）里改，不要在自己分支里改它，避免合并时冲突。
