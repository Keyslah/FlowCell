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
  readMotionSettings,
  resolveEasingOption,
  subscribeMotionSettings,
  writeMotionSettings,
  type MotionSettings,
  type EasingId,
  type RailHoverMotionSettings
} from "../../lib/motionSettings";
import "./motionSettingsWindowPage.css";

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
    <div className="motion-settings-curve">
      <svg className="motion-settings-curve__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line className="motion-settings-curve__grid" x1="0" y1="50" x2="100" y2="50" />
        <line className="motion-settings-curve__grid" x1="50" y1="0" x2="50" y2="100" />
        <path className="motion-settings-curve__diagonal" d="M0,100 L100,0" />
        <path className="motion-settings-curve__path" d={path} />
      </svg>
      {/* key forces the tracer to restart whenever the curve or duration changes. */}
      <span className="motion-settings-curve__track" aria-hidden="true">
        <span className="motion-settings-curve__tracer" key={`${easingId}-${durationMs}`} style={tracerStyle} />
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
  const sliderStyle = { "--motion-settings-fill": `${durationToPercent(durationMs)}%` } as CSSProperties;
  return (
    <section className="motion-settings-group">
      <header className="motion-settings-group__head">
        <h2 className="motion-settings-group__title">{title}</h2>
        <span className="motion-settings-group__hint">{hint}</span>
      </header>

      <div className="motion-settings-field">
        <div className="motion-settings-field__row">
          <label className="motion-settings-field__label" htmlFor={`motion-settings-duration-${title}`}>
            Speed
          </label>
          <span className="motion-settings-field__value">{Math.round(durationMs)} ms</span>
        </div>
        <input
          id={`motion-settings-duration-${title}`}
          className="motion-settings-slider"
          style={sliderStyle}
          type="range"
          min={DURATION_MIN_MS}
          max={DURATION_MAX_MS}
          step={10}
          value={durationMs}
          onChange={(event) => onDurationChange(Number(event.target.value))}
        />
        <div className="motion-settings-slider__scale">
          <span>fast</span>
          <span>slow</span>
        </div>
      </div>

      <div className="motion-settings-field">
        <span className="motion-settings-field__label">Curve</span>
        <div className="motion-settings-curve-picker" role="group" aria-label={`${title} curve`}>
          {EASING_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`motion-settings-chip${option.id === easingId ? " motion-settings-chip--active" : ""}`}
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
    <div className="motion-settings-preview">
      <div
        className="motion-settings-preview__stage"
        style={{ backgroundImage: `url(${mainBackground})` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="motion-settings-preview__rail" style={railStyle} aria-hidden="true" />
        <span className="motion-settings-preview__label">{hovered ? "clear" : "hover me"}</span>
      </div>
    </div>
  );
}

export default function MotionSettingsWindowPage() {
  const [settings, setSettings] = useState<MotionSettings>(() => readMotionSettings());
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);

  useEffect(() => subscribeMotionSettings(setSettings), []);

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
    const next: MotionSettings = {
      ...settings,
      railHover: { ...settings.railHover, ...patch }
    };
    setSettings(writeMotionSettings(next));
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
    if (target instanceof HTMLElement && target.closest(".motion-settings-resize-handle")) {
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
        "motion-settings",
        spaceDragActive ? "motion-settings--space-drag" : "",
        spaceDragging ? "motion-settings--dragging" : ""
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
          className={`motion-settings-resize-handle motion-settings-resize-handle--${handle.modifier}`}
          onPointerDown={startResizeDrag(handle.direction)}
        />
      ))}

      <header className="motion-settings-titlebar">
        <div className="motion-settings-titlebar__brand">
          <span className="motion-settings-titlebar__pip" aria-hidden="true" />
          <span className="motion-settings-titlebar__name">Motion Settings</span>
          <span className="motion-settings-titlebar__scope">rail motion</span>
        </div>
        <button
          type="button"
          className="motion-settings-titlebar__close"
          title="Close Motion Settings"
          aria-label="Close"
          onClick={() => void getCurrentWindow().close().catch(() => {})}
        >
          ×
        </button>
      </header>

      <div className="motion-settings-body">
        <p className="motion-settings-lede">
          Tune how a rail moves when you hover it.
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
