#!/usr/bin/env node
// mw 命令入口：用 tsx 直接运行 TypeScript 源码（本地工具，不单独构建）
import { register } from "tsx/esm/api";

register();
await import("../src/cli/index.ts");
