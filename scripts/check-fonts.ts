// 检查字体文件是否齐全。用法：pnpm fonts:check
import { checkFonts } from "../src/node/fonts";

const report = await checkFonts();
for (const r of report) console.log(`${r.ok ? "✓" : "✗"} ${r.id} ${r.weight}  ${r.path}`);
if (report.some((r) => !r.ok)) {
  console.error(
    "\n缺少字体文件。普惠体请从官方下载后放进 assets/fonts/alibaba-puhuiti-3/；测试字体运行 pnpm fonts:fetch-test",
  );
  process.exitCode = 1;
}
