import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import type { PanelScriptChildRecord, PanelScriptFileRecord } from "../../lib/programRails";
import {
  ALIGNMENT_TOOLBOX_AXIS_TEXT_SIZE,
  ALIGNMENT_TOOLBOX_BOTTOM_TEXT_SIZE,
  ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT,
  ALIGNMENT_TOOLBOX_CANONICAL_WIDTH,
  ALIGNMENT_TOOLBOX_CENTER_EVERYTHING_RECT,
  ALIGNMENT_TOOLBOX_CENTER_XY_RECT,
  ALIGNMENT_TOOLBOX_ROW_TEXT_SIZE,
  ALIGNMENT_TOOLBOX_ROWS,
  ALIGNMENT_TOOLBOX_SVG_RECTS,
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT,
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_CENTER_ARTBOARD_RECT,
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_CENTER_EVERYTHING_RECT,
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_CENTER_XY_RECT,
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_ROWS,
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS,
  type AlignmentAxis,
  type AlignmentToolboxRect
} from "../alignment/alignmentToolboxGeometry";

type AlignmentModifier = "" | "SURFACE" | "GEOCENTER";
type AlignmentToolboxVariant = "blender" | "illustrator";

type AlignmentToolboxState = {
  X: AlignmentModifier;
  Y: AlignmentModifier;
  Z: AlignmentModifier;
};

type AlignmentAction =
  | "min"
  | "center"
  | "max"
  | "surface"
  | "geo"
  | "center_artboard"
  | "center_everything"
  | "center_xy"
  | "toggle_group";

type AlignmentActionTarget = AlignmentAxis | "ALL" | "XY";

export type { AlignmentToolboxState };

function findChildRecord(
  children: readonly PanelScriptChildRecord[] | undefined,
  slot: string
): PanelScriptChildRecord | undefined {
  return children?.find((child) => child.slot === slot);
}

function resolveAxisSlot(axis: AlignmentAxis, action: "min" | "center" | "max"): string {
  return `${axis.toLowerCase()}_${action}`;
}

function stripAxisPrefix(axis: AlignmentAxis, label: string, fallbackLabel: string): string {
  return label.replace(new RegExp(`^${axis}\\s+`, "i"), "").trim() || fallbackLabel;
}

function renderButton(args: {
  key: string;
  label: ReactNode;
  title: string;
  ariaLabel: string;
  rect: AlignmentToolboxRect;
  fontSize: number;
  selected?: boolean;
  labelClassName?: string;
  onClick: () => void;
}) {
  const { key, label, title, ariaLabel, rect, fontSize, selected, labelClassName, onClick } =
    args;
  return (
    <button
      key={key}
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-pressed={selected ? true : undefined}
      className="alignment-toolbox-window-page__button"
      data-selected={selected ? "true" : "false"}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: `${Math.min(rect.rx, rect.ry)}px`,
        fontSize: `${fontSize}px`
      }}
      onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        if (event.detail === 0) {
          onClick();
          return;
        }

        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <span
        className={[
          "alignment-toolbox-window-page__button-label",
          labelClassName ?? ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {label}
      </span>
    </button>
  );
}

