// 检查字体文件是否齐全。用法：pnpm fonts:check
import { checkFonts } from "../src/node/fonts";

const report = await checkFonts();
for (const r of report) console.log(`${r.ok ? "✓" : "✗"} ${r.id} ${r.weight}  ${r.path}`);
if (report.some((r) => !r.ok)) {
  console.error(
    [
      "\n缺少字体文件。按字体包说明将产品字体放入 assets/fonts/ 对应目录",
      "测试字体运行 pnpm fonts:fetch-test",
    ].join("；"),
  );
  process.exitCode = 1;
}
