import {
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import mainBackground from "../../assets/backgrounds/main-background.jpeg";
import {
  DURATION_MAX_MS,
  DURATION_MIN_MS,
  EASING_OPTIONS,
  easingCss,
  readAppearanceSettings,
  resolveEasingOption,
  subscribeAppearanceSettings,
  writeAppearanceSettings,
  type AppearanceSettings,
  type EasingId,
  type RailHoverMotionSettings
} from "../../lib/appearanceSettings";
import "./appearanceWindowPage.css";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const RESIZE_HANDLES: ReadonlyArray<{ direction: ResizeDirection; modifier: string }> = [
  { direction: "North", modifier: "north" },
  { direction: "South", modifier: "south" },
  { direction: "East", modifier: "east" },
  { direction: "West", modifier: "west" },
  { direction: "NorthEast", modifier: "north-east" },
  { direction: "NorthWest", modifier: "north-west" },
  { direction: "SouthEast", modifier: "south-east" },
  { direction: "SouthWest", modifier: "south-west" }
];

function durationToPercent(value: number): number {
  return ((value - DURATION_MIN_MS) / (DURATION_MAX_MS - DURATION_MIN_MS)) * 100;
}

function CurvePreview({ easingId, durationMs }: { easingId: EasingId; durationMs: number }) {
  const [x1, y1, x2, y2] = resolveEasingOption(easingId).cubicBezier;
  // SVG y grows downward, so flip: progress 0 sits bottom-left, progress 1 top-right.
  const path = `M0,100 C${x1 * 100},${100 - y1 * 100} ${x2 * 100},${100 - y2 * 100} 100,0`;
  const tracerStyle: CSSProperties = {
    animationDuration: `${durationMs}ms`,
    animationTimingFunction: easingCss(easingId)
  };
  return (
    <div className="ap-curve">
      <svg className="ap-curve__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line className="ap-curve__grid" x1="0" y1="50" x2="100" y2="50" />
        <line className="ap-curve__grid" x1="50" y1="0" x2="50" y2="100" />
        <path className="ap-curve__diagonal" d="M0,100 L100,0" />
        <path className="ap-curve__path" d={path} />
      </svg>
      {/* key forces the tracer to restart whenever the curve or duration changes. */}
      <span className="ap-curve__track" aria-hidden="true">
        <span className="ap-curve__tracer" key={`${easingId}-${durationMs}`} style={tracerStyle} />
      </span>
    </div>
  );
}

type MotionGroupProps = {
  title: string;
  hint: string;
  durationMs: number;
  easingId: EasingId;
  onDurationChange: (value: number) => void;
  onEasingChange: (value: EasingId) => void;
};

function MotionGroup({
  title,
  hint,
  durationMs,
  easingId,
  onDurationChange,
  onEasingChange
}: MotionGroupProps) {
  const sliderStyle = { "--ap-fill": `${durationToPercent(durationMs)}%` } as CSSProperties;
  return (
    <section className="ap-group">
      <header className="ap-group__head">
        <h2 className="ap-group__title">{title}</h2>
        <span className="ap-group__hint">{hint}</span>
      </header>

      <div className="ap-field">
        <div className="ap-field__row">
          <label className="ap-field__label" htmlFor={`ap-duration-${title}`}>
            Speed
          </label>
          <span className="ap-field__value">{Math.round(durationMs)} ms</span>
        </div>
        <input
          id={`ap-duration-${title}`}
          className="ap-slider"
          style={sliderStyle}
          type="range"
          min={DURATION_MIN_MS}
          max={DURATION_MAX_MS}
          step={10}
          value={durationMs}
          onChange={(event) => onDurationChange(Number(event.target.value))}
        />
        <div className="ap-slider__scale">
          <span>fast</span>
          <span>slow</span>
        </div>
      </div>

      <div className="ap-field">
        <span className="ap-field__label">Curve</span>
        <div className="ap-curve-picker" role="group" aria-label={`${title} curve`}>
          {EASING_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`ap-chip${option.id === easingId ? " ap-chip--active" : ""}`}
              title={option.description}
              aria-pressed={option.id === easingId}
              onClick={() => onEasingChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <CurvePreview easingId={easingId} durationMs={durationMs} />
      </div>
    </section>
  );
}

function PreviewRail({ motion }: { motion: RailHoverMotionSettings }) {
  const [hovered, setHovered] = useState(false);
  const durationMs = hovered ? motion.dropDurationMs : motion.riseDurationMs;
  const easing = easingCss(hovered ? motion.dropEasingId : motion.riseEasingId);
  const railStyle: CSSProperties = {
    transition: [
      `transform ${durationMs}ms ${easing}`,
      `backdrop-filter ${durationMs}ms ${easing}`,
      `-webkit-backdrop-filter ${durationMs}ms ${easing}`
    ].join(", "),
    backdropFilter: `blur(${hovered && motion.clearOnHover ? 0 : 22}px)`,
    WebkitBackdropFilter: `blur(${hovered && motion.clearOnHover ? 0 : 22}px)`,
    transform: hovered ? `translateY(${motion.dropOffsetPx}px)` : undefined
  };
  return (
    <div className="ap-preview">
      <div
        className="ap-preview__stage"
        style={{ backgroundImage: `url(${mainBackground})` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="ap-preview__rail" style={railStyle} aria-hidden="true" />
        <span className="ap-preview__label">{hovered ? "clear" : "hover me"}</span>
      </div>
    </div>
  );
}

export default function AppearanceWindowPage() {
  const [settings, setSettings] = useState<AppearanceSettings>(() => readAppearanceSettings());
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);

  useEffect(() => subscribeAppearanceSettings(setSettings), []);

  // Frameless window: hold Space then drag to move it.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) {
        return;
      }
      event.preventDefault();
      if (!event.repeat) {
        setSpaceDragActive(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      setSpaceDragActive(false);
      setSpaceDragging(false);
    };
    const handleBlur = () => {
      setSpaceDragActive(false);
      setSpaceDragging(false);
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const updateRailHover = (patch: Partial<RailHoverMotionSettings>) => {
    const next: AppearanceSettings = {
      ...settings,
      railHover: { ...settings.railHover, ...patch }
    };
    setSettings(writeAppearanceSettings(next));
  };

  const startResizeDrag =
    (direction: ResizeDirection) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void getCurrentWindow().startResizeDragging(direction);
    };

  const handleShellPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    void getCurrentWindow().setFocus().catch(() => {});
    if (!spaceDragActive) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".ap-resize-handle")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow()
      .startDragging()
      .catch(() => setSpaceDragging(false));
  };

  return (
    <div
      className={[
        "ap",
        spaceDragActive ? "ap--space-drag" : "",
        spaceDragging ? "ap--dragging" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDownCapture={handleShellPointerDown}
      onPointerUp={() => setSpaceDragging(false)}
      onPointerCancel={() => setSpaceDragging(false)}
    >
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle.modifier}
          className={`ap-resize-handle ap-resize-handle--${handle.modifier}`}
          onPointerDown={startResizeDrag(handle.direction)}
        />
      ))}

      <header className="ap-titlebar">
        <div className="ap-titlebar__brand">
          <span className="ap-titlebar__pip" aria-hidden="true" />
          <span className="ap-titlebar__name">Appearance</span>
          <span className="ap-titlebar__scope">rail motion</span>
        </div>
        <button
          type="button"
          className="ap-titlebar__close"
          title="Close the Appearance window"
          aria-label="Close"
          onClick={() => void getCurrentWindow().close().catch(() => {})}
        >
          ×
        </button>
      </header>

      <div className="ap-body">
        <p className="ap-lede">
          Tune how a rail moves when you hover it. More of FlowCell&rsquo;s look lands here over time.
        </p>

        <PreviewRail motion={settings.railHover} />

        <MotionGroup
          title="Drop"
          hint="on hover"
          durationMs={settings.railHover.dropDurationMs}
          easingId={settings.railHover.dropEasingId}
          onDurationChange={(value) => updateRailHover({ dropDurationMs: value })}
          onEasingChange={(value) => updateRailHover({ dropEasingId: value })}
        />

        <MotionGroup
          title="Rise"
          hint="on leaving"
          durationMs={settings.railHover.riseDurationMs}
          easingId={settings.railHover.riseEasingId}
          onDurationChange={(value) => updateRailHover({ riseDurationMs: value })}
          onEasingChange={(value) => updateRailHover({ riseEasingId: value })}
        />
      </div>
    </div>
  );
}
