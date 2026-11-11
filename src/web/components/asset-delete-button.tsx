import { useState } from "react";
import { useStore } from "../store";
import { Icon } from "./icons";

/** 只通过工程操作移除素材记录，历史恢复仍由 store 管理。 */
export function AssetDeleteButton({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="mini-btn"
      disabled={busy}
      aria-label={`删除素材「${name}」`}
      title="从工程素材库移除，原始文件保留"
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await useStore
            .getState()
            .submit([{ op: "asset.remove", id }], `已从素材库移除「${name}」`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="trash" size={14} />
      删除
    </button>
  );
}
