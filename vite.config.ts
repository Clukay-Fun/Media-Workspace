import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 审片台（src/web）。开发时 /api 代理到 mw serve（127.0.0.1:5170）；构建结果由 mw serve 直接提供
export default defineConfig({
  plugins: [react()],
  root: "src/web",
  server: { host: "127.0.0.1", port: 5173, proxy: { "/api": "http://127.0.0.1:5170" } },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
