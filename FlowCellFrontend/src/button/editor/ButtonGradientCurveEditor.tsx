import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ProgramPopoutGradientCurvePoint as CurvePoint } from "../types";
import {
  programPopoutGradientCurveHandle,
  programPopoutGradientCurveValue
} from "../../theme/programPopoutGradientCurve";
import {
  BUTTON_CURVE_PRESETS,
  buttonCurveFade,
  buttonCurveFlipped,
  buttonCurveInsertionIndex,
  buttonCurveMirrored,
  buttonCurvePathData,
  buttonCurveWithInsertedPoint,
  buttonCurveWithMovedHandle,
  buttonCurveWithMovedPoint,
  buttonCurveWithoutPoint,
  buttonCurveWithPointMode
} from "./buttonGradientCurve";

const MODES: Array<{ mode: CurvePoint["mode"]; label: string; tooltip: string }> = [
  { mode: "auto", label: "Smooth", tooltip: "Smooth: the curve flows through this point and its handles follow the neighboring points." },
  { mode: "corner", label: "Corner", tooltip: "Corner: straight lines meet at a sharp point." },
  { mode: "aligned", label: "Bezier", tooltip: "Bezier: drag either handle to bend the curve; the opposite handle stays in line." },
  { mode: "free", label: "Broken", tooltip: "Broken: each handle moves on its own, for a sharp kink." }
];

const RESULT_STOPS = 48;

type CurveDrag =
  | { kind: "point"; index: number }
  | { kind: "handle"; index: number; side: "in" | "out" };

export interface ButtonGradientCurveEditorProps {
  title: string;
  curve: readonly CurvePoint[];
  /** The light's color, for the strength and result strips. */
  color: string;
  disabled?: boolean;
  onChange: (curve: CurvePoint[]) => void;
}

function axisDatasetIndex(value: string | undefined): number {
  return value === undefined ? -1 : Number(value);
}

function grips(curve: readonly CurvePoint[], selected: number) {
  const point = curve[selected];
  if (!point) return [];
  return (["in", "out"] as const).flatMap((side) => {
    if ((side === "in" && selected === 0) || (side === "out" && selected === curve.length - 1)) return [];
    const [dx, dy] = programPopoutGradientCurveHandle(curve, selected, side);
    // Long handles draw shortened so their grip stays inside the box and can be grabbed.
    const endY = point.y + dy;
    const fit = endY > 1.02 ? (1.02 - point.y) / dy : endY < -0.02 ? (-0.02 - point.y) / dy : 1;
    return [{ side, x: (point.x + dx * fit) * 100, y: 100 - (point.y + dy * fit) * 100 }];
  });
}

