import { findItem } from "../../lib/project";
import { useStore } from "../../store";
import { CommentCard } from "../comment-card";
import { CaptionInspector } from "./caption";
import { CaptionList } from "./caption-list";
import { ClipInspector } from "./clip";
import type { InspectorProps } from "./common";
import { ImageInspector } from "./image";
import { OverlayInspector } from "./overlay";

/**
 * 选中元素的属性：能用点的就不用写——样式、位置、语速、时间微调都是直接点的选项；
 * 点不出来的改动在底部输入框告诉 AI。每类元素一个文件（docs/decisions/0015）。
 */
export function SelectionCard() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const preview = useStore((s) => s.preview);
  const review = useStore((s) => s.review);
  const listing = useStore((s) => s.captionList);
  const ref = project && selected ? findItem(project, selected) : null;
  if (!project || !ref || !selected) return null;
  const comments = (review?.comments ?? []).filter(
    (c) => c.target === selected && c.status === "open",
  );
  if (ref.track.kind === "caption" && listing) return <CaptionList />;
  const props: InspectorProps = {
    project,
    id: selected,
    ref_: ref,
    fps: preview?.timeline.fps ?? 30,
  };
  return (
    <>
      <Inspector {...props} />
      {comments.length > 0 && (
        <div className="comment-list">
          {comments.map((c) => (
            <CommentCard key={c.id} comment={c} compact />
          ))}
        </div>
      )}
    </>
  );
}

function Inspector(props: InspectorProps) {
  const { track, item } = props.ref_;
  if (track.kind === "caption") return <CaptionInspector {...props} />;
  if (track.kind === "overlay") return <OverlayInspector {...props} />;
  if ("type" in item && item.type === "image") return <ImageInspector {...props} />;
  return <ClipInspector {...props} />;
}
