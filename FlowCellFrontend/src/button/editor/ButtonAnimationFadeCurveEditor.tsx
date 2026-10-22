import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ButtonAnimationFadePoint } from "../types";
import {
  BUTTON_ANIMATION_FADE_MAX_POINTS,
  buildButtonAnimationFadeFrames,
  getButtonAnimationFadeCurve
} from "../animations/buttonActivationAnimations";

const PLOT = { left: 44, top: 16, width: 300, height: 124 };
const percent = (value: number) => Number((value * 100).toFixed(2));
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export interface ButtonAnimationFadeCurveEditorProps {
  curve: readonly ButtonAnimationFadePoint[];
  disabled?: boolean;
  onChange: (curve: ButtonAnimationFadePoint[]) => void;
}

export function ButtonAnimationFadeCurveEditor({
  curve,
  disabled = false,
  onChange
}: ButtonAnimationFadeCurveEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ index: number; pointerId: number } | null>(null);
  const [selected, setSelected] = useState(1);
  const selectedIndex = Math.min(selected, curve.length - 1);
  const selectedPoint = curve[selectedIndex];
  const endpoint = selectedIndex === 0 || selectedIndex === curve.length - 1;
  const path = buildButtonAnimationFadeFrames({ fadeCurve: [...curve] }).map((frame, index) => {
    const x = PLOT.left + frame.offset * PLOT.width;
    const y = PLOT.top + (1 - frame.opacity) * PLOT.height;
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  const pointFromPointer = (clientX: number, clientY: number) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return {
      time: clamp((point.x - PLOT.left) / PLOT.width, 0, 1),
      opacity: clamp(1 - (point.y - PLOT.top) / PLOT.height, 0, 1)
    };
  };

  const updatePoint = (index: number, change: Partial<ButtonAnimationFadePoint>) => {
    if (disabled || !curve[index]) return;
    const next = curve.map((point) => ({ ...point }));
    if (change.opacity !== undefined && Number.isFinite(change.opacity)) {
      next[index].opacity = clamp(change.opacity, 0, 1);
    }
    if (change.time !== undefined && Number.isFinite(change.time)) {
      if (index === 0 || index === curve.length - 1) {
        next[index].time = index === 0 ? 0 : 1;
      } else {
        const previous = curve[index - 1].time;
        const following = curve[index + 1].time;
        const gap = Math.min(0.001, (following - previous) / 4);
        next[index].time = clamp(change.time, previous + gap, following - gap);
      }
    }
    onChange(next);
  };

  const removePoint = (index: number) => {
    if (disabled || index <= 0 || index >= curve.length - 1) return;
    onChange(curve.filter((_, candidate) => candidate !== index));
    setSelected(Math.max(0, index - 1));
  };

  const handlePointKey = (event: KeyboardEvent<SVGCircleElement>, index: number) => {
    if (disabled) return;
    const step = event.shiftKey ? 0.1 : 0.01;
    const point = curve[index];
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      updatePoint(index, { time: point.time + (event.key === "ArrowLeft" ? -step : step) });
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      updatePoint(index, { opacity: point.opacity + (event.key === "ArrowDown" ? -step : step) });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removePoint(index);
    }
  };

  const finishDrag = (event: PointerEvent<SVGCircleElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <fieldset className="button-animation-fade" disabled={disabled}>
      <legend>Fade over playback</legend>
      <svg
        ref={svgRef}
        className="button-animation-fade__graph"
        viewBox="0 0 360 184"
        role="group"
        aria-label="Animation fade curve"
        onDoubleClick={(event) => {
          if (disabled || curve.length >= BUTTON_ANIMATION_FADE_MAX_POINTS || (event.target as Element).closest("[data-fade-point]")) return;
          const point = pointFromPointer(event.clientX, event.clientY);
          if (!point || point.time <= 0 || point.time >= 1 ||
            curve.some((candidate) => Math.abs(candidate.time - point.time) < 0.001)) return;
          const index = curve.findIndex((candidate) => candidate.time > point.time);
          onChange([...curve.slice(0, index), point, ...curve.slice(index)]);
          setSelected(index);
        }}
      >
        <title>Drag points to set opacity throughout playback</title>
        {[0, 0.5, 1].map((value) => (
          <g key={value} className="button-animation-fade__grid">
            <line x1={PLOT.left} x2={PLOT.left + PLOT.width} y1={PLOT.top + value * PLOT.height} y2={PLOT.top + value * PLOT.height} />
            <line x1={PLOT.left + value * PLOT.width} x2={PLOT.left + value * PLOT.width} y1={PLOT.top} y2={PLOT.top + PLOT.height} />
            <text x={PLOT.left - 7} y={PLOT.top + value * PLOT.height + 4} textAnchor="end">{100 - value * 100}</text>
            <text x={PLOT.left + value * PLOT.width} y={PLOT.top + PLOT.height + 17} textAnchor="middle">{value * 100}%</text>
          </g>
        ))}
        <text className="button-animation-fade__axis" x={12} y={78} textAnchor="middle" transform="rotate(-90 12 78)">Opacity %</text>
        <text className="button-animation-fade__axis" x={194} y={178} textAnchor="middle">Time over playback</text>
        <path className="button-animation-fade__curve" d={path} />
        {curve.map((point, index) => (
          <circle
            key={index}
            data-fade-point={index}
            className={`button-animation-fade__point${index === selectedIndex ? " is-selected" : ""}`}
            cx={PLOT.left + point.time * PLOT.width}
            cy={PLOT.top + (1 - point.opacity) * PLOT.height}
            r={6}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={`Fade point ${index + 1}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent(point.opacity)}
            aria-valuetext={`${percent(point.time)}% of playback, ${percent(point.opacity)}% opacity`}
            aria-disabled={disabled}
            onFocus={() => setSelected(index)}
            onKeyDown={(event) => handlePointKey(event, index)}
            onPointerDown={(event) => {
              if (disabled || event.button !== 0) return;
              event.preventDefault();
              setSelected(index);
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { index, pointerId: event.pointerId };
            }}
            onPointerMove={(event) => {
              if (dragRef.current?.pointerId !== event.pointerId) return;
              const next = pointFromPointer(event.clientX, event.clientY);
              if (next) updatePoint(dragRef.current.index, next);
            }}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onLostPointerCapture={() => { dragRef.current = null; }}
          />
        ))}
      </svg>
      <div className="button-animation-fade__point-controls">
        <label>
          <span>Point time (%)</span>
          <input
            type="number"
            aria-label="Fade point time"
            min={0}
            max={100}
            step={0.1}
            value={percent(selectedPoint.time)}
            disabled={disabled || endpoint}
            onChange={(event) => updatePoint(selectedIndex, { time: event.currentTarget.valueAsNumber / 100 })}
          />
        </label>
        <label>
          <span>Point opacity (%)</span>
          <input
            type="number"
            aria-label="Fade point opacity"
            min={0}
            max={100}
            step={1}
            value={percent(selectedPoint.opacity)}
            onChange={(event) => updatePoint(selectedIndex, { opacity: event.currentTarget.valueAsNumber / 100 })}
          />
        </label>
      </div>
      <div className="button-animation-fade__actions">
        <button type="button" onClick={() => { onChange(getButtonAnimationFadeCurve({})); setSelected(1); }}>Reset fade</button>
        <button type="button" onClick={() => { onChange([{ time: 0, opacity: 1 }, { time: 1, opacity: 1 }]); setSelected(0); }}>No fade</button>
        <button type="button" disabled={disabled || endpoint} onClick={() => removePoint(selectedIndex)}>Delete point</button>
      </div>
      <p className="button-animation-fade__hint">
        Drag points or use the number fields. Double-click the graph to add a point. Arrow keys move the focused point; Delete removes an interior point. 100% on this curve uses the opacity set by Transparency.
      </p>
    </fieldset>
  );
}
