import { Slider } from "@base-ui/react/slider";

/** 滑杆只显示范围内的位置；工程里的旧数值由旁边的数字框原样显示。 */
export function ParameterSlider({
  value,
  min,
  max,
  step,
  disabled,
  label,
  onChange,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  label: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const shown = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  return (
    <Slider.Root
      className="parameter-slider"
      value={shown}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "number") onChange(next);
      }}
      onValueCommitted={(next) => {
        if (typeof next === "number") onCommit(next);
      }}
    >
      <Slider.Control className="parameter-slider-control">
        <Slider.Track className="parameter-slider-track">
          <Slider.Indicator className="parameter-slider-indicator" />
          <Slider.Thumb className="parameter-slider-thumb" aria-label={label} />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