export function AlignmentToolboxSurface({
  record,
  state,
  groupMode = false,
  onAction,
  resolveLabelOverride,
  variant = "blender"
}: {
  record: PanelScriptFileRecord;
  state: AlignmentToolboxState;
  groupMode?: boolean;
  resolveLabelOverride?: (slot: string, fallbackLabel: string) => string | undefined;
  onAction: (axis: AlignmentActionTarget, action: AlignmentAction) => void;
  variant?: AlignmentToolboxVariant;
}) {
  const isIllustratorVariant = variant === "illustrator";
  const rows = isIllustratorVariant
    ? ILLUSTRATOR_ALIGNMENT_TOOLBOX_ROWS
    : ALIGNMENT_TOOLBOX_ROWS;
  const svgRects = isIllustratorVariant
    ? ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS
    : ALIGNMENT_TOOLBOX_SVG_RECTS;
  const surfaceHeight = isIllustratorVariant
    ? ILLUSTRATOR_ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT
    : ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT;
  const centerEverythingRect = isIllustratorVariant
    ? ILLUSTRATOR_ALIGNMENT_TOOLBOX_CENTER_EVERYTHING_RECT
    : ALIGNMENT_TOOLBOX_CENTER_EVERYTHING_RECT;
  const centerXyRect = isIllustratorVariant
    ? ILLUSTRATOR_ALIGNMENT_TOOLBOX_CENTER_XY_RECT
    : ALIGNMENT_TOOLBOX_CENTER_XY_RECT;

  return (
    <section
      className="alignment-toolbox-window-page__surface"
      aria-label={`${record.label} toolbox`}
      style={{
        width: `${ALIGNMENT_TOOLBOX_CANONICAL_WIDTH}px`,
        height: `${surfaceHeight}px`
      }}
    >
      <svg
        className="alignment-toolbox-window-page__svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${ALIGNMENT_TOOLBOX_CANONICAL_WIDTH} ${surfaceHeight}`}
        aria-hidden="true"
      >
        <g>
          {svgRects.map((rect, index) => (
            <rect
              key={`alignment-svg-rect-${index}`}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={rect.rx}
              ry={rect.ry}
              fill="none"
              stroke="none"
            />
          ))}
        </g>
      </svg>

      {rows.flatMap((row) => {
        const minSlot = resolveAxisSlot(row.axis, "min");
        const centerSlot = resolveAxisSlot(row.axis, "center");
        const maxSlot = resolveAxisSlot(row.axis, "max");
        const surfaceSlot = `${row.axis.toLowerCase()}_surface`;
        const geoSlot = `${row.axis.toLowerCase()}_geo`;
        const minRecord = findChildRecord(record.children, minSlot);
        const centerRecord = findChildRecord(record.children, centerSlot);
        const maxRecord = findChildRecord(record.children, maxSlot);
        const surfaceRecord = findChildRecord(record.children, surfaceSlot);
        const geoRecord = findChildRecord(record.children, geoSlot);

        const minLabel = stripAxisPrefix(
          row.axis,
          resolveLabelOverride?.(minSlot, minRecord?.label?.trim() || "Min") ??
            minRecord?.label?.trim() ??
            "Min",
          "Min"
        );
        const centerLabel = stripAxisPrefix(
          row.axis,
          resolveLabelOverride?.(centerSlot, centerRecord?.label?.trim() || "Center") ??
            centerRecord?.label?.trim() ??
            "Center",
          "Center"
        );
        const maxLabel = stripAxisPrefix(
          row.axis,
          resolveLabelOverride?.(maxSlot, maxRecord?.label?.trim() || "Max") ??
            maxRecord?.label?.trim() ??
            "Max",
            "Max"
        );
        const surfaceLabel = stripAxisPrefix(
          row.axis,
          resolveLabelOverride?.(surfaceSlot, surfaceRecord?.label?.trim() || "Surface") ??
            surfaceRecord?.label?.trim() ??
            "Surface",
          "Surface"
        );
        const geoLabel = stripAxisPrefix(
          row.axis,
          resolveLabelOverride?.(geoSlot, geoRecord?.label?.trim() || "Origin") ??
            geoRecord?.label?.trim() ??
            "Origin",
          "Origin"
        );

        return [
          renderButton({
            key: minSlot,
            label: (
              <>
                <span
                  className="alignment-toolbox-window-page__button-axis-glyph"
                  style={{ fontSize: `${ALIGNMENT_TOOLBOX_AXIS_TEXT_SIZE}px` }}
                >
                  {row.axis.toLowerCase()}
                </span>
                <span className="alignment-toolbox-window-page__button-min-copy">{minLabel}</span>
              </>
            ),
            title: minRecord?.tooltip?.trim() || `${row.axis} minimum`,
            ariaLabel: `${row.axis} ${minLabel}`,
            rect: row.minRect,
            fontSize: ALIGNMENT_TOOLBOX_ROW_TEXT_SIZE,
            labelClassName: "alignment-toolbox-window-page__button-label--min",
            onClick: () => {
              onAction(row.axis, "min");
            }
          }),
          renderButton({
            key: centerSlot,
            label: centerLabel,
            title: centerRecord?.tooltip?.trim() || `${row.axis} center`,
            ariaLabel: `${row.axis} ${centerLabel}`,
            rect: row.centerRect,
            fontSize: ALIGNMENT_TOOLBOX_ROW_TEXT_SIZE,
            onClick: () => {
              onAction(row.axis, "center");
            }
          }),
          renderButton({
            key: maxSlot,
            label: maxLabel,
            title: maxRecord?.tooltip?.trim() || `${row.axis} maximum`,
            ariaLabel: `${row.axis} ${maxLabel}`,
            rect: row.maxRect,
            fontSize: ALIGNMENT_TOOLBOX_ROW_TEXT_SIZE,
            onClick: () => {
              onAction(row.axis, "max");
            }
          }),
          renderButton({
            key: surfaceSlot,
            label: surfaceLabel,
            title: surfaceRecord?.tooltip?.trim() || `${row.axis} surface`,
            ariaLabel: `${row.axis} ${surfaceLabel}`,
            rect: row.surfaceRect,
            fontSize: ALIGNMENT_TOOLBOX_ROW_TEXT_SIZE,
            selected: state[row.axis] === "SURFACE",
            onClick: () => {
              onAction(row.axis, "surface");
            }
          }),
          renderButton({
            key: geoSlot,
            label: geoLabel,
            title: geoRecord?.tooltip?.trim() || `${row.axis} origin`,
            ariaLabel: `${row.axis} ${geoLabel}`,
            rect: row.geoRect,
            fontSize: ALIGNMENT_TOOLBOX_ROW_TEXT_SIZE,
            selected: state[row.axis] === "GEOCENTER",
            onClick: () => {
              onAction(row.axis, "geo");
            }
          })
        ];
      })}

      {isIllustratorVariant
        ? renderButton({
            key: "center_artboard",
            label:
              resolveLabelOverride?.(
                "center_artboard",
                findChildRecord(record.children, "center_artboard")?.label?.trim() ||
                  "Art"
              ) ||
              findChildRecord(record.children, "center_artboard")?.label?.trim() ||
              "Art",
            title:
              findChildRecord(record.children, "center_artboard")?.tooltip?.trim() ||
              "Center the selected objects on the active artboard.",
            ariaLabel: "Center to Artboard",
            rect: ILLUSTRATOR_ALIGNMENT_TOOLBOX_CENTER_ARTBOARD_RECT,
            fontSize: ALIGNMENT_TOOLBOX_BOTTOM_TEXT_SIZE,
            onClick: () => {
              onAction("ALL", "center_artboard");
            }
          })
        : null}

      {renderButton({
        key: "center_everything",
        label:
          resolveLabelOverride?.(
            "center_everything",
            findChildRecord(record.children, "center_everything")?.label?.trim() ||
              (isIllustratorVariant ? "Anchor" : "Center Everything")
          ) ||
          findChildRecord(record.children, "center_everything")?.label?.trim() ||
          (isIllustratorVariant ? "Anchor" : "Center Everything"),
        title:
          findChildRecord(record.children, "center_everything")?.tooltip?.trim() ||
          (isIllustratorVariant
            ? "Center selected objects on the stored FlowCell anchor."
            : "Center the full selection across all supported axes."),
        ariaLabel: isIllustratorVariant ? "Center to Anchor" : "Center Everything",
        rect: centerEverythingRect,
        fontSize: ALIGNMENT_TOOLBOX_BOTTOM_TEXT_SIZE,
        onClick: () => {
          onAction("ALL", "center_everything");
        }
      })}

      {isIllustratorVariant
        ? renderButton({
            key: "toggle_group",
            label:
              resolveLabelOverride?.(
                "toggle_group",
                findChildRecord(record.children, "toggle_group")?.label?.trim() || "Group"
              ) ||
              findChildRecord(record.children, "toggle_group")?.label?.trim() ||
              "Group",
            title:
              findChildRecord(record.children, "toggle_group")?.tooltip?.trim() ||
              "Toggle virtual group movement for selected objects.",
            ariaLabel: "Toggle Group Movement",
            rect: centerXyRect,
            fontSize: ALIGNMENT_TOOLBOX_BOTTOM_TEXT_SIZE,
            selected: groupMode,
            onClick: () => {
              onAction("ALL", "toggle_group");
            }
          })
        : renderButton({
            key: "center_xy",
            label: "Center X & Y",
            title: "Center the moved selection on the active reference object for X and Y.",
            ariaLabel: "Center X and Y",
            rect: centerXyRect,
            fontSize: ALIGNMENT_TOOLBOX_BOTTOM_TEXT_SIZE,
            onClick: () => {
              onAction("XY", "center_xy");
            }
          })}
    </section>
  );
}
