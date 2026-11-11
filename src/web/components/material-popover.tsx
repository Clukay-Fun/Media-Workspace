import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiFailure } from "../data/client";
import { placeAsset } from "../lib/pip";
import { msOfFrame } from "../lib/timeline";
import { useStore } from "../store";
import { AssetDeleteButton } from "./asset-delete-button";
import { Icon } from "./icons";

/** 顶栏素材入口：用本机路径导入，导入后仍由工程的 store 处理修订与历史。 */
export function MaterialPopover() {
  const open = useStore((s) => s.leftOpen);
  const project = useStore((s) => s.project);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLElement>(null);
  const pathInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) pathInput.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!box.current?.contains(target) && !target?.closest(".left-toggle"))
        useStore.getState().setLeftOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const closePopover = () => {
    useStore.getState().setLeftOpen(false);
    document.querySelector<HTMLButtonElement>(".left-toggle")?.focus();
  };
  if (!open) return null;
  const importFile = async (event: FormEvent) => {
    event.preventDefault();
    const file = path.trim();
    const state = useStore.getState();
    if (!file || !state.project || busy) return;
    const projectId = state.projectId;
    setBusy(true);
    try {
      const result = await state.api.importAsset(file, state.project.revision);
      if (useStore.getState().projectId !== projectId) return;
      await state.refresh();
      setPath("");
      state.toast(`已导入素材 ${result.asset}`);
    } catch (error) {
      if (useStore.getState().projectId === projectId) {
        if (error instanceof ApiFailure && error.code === "CONFLICT") await state.refresh();
        state.toast(error instanceof Error ? error.message : String(error), "error");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside
      ref={box}
      className="material-popover"
      aria-label="素材库"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        closePopover();
      }}
    >
      <header>
        <h2>素材库</h2>
        <button type="button" className="icon-btn" aria-label="关闭素材库" onClick={closePopover}>
          <Icon name="close" size={14} />
        </button>
      </header>
      <form className="material-import" onSubmit={(event) => void importFile(event)}>
        <label htmlFor="material-path">本机素材路径</label>
        <div>
          <input
            id="material-path"
            ref={pathInput}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="粘贴视频、音频或图片的完整路径"
          />
          <button type="submit" disabled={!project || !path.trim() || busy}>
            {busy ? "导入中…" : "导入"}
          </button>
        </div>
      </form>
      <div className="material-list">
        {project &&
          Object.entries(project.assets).map(([id, asset]) => {
            const name = asset.path.split("/").at(-1) ?? id;
            return (
              <div className="material-row" key={id}>
                <Icon name={asset.kind === "image" ? "image" : "film"} size={16} />
                <span title={asset.path}>{name}</span>
                {asset.kind !== "audio" && (
                  <button
                    type="button"
                    onClick={() => {
                      const st = useStore.getState();
                      const fps = st.preview?.timeline.fps ?? 30;
                      try {
                        const placed = placeAsset(project, id, msOfFrame(st.frame, fps));
                        void st.submit(placed.ops, `已把「${name}」放到画面上`).then((ok) => {
                          if (ok) st.select(placed.itemId);
                        });
                      } catch (error) {
                        st.toast(error instanceof Error ? error.message : String(error), "error");
                      }
                    }}
                  >
                    放到画面
                  </button>
                )}
                <AssetDeleteButton id={id} name={name} />
              </div>
            );
          })}
        {project && Object.keys(project.assets).length === 0 && (
          <p>还没有素材。粘贴本机文件路径即可导入。</p>
        )}
      </div>
    </aside>
  );
}
