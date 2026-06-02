import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PanelScriptChildRecord, PanelScriptFileRecord } from "../../lib/programRails";
import {
  BOOLEAN_TOOLBOX_CANONICAL_HEIGHT,
  BOOLEAN_TOOLBOX_CANONICAL_WIDTH,
  BOOLEAN_TOOLBOX_CONTROL_TEXT_SIZE,
  BOOLEAN_TOOLBOX_OPERATION_BUTTONS,
  BOOLEAN_TOOLBOX_OPERATION_TEXT_SIZE,
  BOOLEAN_TOOLBOX_RUN_BUTTON,
  BOOLEAN_TOOLBOX_RUN_TEXT_SIZE,
  BOOLEAN_TOOLBOX_SOLVER_RECT,
  BOOLEAN_TOOLBOX_SVG_RECTS,
  BOOLEAN_TOOLBOX_TOGGLE_BUTTONS,
  type BooleanToolboxButtonSlot,
  type BooleanToolboxRect
} from "../boolean/booleanToolboxGeometry";

export type BooleanOperation = "INTERSECT" | "UNION" | "DIFFERENCE";
export type BooleanSolver = "FAST" | "EXACT" | "MANIFOLD";

export type BooleanToolboxState = {
  operation: BooleanOperation;
  solver: BooleanSolver;
  selfIntersection: boolean;
  holeTolerant: boolean;
  hideCutter: boolean;
  backupActive: boolean;
};

export type BooleanToolboxCommand = BooleanToolboxButtonSlot | "set_solver";

const SOLVER_OPTIONS: Array<{
  value: BooleanSolver;
  slot: string;
  fallbackLabel: string;
  fallbackTooltip: string;
}> = [
  {
    value: "FAST",
    slot: "solver_fast",
    fallbackLabel: "Float",
    fallbackTooltip: "Use Blender's Float boolean solver."
  },
  {
    value: "EXACT",
    slot: "solver_exact",
    fallbackLabel: "Exact",
    fallbackTooltip: "Use Blender's Exact boolean solver."
  },
  {
    value: "MANIFOLD",
    slot: "solver_manifold",
    fallbackLabel: "Manifold",
    fallbackTooltip: "Use Blender's Manifold boolean solver."
  }
];

function findChildRecord(
  children: readonly PanelScriptChildRecord[] | undefined,
  slot: string
): PanelScriptChildRecord | undefined {
  return children?.find((child) => child.slot === slot);
}

function resolveChildLabel(
  record: PanelScriptFileRecord,
  slot: string,
  fallbackLabel: string
): string {
  return findChildRecord(record.children, slot)?.label?.trim() || fallbackLabel;
}

function resolveChildTooltip(
  record: PanelScriptFileRecord,
  slot: string,
  fallbackTooltip: string
): string {
  return findChildRecord(record.children, slot)?.tooltip?.trim() || fallbackTooltip;
}

function operationForSlot(slot: BooleanToolboxButtonSlot): BooleanOperation | null {
  switch (slot) {
    case "operation_intersect":
      return "INTERSECT";
    case "operation_union":
      return "UNION";
    case "operation_difference":
      return "DIFFERENCE";
    default:
      return null;
  }
}

function selectedForSlot(state: BooleanToolboxState, slot: BooleanToolboxButtonSlot): boolean {
  const operation = operationForSlot(slot);
  if (operation) {
    return state.operation === operation;
  }

  switch (slot) {
    case "toggle_self_intersection":
      return state.selfIntersection;
    case "toggle_hole_tolerant":
      return state.holeTolerant;
    case "toggle_hide_cutter":
      return state.hideCutter;
    case "toggle_backup_active":
      return state.backupActive;
    default:
      return false;
  }
}

function renderButton(args: {
  key: string;
  label: ReactNode;
  title: string;
  ariaLabel: string;
  rect: BooleanToolboxRect;
  fontSize: number;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { key, label, title, ariaLabel, rect, fontSize, selected, disabled, onClick } = args;
  return (
    <button
      key={key}
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-pressed={selected ? true : undefined}
      className="boolean-toolbox-window-page__button"
      data-selected={selected ? "true" : "false"}
      disabled={disabled}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: `${Math.min(rect.rx, rect.ry)}px`,
        fontSize: `${fontSize}px`
      }}
      onClick={onClick}
    >
      <span className="boolean-toolbox-window-page__button-label">{label}</span>
    </button>
  );
}