export function ButtonGradientCurveEditor({
  title,
  curve,
  color,
  disabled = false,
  onChange
}: ButtonGradientCurveEditorProps) {
  const boxRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<CurveDrag | null>(null);
  // A drag fires faster than the parent re-renders, so edits build on the newest curve.
  const curveRef = useRef(curve);
  curveRef.current = curve;
  const [selected, setSelected] = useState(-1);
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const selectedIndex = curve[selected] ? selected : -1;
  const point = curve[selectedIndex];
  const endpoint = selectedIndex === 0 || selectedIndex === curve.length - 1;

  const apply = (next: CurvePoint[]) => {
    curveRef.current = next;
    onChange(next);
  };

  const replace = (next: CurvePoint[]) => {
    setSelected(-1);
    apply(next);
  };

  const unitPoint = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = boxRef.current?.getScreenCTM();
    if (!matrix) return null;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: local.x / 100, y: 1 - local.y / 100 };
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled || event.button !== 0) return;
    const target = (event.target as SVGElement).dataset;
    if (target.kind === "handle") {
      dragRef.current = {
        kind: "handle",
        index: axisDatasetIndex(target.index),
        side: target.side as "in" | "out"
      };
    } else if (target.kind === "point") {
      const index = axisDatasetIndex(target.index);
      setSelected(index);
      dragRef.current = { kind: "point", index };
    } else {
      const position = unitPoint(event);
      if (!position || position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) return;
      const index = buttonCurveInsertionIndex(curveRef.current, position);
      if (index < 0) return;
      apply(buttonCurveWithInsertedPoint(curveRef.current, index, position));
      setSelected(index);
      dragRef.current = { kind: "point", index };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const position = unitPoint(event);
    if (!position) return;
    apply(drag.kind === "point"
      ? buttonCurveWithMovedPoint(curveRef.current, drag.index, position, event.shiftKey)
      : buttonCurveWithMovedHandle(curveRef.current, drag.index, drag.side, position, event.altKey, event.shiftKey));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (disabled || !point) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      replace(buttonCurveWithoutPoint(curve, selectedIndex));
    } else if (event.key.startsWith("Arrow")) {
      const step = event.shiftKey ? 0.05 : 0.01;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0;
      apply(buttonCurveWithMovedPoint(curve, selectedIndex, { x: point.x + dx, y: point.y + dy }));
    } else {
      return;
    }
    event.preventDefault();
  };

  const setExact = (axis: "x" | "y", input: string) => {
    const value = Number(input) / 100;
    if (!point || input === "" || !Number.isFinite(value)) return;
    apply(buttonCurveWithMovedPoint(curve, selectedIndex, axis === "x"
      ? { x: value, y: Number.NaN }
      : { x: Number.NaN, y: value }));
  };

  return (
    <div className="button-gradient-curve">
      <svg
        ref={boxRef}
        className="button-gradient-curve__box"
        viewBox="-32 -8 139 146"
        tabIndex={disabled ? -1 : 0}
        role="application"
        aria-label={`${title} curve. X: trail position from start (0%) to end (100%). Y: strength from 0% at the bottom to 100% at the top. Click to add a point, drag points or handles, double-click a point to delete it.`}
        data-disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          const target = (event.target as SVGElement).dataset;
          if (!disabled && target.kind === "point") replace(buttonCurveWithoutPoint(curve, axisDatasetIndex(target.index)));
        }}
        onKeyDown={handleKeyDown}
      >
        <defs>
          <linearGradient id={`${gradientId}-strength`} x1={0} y1={1} x2={0} y2={0}>
            <stop offset={0} stopColor={color} stopOpacity={0} />
            <stop offset={1} stopColor={color} stopOpacity={1} />
          </linearGradient>
          <linearGradient id={`${gradientId}-result`} x1={0} y1={0} x2={1} y2={0}>
            {Array.from({ length: RESULT_STOPS + 1 }, (_, index) => (
              <stop
                key={index}
                offset={index / RESULT_STOPS}
                stopColor={color}
                stopOpacity={programPopoutGradientCurveValue(curve, index / RESULT_STOPS)}
              />
            ))}
          </linearGradient>
        </defs>
        <rect className="button-gradient-curve__frame" x={0} y={0} width={100} height={100} rx={1.5} />
        <path className="button-gradient-curve__grid" d="M25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100" />
        <line className="button-gradient-curve__diagonal" x1={0} y1={0} x2={100} y2={100} />
        <rect className="button-gradient-curve__strip" x={-8.5} y={0} width={5} height={100} rx={1} fill={`url(#${gradientId}-strength)`} />
        <rect className="button-gradient-curve__strip" x={0} y={104} width={100} height={10} rx={1.5} fill={`url(#${gradientId}-result)`} />
        <text className="button-gradient-curve__axis" x={-26} y={50} transform="rotate(-90 -26 50)" textAnchor="middle">Y · Strength (%)</text>
        <text className="button-gradient-curve__axis" x={-11} y={2} textAnchor="end">100%</text>
        <text className="button-gradient-curve__axis" x={-11} y={100} textAnchor="end">0%</text>
        <text className="button-gradient-curve__axis" x={0} y={123}>0% · Start</text>
        <text className="button-gradient-curve__axis" x={100} y={123} textAnchor="end">End · 100%</text>
        <text className="button-gradient-curve__axis" x={50} y={134} textAnchor="middle">X · Trail position (%)</text>
        <path className="button-gradient-curve__line" d={buttonCurvePathData(curve)} />
        {point ? grips(curve, selectedIndex).map((grip) => (
          <g key={grip.side}>
            <line
              className="button-gradient-curve__handle-line"
              x1={point.x * 100}
              y1={100 - point.y * 100}
              x2={grip.x}
              y2={grip.y}
            />
            <circle className="button-gradient-curve__handle" cx={grip.x} cy={grip.y} r={1.9} />
            <circle
              className="button-gradient-curve__hit"
              cx={grip.x}
              cy={grip.y}
              r={4.5}
              data-kind="handle"
              data-index={selectedIndex}
              data-side={grip.side}
            />
          </g>
        )) : null}
        {curve.map((entry, index) => (
          <g key={index}>
            <circle
              className={`button-gradient-curve__point-dot${index === selectedIndex ? " button-gradient-curve__point-dot--selected" : ""}`}
              cx={entry.x * 100}
              cy={100 - entry.y * 100}
              r={entry.mode === "corner" ? 2.2 : 2.5}
            />
            <circle
              className="button-gradient-curve__hit"
              cx={entry.x * 100}
              cy={100 - entry.y * 100}
              r={5}
              data-kind="point"
              data-index={index}
            />
          </g>
        ))}
      </svg>
      <div className="button-gradient-curve__presets">
        {BUTTON_CURVE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="button-gradient-curve__tool button-gradient-curve__preset"
            title={`${preset.label}: ${preset.tooltip}`}
            aria-label={`${preset.label} curve`}
            disabled={disabled}
            onClick={() => replace(preset.build())}
          >
            <svg className="button-gradient-curve__glyph" viewBox="-6 -6 112 112" aria-hidden="true">
              <rect className="button-gradient-curve__glyph-frame" x={0} y={0} width={100} height={100} rx={8} />
              <path className="button-gradient-curve__glyph-line" d={buttonCurvePathData(preset.build(), 40)} />
            </svg>
          </button>
        ))}
      </div>
      <div className="button-gradient-curve__row">
        <button
          type="button"
          className="button-gradient-curve__tool"
          title="Invert the strength: full becomes off and off becomes full."
          disabled={disabled}
          onClick={() => replace(buttonCurveFlipped(curve))}
        >
          Flip
        </button>
        <button
          type="button"
          className="button-gradient-curve__tool"
          title="Mirror the curve left to right."
          disabled={disabled}
          onClick={() => replace(buttonCurveMirrored(curve))}
        >
          Mirror
        </button>
        <button
          type="button"
          className="button-gradient-curve__tool"
          title="Return to an even fade from full to nothing."
          disabled={disabled}
          onClick={() => replace(buttonCurveFade())}
        >
          Reset
        </button>
      </div>
      <div className="button-gradient-curve__point">
        <span className="button-gradient-curve__point-label">
          {point
            ? `Point ${selectedIndex + 1} of ${curve.length}${endpoint ? selectedIndex === 0 ? " · Start" : " · End" : ""}`
            : `${curve.length} points · select one to edit it`}
        </span>
        <div className="button-gradient-curve__row">
          {MODES.map(({ mode, label, tooltip }) => (
            <button
              key={mode}
              type="button"
              className="button-gradient-curve__tool"
              title={tooltip}
              aria-pressed={point?.mode === mode}
              disabled={disabled || !point}
              onClick={() => apply(buttonCurveWithPointMode(curve, selectedIndex, mode))}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="button-gradient-curve__row">
          <label className="button-gradient-curve__number">
            <span>X Position</span>
            <input
              key={`x-${selectedIndex}-${point?.x}`}
              type="number"
              min={0}
              max={100}
              step={0.1}
              defaultValue={point ? Number((point.x * 100).toFixed(2)) : ""}
              disabled={disabled || !point || endpoint}
              aria-label={`${title} point position percent`}
              onBlur={(event) => setExact("x", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setExact("x", event.currentTarget.value);
              }}
            />
          </label>
          <label className="button-gradient-curve__number">
            <span>Y Strength</span>
            <input
              key={`y-${selectedIndex}-${point?.y}`}
              type="number"
              min={0}
              max={100}
              step={0.1}
              defaultValue={point ? Number((point.y * 100).toFixed(2)) : ""}
              disabled={disabled || !point}
              aria-label={`${title} point strength percent`}
              onBlur={(event) => setExact("y", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setExact("y", event.currentTarget.value);
              }}
            />
          </label>
          <button
            type="button"
            className="button-gradient-curve__tool"
            title="Delete the selected point."
            disabled={disabled || !point || endpoint}
            onClick={() => replace(buttonCurveWithoutPoint(curve, selectedIndex))}
          >
            Delete
          </button>
        </div>
      </div>
      <p className="button-gradient-curve__hint">
        Click the box to add a point. Drag points or handles; double-click or Delete removes a point. Shift snaps, Alt breaks a handle.
      </p>
    </div>
  );
}
