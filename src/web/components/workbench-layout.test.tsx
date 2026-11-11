// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyOps, type Op } from "../../core/ops";
import { App } from "../app";
import { createMockApi } from "../data/mock";
import { useStore } from "../store";
import { MaterialPopover } from "./material-popover";
import { PlayerChromeV7 } from "./player-chrome-v7";
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
  const editor = await api.editor();
  useStore.setState({
    api,
    project: response.project,
    name: response.name,
    dir: response.dir,
    preview: preview.props,
    editor: editor.editor,
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
  it("素材库可删除未引用素材，使用中的素材由核心拒绝", async () => {
    const project = structuredClone(useStore.getState().project!);
    project.assets.unused = { kind: "image", path: "/unused.png" };
    const inUse = project.tracks.find((track) => track.kind === "caption")?.items[0];
    if (!inUse || !("asset" in inUse)) throw new Error("缺少测试素材引用");
    const errors: string[] = [];
    const submit = vi.fn(async (ops: Op[]) => {
      try {
        const next = applyOps(useStore.getState().project!, ops).project;
        useStore.setState({ project: next });
        return true;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return false;
      }
    });
    useStore.setState({ project, leftOpen: true, submit });
    await render(<MaterialPopover />);
    const name = project.assets[inUse.asset]!.path.split("/").at(-1);
    await act(async () => {
      host.querySelector<HTMLButtonElement>(`button[aria-label='删除素材「${name}」']`)?.click();
    });
    expect(errors[0]).toContain("还在使用中");
    expect(useStore.getState().project!.assets[inUse.asset]).toBeDefined();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="删除素材「unused.png」"]')?.click();
    });
    expect(useStore.getState().project!.assets.unused).toBeUndefined();
    expect(host.textContent).not.toContain("unused.png");
    expect(submit).toHaveBeenLastCalledWith(
      [{ op: "asset.remove", id: "unused" }],
      "已从素材库移除「unused.png」",
    );
  });
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
    ])
      expect(html).not.toContain(old);
    expect(html).toContain("显示视频号安全区");
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
  it("工程切换菜单能在外点或 Escape 后收起", async () => {
    await render(<TopBar />);
    const trigger = host.querySelector<HTMLButtonElement>(".project-switcher-trigger");
    await act(async () => trigger?.click());
    expect(host.querySelector(".project-switcher-menu")).not.toBeNull();
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(host.querySelector(".project-switcher-menu")).toBeNull();
    await act(async () => trigger?.click());
    const search = host.querySelector<HTMLInputElement>(".project-switcher-search");
    await act(async () => {
      search?.focus();
      search?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector(".project-switcher-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("素材浮层打开后聚焦路径，Escape 返回入口", async () => {
    await render(
      <>
        <TopBar />
        <MaterialPopover />
      </>,
    );
    await act(async () => useStore.setState({ leftOpen: true }));
    const input = host.querySelector<HTMLInputElement>("#material-path");
    expect(document.activeElement).toBe(input);
    await act(async () =>
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(host.querySelector(".material-popover")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector(".left-toggle"));
  });
  it("字幕搜索无结果时说明当前状态", async () => {
    const caption = useStore.getState().project?.tracks.find((track) => track.kind === "caption")
      ?.items[0];
    if (!caption) throw new Error("测试字幕缺失");
    useStore.setState({ selected: caption.id, captionTab: "list" });
    await render(<ReviewSidebar />);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="搜索字幕"]');
    await act(async () => {
      if (!input) throw new Error("字幕搜索框缺失");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("读不到 input 的值");
      setter.call(input, "不存在的字幕");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("没有匹配的字幕");
  });
  it("批注输入打开时获得焦点，Escape 返回入口", async () => {
    await render(
      <PlayerChromeV7
        frame={0}
        fps={30}
        total={300}
        playing={false}
        loop={false}
        comments={[]}
        onLoopChange={() => undefined}
        onFullscreen={() => undefined}
      />,
    );
    const entry = host.querySelector<HTMLButtonElement>(".comment-entry");
    await act(async () => entry?.click());
    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="批注内容"]');
    expect(document.activeElement).toBe(input);
    await act(async () =>
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(host.querySelector(".mw-player-note")).toBeNull();
    expect(document.activeElement).toBe(entry);
  });
  it("批注关闭按钮上的 Escape 也收起弹层并返回入口", async () => {
    await render(<App />);
    const entry = host.querySelector<HTMLButtonElement>(".comment-entry");
    await act(async () => entry?.click());
    const close = host.querySelector<HTMLButtonElement>(
      '.mw-player-note button[aria-label="关闭"]',
    );
    if (!close) throw new Error("批注关闭按钮缺失");
    await act(async () => {
      close.focus();
      close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector(".mw-player-note")).toBeNull();
    expect(document.activeElement).toBe(entry);
  });
  it("参考线菜单内部的 Escape 关闭菜单但保留选中对象", async () => {
    const caption = useStore.getState().project?.tracks.find((track) => track.kind === "caption")
      ?.items[0];
    if (!caption) throw new Error("测试字幕缺失");
    useStore.setState({ selected: caption.id });
    await render(<App />);
    const menu = host.querySelector<HTMLDetailsElement>(".preview-settings");
    const trigger = menu?.querySelector<HTMLElement>("summary");
    const entry = menu?.querySelector<HTMLButtonElement>("button");
    if (!menu || !entry || !trigger) throw new Error("参考线菜单缺失");
    menu.open = true;
    await act(async () => {
      entry.focus();
      entry.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(menu.open).toBe(false);
    expect(useStore.getState().selected).toBe(caption.id);
    expect(document.activeElement).toBe(trigger);
  });
  it("参考线菜单可以显示和隐藏当前工程安全区", async () => {
    await render(<App />);
    const menu = host.querySelector<HTMLDetailsElement>(".preview-settings");
    const safeArea = [...(menu?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("视频号安全区"),
    );
    if (!menu || !safeArea) throw new Error("安全区开关缺失");
    expect(useStore.getState().editor?.showSafeArea).not.toBe("channels");
    await act(async () => safeArea.click());
    expect(useStore.getState().editor?.showSafeArea).toBe("channels");
    await act(async () => safeArea.click());
    expect(useStore.getState().editor?.showSafeArea).toBe("off");
  });
  it("批注详情的 Escape 关闭弹层并返回对应标记", async () => {
    await render(
      <PlayerChromeV7
        frame={0}
        fps={30}
        total={300}
        playing={false}
        loop={false}
        comments={[{ id: "k1", text: "核对开头", status: "open", atMs: 1000 }]}
        onLoopChange={() => undefined}
        onFullscreen={() => undefined}
      />,
    );
    const marker = host.querySelector<HTMLButtonElement>(".mw-player-marker");
    await act(async () => marker?.click());
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="关闭批注"]');
    if (!close) throw new Error("批注详情关闭按钮缺失");
    await act(async () => {
      close.focus();
      close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector(".mw-player-note.detail")).toBeNull();
    expect(document.activeElement).toBe(marker);
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
    clip.gainDb = -60;
    const submit = vi.fn().mockResolvedValue(true);
    useStore.setState({ project, selected: clip.id, submit });
    await render(<ReviewSidebar />);
    const speed = host.querySelector<HTMLInputElement>('input[aria-label="变速倍数"]');
    const gain = host.querySelector<HTMLInputElement>('input[aria-label="音量分贝"]');
    expect(speed?.value).toBe("15");
    expect(gain?.value).toBe("-60");
    for (const slider of host.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
      await act(async () => {
        slider.focus();
        slider.blur();
      });
    }
    await act(async () => {
      gain?.focus();
      gain?.blur();
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("音量数字框和滑杆共用对称范围，静音只改轨道标记", async () => {
    const project = structuredClone(useStore.getState().project!);
    const track = project.tracks.find((item) => item.kind === "video" && item.main);
    const clip = track?.items.find((item) => "type" in item && item.type === "clip");
    if (!track || !clip || !("gainDb" in clip)) throw new Error("测试主视频缺失");
    clip.gainDb = 0;
    const submit = vi.fn().mockResolvedValue(true);
    useStore.setState({ project, selected: clip.id, submit });
    await render(<ReviewSidebar />);

    const slider = host.querySelector<HTMLInputElement>('input[aria-label="音量"]');
    const number = host.querySelector<HTMLInputElement>('input[aria-label="音量分贝"]');
    expect(slider).toMatchObject({ min: "-20", max: "20", value: "0" });
    expect(number).toMatchObject({ min: "-20", max: "20", value: "0" });
    const marks = slider?.closest(".design-scale")?.querySelectorAll(".design-scale-labels span");
    expect(Array.from(marks ?? [], (mark) => mark.textContent)).toEqual([
      "−20",
      "−10",
      "0",
      "+10",
      "+20",
    ]);
    await act(async () => host.querySelector<HTMLInputElement>(".volume-mute input")?.click());
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      [{ op: "track.update", id: track.id, set: { muted: true } }],
      "轨道已静音",
    );
  });

  it("轨道锁定时禁用视频参数的滑杆和数字框", async () => {
    const project = structuredClone(useStore.getState().project!);
    const track = project.tracks.find((item) => item.kind === "video" && item.main);
    const clip = track?.items.find((item) => "type" in item && item.type === "clip");
    if (!track || !clip) throw new Error("测试主视频缺失");
    track.locked = true;
    useStore.setState({ project, selected: clip.id });
    await render(<ReviewSidebar />);
    for (const label of ["速度滑块", "音量"]) {
      expect(host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.disabled).toBe(
        true,
      );
    }
    for (const label of ["变速倍数", "音量分贝"]) {
      expect(host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.disabled).toBe(
        true,
      );
    }
  });

  it("视频音量数字框的 Escape 取消，Enter 提交取整值一次", async () => {
    const project = structuredClone(useStore.getState().project!);
    const track = project.tracks.find((item) => item.kind === "video" && item.main);
    const clip = track?.items.find((item) => "type" in item && item.type === "clip");
    if (!clip || !("gainDb" in clip)) throw new Error("测试主视频缺失");
    clip.gainDb = 0;
    const submit = vi.fn().mockResolvedValue(true);
    useStore.setState({ project, selected: clip.id, submit });
    await render(<ReviewSidebar />);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="音量分贝"]');
    if (!input) throw new Error("音量数字框缺失");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("读不到数字框的值");

    await act(async () => {
      input.focus();
      setter.call(input, "3.6");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(input.value).toBe("0");
    expect(submit).not.toHaveBeenCalled();

    await act(async () => {
      input.focus();
      setter.call(input, "3.6");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(input.value).toBe("4");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      [{ op: "item.update", id: clip.id, set: { gainDb: 4 } }],
      "音量调到 4 dB",
    );
  });

  it("视频变速用键盘调整时只提交一次新倍速", async () => {
    const project = structuredClone(useStore.getState().project!);
    const track = project.tracks.find((item) => item.kind === "video" && item.main);
    const clip = track?.items.find((item) => "type" in item && item.type === "clip");
    if (!clip || !("speed" in clip)) throw new Error("测试主视频缺失");
    const submit = vi.fn().mockResolvedValue(true);
    useStore.setState({ project, selected: clip.id, submit });
    await render(<ReviewSidebar />);
    const slider = host.querySelector<HTMLInputElement>('input[aria-label="速度滑块"]');
    expect(slider).not.toBeNull();
    await act(async () => {
      slider?.focus();
      slider?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(submit).toHaveBeenCalledTimes(1);
    const nextSpeed = Math.round((clip.speed + 0.05) * 100) / 100;
    expect(submit).toHaveBeenCalledWith(
      [{ op: "item.update", id: clip.id, set: { speed: nextSpeed } }],
      `变速改成 ${nextSpeed} 倍`,
    );
  });

  it("视频音量用键盘调整时只在提交后写入一次", async () => {
    const project = structuredClone(useStore.getState().project!);
    const track = project.tracks.find((item) => item.kind === "video" && item.main);
    const clip = track?.items.find((item) => "type" in item && item.type === "clip");
    if (!clip || !("gainDb" in clip)) throw new Error("测试主视频缺失");
    clip.gainDb = 0;
    const submit = vi.fn().mockResolvedValue(true);
    useStore.setState({ project, selected: clip.id, submit });
    await render(<ReviewSidebar />);
    const slider = host.querySelector<HTMLInputElement>('input[aria-label="音量"]');
    expect(slider).not.toBeNull();
    await act(async () => {
      slider?.focus();
      slider?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      [{ op: "item.update", id: clip.id, set: { gainDb: 1 } }],
      "音量调到 1 dB",
    );
  });

  it("字幕字号沿用标题字号的范围和键盘提交方式", async () => {
    const project = structuredClone(useStore.getState().project!);
    const track = project.tracks.find((item) => item.kind === "caption");
    const caption = track?.items[0];
    if (!caption) throw new Error("测试字幕缺失");
    const submit = vi.fn().mockResolvedValue(true);
    useStore.setState({ project, selected: caption.id, captionTab: "edit", submit });
    await render(<ReviewSidebar />);
    const slider = host.querySelector<HTMLInputElement>('input[aria-label="字号滑块"]');
    expect(slider?.min).toBe("1");
    expect(slider?.max).toBe("400");
    const current = Number(slider?.getAttribute("aria-valuenow"));
    await act(async () => slider?.focus());
    expect(submit).not.toHaveBeenCalled();
    await act(async () => {
      slider?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(slider?.getAttribute("aria-valuenow")).toBe(String(current + 1));
    expect(JSON.stringify(submit.mock.calls[0]?.[0])).toContain(`"size":${current + 1}`);
  });

  it("文字数字框回车提交一次，Escape 恢复最后确认值", async () => {
    const project = structuredClone(useStore.getState().project!);
    const track = project.tracks.find((item) => item.kind === "caption");
    const caption = track?.items[0];
    if (!caption) throw new Error("测试字幕缺失");
    const submit = vi.fn().mockResolvedValue(true);
    useStore.setState({ project, selected: caption.id, captionTab: "edit", submit });
    await render(<ReviewSidebar />);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="字间距"]');
    if (!input) throw new Error("字间距输入框缺失");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("读不到数字框的值");

    await act(async () => {
      input.focus();
      setter.call(input, "2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(submit.mock.calls[0]?.[0])).toContain('"letterSpacing":2');
    expect(input.value).toBe("2");

    await act(async () => {
      input.focus();
      setter.call(input, "3");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(input.value).toBe("2");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("标题字号键盘调整走原有样式操作，聚焦本身不提交", async () => {
    const project = structuredClone(useStore.getState().project!);
    const submit = vi.fn().mockResolvedValue(true);
    useStore.setState({ project, selected: "o1", submit });
    await render(<ReviewSidebar />);
    const slider = host.querySelector<HTMLInputElement>('input[aria-label="字号滑块"]');
    expect(slider).not.toBeNull();
    await act(async () => slider?.focus());
    expect(submit).not.toHaveBeenCalled();
    await act(async () => {
      slider?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(submit.mock.calls[0]?.[0])).toContain('"size":93');
  });
});
