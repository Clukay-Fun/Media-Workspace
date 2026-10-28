// A0-2 技术验证：@remotion/media 的 <Video> 处理「裁头 + 1.1 倍速 + 拼接片尾」是否准确
import { Video } from "@remotion/media";
import { Composition, registerRoot, Series } from "remotion";

export type SpikeProps = {
  rawSrc: string;
  outroSrc: string;
  trimBeforeFrames: number;
  speed: number;
  contentFrames: number;
  outroFrames: number;
};

const Spike: React.FC<SpikeProps> = (p) => (
  <Series>
    <Series.Sequence durationInFrames={p.contentFrames}>
      <Video src={p.rawSrc} trimBefore={p.trimBeforeFrames} playbackRate={p.speed} preservePitch />
    </Series.Sequence>
    <Series.Sequence durationInFrames={p.outroFrames}>
      <Video src={p.outroSrc} />
    </Series.Sequence>
  </Series>
);

const defaults: SpikeProps = {
  rawSrc: "",
  outroSrc: "",
  trimBeforeFrames: 0,
  speed: 1,
  contentFrames: 30,
  outroFrames: 30,
};

registerRoot(() => (
  <Composition
    id="spike"
    component={Spike}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={60}
    defaultProps={defaults}
    calculateMetadata={({ props }) => ({
      durationInFrames: props.contentFrames + props.outroFrames,
    })}
  />
));
