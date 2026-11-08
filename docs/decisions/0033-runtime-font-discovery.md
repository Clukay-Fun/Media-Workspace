# D33：运行时字体发现与降级策略

状态：第一阶段（目录索引与前置实验）、第二阶段（非阻断回退）和第三阶段（网页提示、替换与授权状态展示）已在本分支实现。本文只规定运行时行为，不改变工程版本格式。

## 决定

1. **字体来源**：运行时同时识别项目字体（`assets/fonts`、`FONT_FAMILIES` 注册表）和本机系统字体。系统字体只作为当前机器的运行时资源，不复制进仓库，也不把绝对路径写入 `.mwproj`。
2. **字体标识**：新目录项以“字体族名 + 来源（`project` / `system`）”区分。现有注册 ID（例如 `alibaba-puhuiti-3`、`noto-sans-sc`）继续兼容，并优先按注册 ID 解析；旧工程中的任意 CSS 字族名（例如 `Songti SC`）保留原样解析。
3. **缺失处理**：目标行为是缺失字体不阻断预览或导出，按项目字体 → 系统字体 → CSS 后备栈继续渲染，并给出可审计提示。第一阶段保留 `resolveFaces()` 的严格 `FONT_MISSING` 语义，供 `pnpm fonts:check` 和严格检查使用；非阻断 resolver、弹窗和替代字体操作属于后续阶段。
4. **授权提示**：A/B/C 是证据状态，不是运行时许可开关。A、B、C 都可以被识别和选择；界面只展示证据级别和许可证链接，不写“已获商用批准”，也不因商业授权未知而阻断导出。授权状态未知按“未验证”处理，不进入默认推荐，但仍可在用户明确选择时使用并提示。
5. **工程数据**：`font.family` 是字符串字段，校验不要求它必须出现在 `FONT_FAMILIES`；`fallback` 同样是字符串数组。已核对 `src/core/text-style.ts`、`src/core/ops.ts` 和 `src/core/validate.ts`，因此本策略不需要工程 schema 或版本迁移。机器字体的路径、扫描时间和系统目录只存在于运行时目录缓存/API。

## 三阶段

### 第一阶段：发现与解析（本分支）

- 扫描项目注册字体和本机系统字体，建立 family/style/weight 索引。
- 启动时预热、API 手动刷新，返回 `available` 与 `exportable` 标记；API 不返回绝对路径。
- 保留严格 `resolveFaces()`，不改变缺字体错误语义。
- 前置实验：Songti SC 预览/导出、Chromium 系统族名解析、macOS `.ttc` 元数据识别。

### 第二阶段：非阻断回退（本分支）

- soft resolver 返回 `{ faces, warnings }`，缺失字体变为 `FONT_MISSING` / `FONT_FALLBACK` 结构化 warning；严格 `resolveFaces()` 仍供 `fonts:check` 使用。
- 预览、导出和 lint 继续运行；网页 `loadError` 与字体 warning 分离。lint 追加非阻断提示，并保留“基于估算字宽，以预览和导出为准”。
- CLI、MCP、网页 API 和导出 SSE 共用 `FontWarning` 结构，包含请求字体、实际回退、字重和受影响元素；导出完成返回完整回退清单。
- 第三阶段才提供替代字体选择 UI；本阶段不写 `font.family` / `font.fallback`，不写机器绝对路径。

### 第三阶段：体验与授权信息（本分支）

- inspector 提供项目/系统字体搜索、来源和 A/B/C 证据状态；状态由 `docs/font-licenses.md` 服务端解析，未登记系统字体显示“未登记”。
- 缺字体弹窗显示请求字体、受影响元素、实际回退，支持替换、继续使用回退、稍后处理；替换通过现有 `styleEditOps` 写入，支持 item/shared 范围并可撤销/重做。
- “不再提醒”只写当前工程 `editor.json` 的 `fontWarningsDismissed`，不写工程样式；授权文案明确“仅供参考，非法律意见”，未知授权不阻止预览、编辑或导出。
- 导出完成在网页顶栏显示 `X→Y` 回退汇总；只能回退的字体仍保留 warning，不自动改排版。

## 验收标准

- 新工程和含旧注册 ID 的旧工程都能从 `/api/fonts` 看到项目字体；系统字体目录可刷新，API 项不含绝对路径。
- `Songti SC` 这类未注册 CSS 字族在本机预览和 Remotion 导出均能渲染；不同机器缺失时产生可定位 warning，不伪造确定性。
- `.ttc` 先完成系统元数据识别；通过 URL 作为项目字体加载前，必须补做 Chromium `@font-face` 实验并确认 MIME/格式支持。
- 各阶段不改变模板 schema、参数错误和导出退出码；严格 `fonts:check` 仍报告 `FONT_MISSING`，渲染链路改为非阻断 warning。

前置实验详细结果：`local/notes/2026-11-08-font-runtime-experiments/README.md`（只读笔记，不进 Git）。
