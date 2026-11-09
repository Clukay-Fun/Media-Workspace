# Media Workspace 与 OpenTake Standard 对照

整理于 2026-11-05。Media Workspace 以本轮核对的 `498f582` 为基线，OpenTake Standard 固定在 [`59d4eefe`](https://github.com/saf1102/opentake-standard/tree/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66)。以下汇总十项源码对照，涉及发行状态的内容以该提交的文档为准。交互手感、画面和音频一致性、跨机器迁移均未在本轮实测。

| 项目 | Media Workspace | OpenTake Standard | 可借鉴的做法与边界 |
|---|---|---|---|
| **1. AI 制作、实时进度与失败续做** | CLI、MCP 和网页共用工程操作。MCP 提交能同步到工作台，版本检查和历史保护已提交的修改。 | 有独立制作任务和智能体会话记录。运行中断后可识别未完成阶段，保留已完成步骤并重新执行待办。 | 让工作台同时显示「AI 在做哪一步」和「工程改了什么」。续做时先读当前工程版本，再决定如何接上人工修改。阶段续做与精确恢复中断步骤内部状态是两种能力。 |
| **2. 时间线人工编辑** | 拖动时显示临时结果，松手后通过核心操作一次提交。已有裁切、分割、删除、轨道锁定和撤销。本轮未确认片段复制粘贴入口。 | 已确认有片段拖动、裁切、复制粘贴，以及部分关联音效随动。 | 复制粘贴和关联片段随动可分开评估。继续把拖动预览和最终提交分开，保证一次手势对应一次可撤销操作。 |
| **3. 预览、导出与人工验收** | 网页预览和 MP4 导出共用 Remotion 合成。预览可能用 540p 代理。已有进度与失败提示，本轮未找到取消接口和持久化导出任务。 | 普通预览和导出共享编辑数据，使用不同渲染路径。导出有任务记录、取消、整项重试和独立输出目录。 | 保留共用合成，借鉴任务历史、取消、重试和导出快照。两边都允许人调整后再主动导出，本轮均未发现强制人工验收的门槛。若要强制验收，可绑定工程版本，并在修改后使确认失效。 |
| **4. 素材导入与媒体处理** | 引用外部原片并生成标准化副本和代理，已有指纹缓存、波形、人脸采样和独立识音。已有重新链接操作。 | 上传素材复制进工程 `media/`，视频生成封面供素材列表和时间线使用。 | 补素材封面、缺失标记和重新链接入口。重新链接时应核对素材身份并处理旧代理缓存。可选的「收集原片进工程」有助搬运，但会增加磁盘占用。 |
| **5. 字幕、标题、字体与文字动画** | 已有本地识音、文稿对齐、断行复核、全部字幕列表、单句及共用样式、结构化卡片模板和逐字／逐词动效。字体显式注册。 | 可直接改文字轨和生成页面文字，能把预设套给同轨同角色片段。扫描本机字体并允许回退，普通文字轨有渐显。 | 增加「当前轨同类字幕全部套用」，与「改所有使用该样式的字幕」分开。保留字体可复现策略。未在所查 Standard 路径确认同等的自动识音和文稿校对。 |
| **6. 音频制作与剪辑** | 已有独立音轨、波形、片段增益、轨道静音和基于音频的剪停顿。 | 旁白、配乐、音效分轨，支持片段音量线、淡入淡出手柄和整轨音量。按声音切开的实现用于划分音效事件。 | 先明确音轨角色，再评估片段音量线、淡入淡出和整轨增益。音量变化要同时接入预览与导出。双方所查路径均未确认完整的人声分离或降噪。 |
| **7. 画面编辑与视觉效果** | 已有裁切、变换、画中画、轨道层级、变换关键帧、主轨转场、安全区及参考线。 | 通用编辑数据可表示裁切、变换及转场，部分对应控件未确认。OpenScreen 录屏流程有按时间段设置变焦焦点的模型，也有从光标轨迹计算焦点的代码。 | 可把录屏手动焦点变焦映射到现有关键帧。光标自动跟随还需轨迹数据。基础功能已有源码支持，用户反馈的位置和层级问题仍需按实际交互验收。 |
| **8. 批注、版本历史与人工接手** | 批注有时间点、目标、画面位置、版本及处理状态，可通过钩子交给 AI。提交校验基础版本，恢复历史会生成新版本。 | 通用编辑器可把时间点和圈选截图发给 Codex 聊天，人工修改保存于对应版本的 `edited.json`。未确认同类持久化批注队列及通用编辑的跨客户端冲突保护。 | 把圈选截图和时间点附到现有批注，让 AI 看见用户具体指哪一块，同时保留处理状态。 |
| **9. 可编辑交付与剪映互通** | 原生 `.mwproj` 可继续编辑，产品成片导出为 MP4。SRT 可导入，已有格式化函数，尚未接入产品导出。 | 剪映草稿按钮已接通后台导出。有分轨数据时可交付视频、旁白、音乐、音效和原生字幕。只有成片的版本回退为整条视频，部分字幕动画、样式和运镜会降级。 | SRT 导出与剪映草稿可独立交付。草稿应明确哪些内容仍可编辑、哪些效果已合成。剪映实机导入尚未验收。 |
| **10. 安装、依赖与维护** | 需自行安装 Node、pnpm、FFmpeg 并构建和启动本地工作台。人脸检测限 macOS。本轮未找到应用内更新或程序回滚流程。 | 文档提供 Mac DMG 和 Windows 安装器。Mac 更新代码有校验、自检和失败回滚，Windows 检查后手动安装。固定提交内 Windows 构建号记载不同，正式发布状态未确认。 | 本机使用可先补依赖检查和安装指引。安装包和回滚机制适用于需要交付给其他人安装的阶段。 |

## 源码依据

下列本仓库链接使用相对路径。OpenTake 链接均指向上述固定提交。

1. [Media Workspace 操作入口](../src/node/actions.ts)、[实时同步](../src/server/events.ts)、[OpenTake 任务与会话恢复](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/server/general/runner.ts#L148)
2. [时间线界面](../src/web/components/timeline.tsx)、[核心编辑计算](../src/core/edit.ts)、[OpenTake 时间线编辑](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/src/general/GeneralEditor.tsx#L355)
3. [预览](../src/web/components/stage.tsx)、[渲染](../src/node/render.ts)、[导出任务](../src/server/export-jobs.ts)、[OpenTake 导出任务](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/server/general/export.ts#L47)
4. [媒体处理](../src/node/media.ts)、[重新链接操作](../src/core/ops.ts)、[OpenTake 导入与封面](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/server/general/api.ts#L188)
5. [字幕处理](../src/core/transcribe.ts)、[样式范围](../src/core/style-scope.ts)、[文字渲染](../src/composition/TextBlock.tsx)、[OpenTake 批量样式](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/src/general/GeneralEditor.tsx#L511)
6. [静音检测](../src/core/silence.ts)、[合成](../src/composition/Main.tsx)、[OpenTake 音量与淡变手柄](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/src/studio/components/ClipAudioHandles.tsx)、[OpenTake 导出混音](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/server/general/hf-render.ts#L123)
7. [画中画](../src/web/components/inspector/pip.tsx)、[关键帧](../src/web/components/inspector/keyframes.tsx)、[安全区](../src/core/safe-area.ts)、[OpenTake 录屏变焦](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/vendor/openscreen/src/lib/zoomMath/zoomRegionUtils.ts#L47)
8. [批注模型](../src/core/review.ts)、[批注钩子](../src/node/review-hook.ts)、[版本存储](../src/node/store.ts)、[OpenTake 画面引用](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/src/general/GeneralEditor.tsx#L465)
9. [SRT 处理](../src/core/srt.ts)、[CLI 导出入口](../src/cli/index.ts)、[OpenTake 剪映导出](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/server/general/export-worker.ts#L43)、[剪映字幕映射](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/server/general/jianying-captions.ts#L114)
10. [Media Workspace 安装说明](../README.md)、[OpenTake 安装说明](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/README.md#L5)、[Mac 更新回滚](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/desktop/update-engine.cjs)、[Windows 更新](https://github.com/saf1102/opentake-standard/blob/59d4eefe5ddb08379fc50c7daeaf58f8b028ec66/WINDOWS-RELEASE.md)

## 更新顺序补充：先验收工作台的操作手感

源码对照能确认控件和数据路径。滑动是否顺手、拖动是否抢焦点、改字幕时预览是否跟得上，要用同一工程实际操作。以下是验收要求，当前尚未逐项实测。先交付局部右栏，再验收这批高频操作，通过后进入 MCP 制作进度与人工接手。新增导出格式排在后面。

| 操作 | 实际验收步骤 | 通过标准 |
|---|---|---|
| 时间轴滚动和缩放 | 用鼠标滚轮与触控板在长时间线上横滑，缩放后滚到首尾，再点「适合」 | 刻度、轨道、素材和播放头始终对齐。横滑只移动视窗，播放时间保持原值。缩放后仍能找到刚才关注的位置。 |
| 播放头与吸附 | 从刻度和轨道区域拖播放头，跨过刻度与剪切点，松手后再移动鼠标 | 拖动有效，靠近吸附点时轻微停顿，继续拖可以离开。松手立即结束，点击选中字幕或素材时播放头留在原位。 |
| 片段移动和裁切 | 分别拖片段中间和两端，拖过相邻块。拉伸后切换元素，再回来拖动 | 中间移动，边缘改时长，播放头保持原位。片段不会意外缩成一点。松手后只产生一次修改，撤销能恢复这次操作。 |
| 改一句字幕 | 从时间线选中一句，再从「全部字幕」主动定位同一句。改字并提交，查看画面、时间线、列表，再撤销 | 选中和主动定位各有清楚的行为。定位后画面显示对应文字。提交后各处内容一致，原来的时间、样式与其他句子保留。撤销能恢复旧文字。 |
| 改字幕样式和高亮 | 在「编辑／套用样式／全部字幕」之间切换。改本句样式、高亮词，再试共用样式范围 | 当前句和修改范围始终清楚。仅本句修改不影响别句。共用样式只影响使用该样式的句子。整轨套预设作为独立后续入口。 |

先在 Media Workspace 用真实工程跑通这五项，再用 OpenTake Standard 做双方都支持的相同操作。记录卡顿、误触、额外点击和撤销结果，把可复现的差距转为修复任务。
