import { findItem } from "../lib/project";
import { useStore } from "../store";
import { SelectionCard } from "./inspector";
import { ProjectOverview } from "./inspector/project";

/** 五份设计稿的属性位置：按当前选中对象切换页面，不叠加旧审阅导航。 */
export function ReviewSidebar() {
  const selected = useStore((s) => s.selected);
  const project = useStore((s) => s.project);
  const open = useStore((s) => s.sideOpen);
  const setOpen = useStore((s) => s.setSideOpen);
  const ref = project && selected ? findItem(project, selected) : null;
  const supported =
    ref &&
    (ref.track.kind === "caption" ||
      ref.track.kind === "overlay" ||
      (ref.track.kind === "video" && "type" in ref.item && ref.item.type === "clip"));
  return (
    <>
      {open && (
        <button
          type="button"
          className="inspector-backdrop"
          aria-label="关闭属性面板"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="workbench-inspector"
        className={open ? "sidebar panel design-inspector open" : "sidebar panel design-inspector"}
        aria-label="属性"
      >
        <div className="panel-scroll" key={supported ? ref.item.id : "project"}>
          {supported ? <SelectionCard /> : <ProjectOverview />}
        </div>
      </aside>
    </>
  );
}
