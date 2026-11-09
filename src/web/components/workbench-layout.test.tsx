// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app";
import { createMockApi } from "../data/mock";
import { useStore } from "../store";
import { MaterialPopover } from "./material-popover";
import { ReviewSidebar } from "./review-sidebar";
import { TopBar } from "./top-bar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
let host: HTMLDivElement;
let root: Root;
async function render(node: ReactNode) {
  await act(async () => root.render(node));
  return host.innerHTML;
}
beforeEach(async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const api = createMockApi();
  const response = await api.project();
  const preview = await api.preview();
  useStore.setState({
    api,
    project: response.project,
    name: response.name,
    dir: response.dir,
    preview: preview.props,
    selected: null,
    leftOpen: false,
    sideOpen: false,
    captionTab: "edit",
    frame: 0,
    cropEditing: null,
    projectId: "demo",
    init: () => () => {},
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.setState(initial);
});

describe("五份 HTML 对应的工作台外壳", () => {
  it("示例工程不凭固定数据谎报本机字体缺失", async () => {
    const preview = await createMockApi().preview();
    expect(preview.fontWarnings).toEqual([]);
  });
  it("默认是播放器和项目属性，素材入口与导出保留在顶栏", async () => {
    const html = await render(<App />);
    expect(html).toContain("打开素材库");
    expect(html).toContain("导出");
    expect(html).toContain("参考线与标尺");
    expect(html).toContain("项目属性");
    expect(html).toContain("草稿参数");
    expect(html).toContain("时间线参数");
    const exportButton = host.querySelector<HTMLButtonElement>(".design-topbar .export-btn");
    expect(exportButton?.getAttribute("aria-label")).toBe("导出");
    expect(exportButton?.textContent).not.toContain("导出");
    for (const old of [
      "AI 改动",
      "调整时间线高度",
      "新增轨道",
      "展开素材栏",
      "暂不可用",
      "账号版式",
      "视频号安全区",
    ])
      expect(html).not.toContain(old);
  });
  it("属性在窄屏可从顶栏打开，并能点画面外收起", async () => {
    await render(
      <>
        <TopBar />
        <ReviewSidebar />
      </>,
    );
    expect(host.querySelector(".design-inspector.open")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".inspector-toggle")?.click());
    expect(host.querySelector(".design-inspector.open")).not.toBeNull();
    expect(host.querySelector(".inspector-backdrop")).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".inspector-backdrop")?.click());
    expect(host.querySelector(".design-inspector.open")).toBeNull();
  });
  it("素材从独立浮层打开，不显示旧左栏样式页", async () => {
    expect(await render(<MaterialPopover />)).toBe("");
    await act(async () => useStore.setState({ leftOpen: true }));
    const html = await render(<MaterialPopover />);
    expect(html).toContain("本机素材路径");
    expect(html).toContain("导入");
    expect(html).toContain("放到画面");
    expect(html).not.toContain("样式模板");
  });
  it("选中主视频显示裁切、速度和音量，支持五个裁切比例", async () => {
    const track = useStore
      .getState()
      .project?.tracks.find((item) => item.kind === "video" && item.main);
    const clip = track?.items.find((item) => "type" in item && item.type === "clip");
    if (!clip) throw new Error("测试主视频缺失");
    useStore.setState({ selected: clip.id });
    const html = await render(<ReviewSidebar />);
    expect(html).toContain("裁切");
    expect(html).toContain('aria-label="速度滑块"');
    expect(html).toContain('aria-label="音量分贝"');
    expect(html).toContain("保持音调");
    for (const label of ["画布", "9:16", "1:1", "4:3", "16:9"]) expect(html).toContain(label);
    expect(html).not.toContain("常用变速");
  });
  it("项目画幅编辑可取消，完成时才写入", async () => {
    const submit = vi.fn().mockResolvedValue(true);
    useStore.setState({ submit });
    await render(<ReviewSidebar />);
    const edit = host.querySelector<HTMLButtonElement>(".design-project-edit");
    await act(async () => edit?.click());
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="比例"]');
    if (!select) throw new Error("比例选择缺失");
    await act(async () => {
      select.value = "16:9";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(submit).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>(".design-project-cancel")?.click());
    expect(submit).not.toHaveBeenCalled();
    expect(host.querySelector('select[aria-label="比例"]')).toBeNull();
    await act(async () => edit?.click());
    const next = host.querySelector<HTMLSelectElement>('select[aria-label="比例"]');
    await act(async () => {
      if (next) {
        next.value = "16:9";
        next.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => edit?.click());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("只聚焦再离开滑杆，不夹改超过滑杆区间的已有参数", async () => {
    const project = structuredClone(useStore.getState().project!);
    const track = project.tracks.find((item) => item.kind === "video" && item.main);
    const clip = track?.items.find((item) => "type" in item && item.type === "clip");
    if (!clip || !("speed" in clip)) throw new Error("测试主视频缺失");
    clip.speed = 15;
    clip.gainDb = 20;
    const submit = vi.fn().mockResolvedValue(true);
    useStore.setState({ project, selected: clip.id, submit });
    await render(<ReviewSidebar />);
    const speed = host.querySelector<HTMLInputElement>('input[aria-label="变速倍数"]');
    const gain = host.querySelector<HTMLInputElement>('input[aria-label="音量分贝"]');
    expect(speed?.value).toBe("15");
    expect(gain?.value).toBe("20");
    for (const slider of host.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
      await act(async () => {
        slider.focus();
        slider.blur();
      });
    }
    expect(submit).not.toHaveBeenCalled();
  });
});
