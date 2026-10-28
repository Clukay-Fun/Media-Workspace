import { describe, expect, it } from "vitest";
import { MwError } from "../errors";
import { PROJECT_FORMAT_VERSION } from "../version";
import { migrate } from "./index";

describe("migrate", () => {
  it("v1 工程升到当前版本，内容不变", () => {
    const v1 = { version: 1, revision: 3, tracks: [{ id: "t", items: [] }] };
    expect(migrate(v1)).toEqual({ ...v1, version: PROJECT_FORMAT_VERSION });
  });

  it("v2 工程升到 v3，内容不变", () => {
    const v2 = { version: 2, revision: 1, tracks: [] };
    expect(migrate(v2)).toEqual({ ...v2, version: 3 });
  });

  it("当前版本原样返回", () => {
    const p = { version: PROJECT_FORMAT_VERSION, revision: 0 };
    expect(migrate(p)).toBe(p);
  });

  it("比程序新的版本报错", () => {
    expect(() => migrate({ version: PROJECT_FORMAT_VERSION + 1 })).toThrow(MwError);
  });
});
