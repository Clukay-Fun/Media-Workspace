# 0031：安全区只按视频号（工程格式 v9）

## 背景

原来画布上有平台预设 `canvas.safeArea.preset`（`all` / `douyin` / `channels` / `xiaohongshu`），默认从「三平台」改成过「视频号」。
用户只发视频号（2026-11-01），其它平台的数值也没核对过。留着预设只会让质检、槽位位置、换画幅时的字幕线跟着一个用不上的选项变。

## 决定

- 去掉 `canvas.safeArea`，安全区只有视频号一套：竖屏 1080×1920 上 170 / 下 400 / 左 60 / 右 150，
  横屏 1920×1080 上下 60 / 左右 96（都按 2026-11-01 的实机截图核对，见 0030），其他尺寸按比例缩放。
- `safeAreaFor(width, height)`、`slotCenter(slot, width, height)` 不再收预设参数；质检提示写「视频号安全区」。
- `mw preview --safe-area`、MCP `preview` 的 `safeArea` 改成开关（叠加视频号安全区）。

## 迁移

v8 → v9 删掉 `canvas.safeArea`，其它不变。原来用 `all` 等预设的工程，槽位 `top`、`lower-third` 的位置会按视频号的上下边距略有变化；
拖过的位置（`transform`）和样式里的坐标不受影响。
