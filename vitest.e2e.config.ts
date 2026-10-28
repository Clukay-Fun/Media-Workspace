import { defineConfig } from "vitest/config";

// 渲染相关的测试很慢，单独运行：pnpm test:e2e
export default defineConfig({
  test: {
    include: ["tests/**/*.e2e.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