export function BooleanToolboxSurface({
  record,
  state,
  disabled = false,
  onAction
}: {
  record: PanelScriptFileRecord;
  state: BooleanToolboxState;
  disabled?: boolean;
  onAction: (
    command: BooleanToolboxCommand,
    payload?: Record<string, unknown>
  ) => void;
}) {
  const [solverMenuOpen, setSolverMenuOpen] = useState(false);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const resolvedSolverOptions = useMemo(
    () =>
      SOLVER_OPTIONS.map((option) => ({
        ...option,
        label: resolveChildLabel(record, option.slot, option.fallbackLabel),
        tooltip: resolveChildTooltip(record, option.slot, option.fallbackTooltip)
      })),
    [record]
  );
  const activeSolver =
    resolvedSolverOptions.find((option) => option.value === state.solver) ??
    resolvedSolverOptions[0];

  useEffect(() => {
    if (disabled) {
      setSolverMenuOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!solverMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && surfaceRef.current?.contains(target)) {
        return;
      }
      setSolverMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSolverMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [solverMenuOpen]);

  return (
    <section
      ref={surfaceRef}
      className="boolean-toolbox-window-page__surface"
      aria-label={`${record.label} toolbox`}
      style={{
        width: `${BOOLEAN_TOOLBOX_CANONICAL_WIDTH}px`,
        height: `${BOOLEAN_TOOLBOX_CANONICAL_HEIGHT}px`
      }}
    >
      <svg
        className="boolean-toolbox-window-page__svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${BOOLEAN_TOOLBOX_CANONICAL_WIDTH} ${BOOLEAN_TOOLBOX_CANONICAL_HEIGHT}`}
        aria-hidden="true"
      >
        <g>
          {BOOLEAN_TOOLBOX_SVG_RECTS.map((rect, index) => (
            <rect
              key={`boolean-svg-rect-${index}`}
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

      {BOOLEAN_TOOLBOX_OPERATION_BUTTONS.map((spec) =>
        renderButton({
          key: spec.slot,
          label: resolveChildLabel(record, spec.slot, spec.fallbackLabel),
          title: resolveChildTooltip(record, spec.slot, spec.tooltip),
          ariaLabel: resolveChildTooltip(record, spec.slot, spec.tooltip),
          rect: spec.rect,
          fontSize: BOOLEAN_TOOLBOX_OPERATION_TEXT_SIZE,
          selected: selectedForSlot(state, spec.slot),
          disabled,
          onClick: () => {
            setSolverMenuOpen(false);
            onAction(spec.slot);
          }
        })
      )}

      <button
        type="button"
        className="boolean-toolbox-window-page__button boolean-toolbox-window-page__solver-button"
        title="Boolean solver"
        aria-label="Boolean solver"
        aria-expanded={solverMenuOpen}
        aria-haspopup="menu"
        disabled={disabled}
        data-selected={solverMenuOpen ? "true" : "false"}
        style={{
          left: `${BOOLEAN_TOOLBOX_SOLVER_RECT.x}px`,
          top: `${BOOLEAN_TOOLBOX_SOLVER_RECT.y}px`,
          width: `${BOOLEAN_TOOLBOX_SOLVER_RECT.width}px`,
          height: `${BOOLEAN_TOOLBOX_SOLVER_RECT.height}px`,
          borderRadius: `${Math.min(
            BOOLEAN_TOOLBOX_SOLVER_RECT.rx,
            BOOLEAN_TOOLBOX_SOLVER_RECT.ry
          )}px`,
          fontSize: `${BOOLEAN_TOOLBOX_CONTROL_TEXT_SIZE}px`
        }}
        onClick={() => {
          if (!disabled) {
            setSolverMenuOpen((open) => !open);
          }
        }}
      >
        <span className="boolean-toolbox-window-page__button-label">
          {activeSolver?.label ?? state.solver}
        </span>
        <span className="boolean-toolbox-window-page__solver-caret" aria-hidden="true" />
      </button>

      {solverMenuOpen ? (
        <div
          className="boolean-toolbox-window-page__solver-menu"
          role="menu"
          aria-label="Boolean solver options"
        >
          {resolvedSolverOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="boolean-toolbox-window-page__solver-option"
              title={option.tooltip}
              role="menuitemradio"
              aria-checked={state.solver === option.value}
              data-selected={state.solver === option.value ? "true" : "false"}
              disabled={disabled}
              onClick={() => {
                setSolverMenuOpen(false);
                if (state.solver !== option.value) {
                  onAction("set_solver", { solver: option.value });
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {BOOLEAN_TOOLBOX_TOGGLE_BUTTONS.map((spec) =>
        renderButton({
          key: spec.slot,
          label: resolveChildLabel(record, spec.slot, spec.fallbackLabel),
          title: resolveChildTooltip(record, spec.slot, spec.tooltip),
          ariaLabel: resolveChildTooltip(record, spec.slot, spec.tooltip),
          rect: spec.rect,
          fontSize: BOOLEAN_TOOLBOX_CONTROL_TEXT_SIZE,
          selected: selectedForSlot(state, spec.slot),
          disabled,
          onClick: () => {
            setSolverMenuOpen(false);
            onAction(spec.slot);
          }
        })
      )}

      {renderButton({
        key: BOOLEAN_TOOLBOX_RUN_BUTTON.slot,
        label: resolveChildLabel(
          record,
          BOOLEAN_TOOLBOX_RUN_BUTTON.slot,
          BOOLEAN_TOOLBOX_RUN_BUTTON.fallbackLabel
        ),
        title: resolveChildTooltip(
          record,
          BOOLEAN_TOOLBOX_RUN_BUTTON.slot,
          BOOLEAN_TOOLBOX_RUN_BUTTON.tooltip
        ),
        ariaLabel: resolveChildTooltip(
          record,
          BOOLEAN_TOOLBOX_RUN_BUTTON.slot,
          BOOLEAN_TOOLBOX_RUN_BUTTON.tooltip
        ),
        rect: BOOLEAN_TOOLBOX_RUN_BUTTON.rect,
        fontSize: BOOLEAN_TOOLBOX_RUN_TEXT_SIZE,
        disabled,
        onClick: () => {
          setSolverMenuOpen(false);
          onAction(BOOLEAN_TOOLBOX_RUN_BUTTON.slot);
        }
      })}
    </section>
  );
}
