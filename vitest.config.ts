import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
        },
      },
      {
        // 渲染相关的测试很慢，单独运行：pnpm test:e2e
        test: {
          name: "e2e",
          include: ["tests/**/*.e2e.test.ts"],
          testTimeout: 600_000,
          hookTimeout: 600_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
