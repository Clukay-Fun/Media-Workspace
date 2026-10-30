import { MwError } from "../errors";
import { PROJECT_FORMAT_VERSION } from "../version";

// 工程格式迁移（AGENTS.md 3.6）：读入时把旧版本逐级升到当前版本，再交给 schema 校验。
// 每一步只负责从 N 升到 N+1，输入输出都是还没校验过的 JSON。

type Raw = Record<string, unknown>;

const STEPS: Record<number, (p: Raw) => Raw> = {
  // 1 → 2：字幕新增可选的 charStartMs（docs/decisions/0005），旧数据不用改
  1: (p) => ({ ...p, version: 2 }),
  // 2 → 3：锚点可以指定字幕的第几个字、素材缓存新增 faces（docs/decisions/0007），都是可选字段
  2: (p) => ({ ...p, version: 3 }),
  // 3 → 4：新增可选的章节（chapters）和主轨片段的剪辑理由（cutBefore），docs/decisions/0010
  3: (p) => ({ ...p, version: 4 }),
  // 4 → 5：文本样式新增可选的渐变、发光、下划线、当前词色块（docs/decisions/0012），旧样式不用改
  4: (p) => ({ ...p, version: 5 }),
  // 5 → 6：图片和视频片段新增可选的循环动画 animLoop（docs/decisions/0018），旧数据不用改
  5: (p) => ({ ...p, version: 6 }),
};

export function migrate(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  let p = data as Raw;
  const from = p.version;
  if (typeof from !== "number") return data;
  if (from > PROJECT_FORMAT_VERSION) {
    throw new MwError(
      "VALIDATION",
      `工程格式版本 ${from} 比当前程序支持的 ${PROJECT_FORMAT_VERSION} 新`,
      {
        hint: "请升级工作台后再打开这个工程",
      },
    );
  }
  for (let v = from; v < PROJECT_FORMAT_VERSION; v++) {
    const step = STEPS[v];
    if (!step) throw new MwError("VALIDATION", `不支持从格式版本 ${v} 升级`);
    p = step(p);
  }
  return p;
}
