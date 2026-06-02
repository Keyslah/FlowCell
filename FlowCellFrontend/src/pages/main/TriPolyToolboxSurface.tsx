import type { PanelScriptChildRecord, PanelScriptFileRecord } from "../../lib/programRails";
import {
  TRI_POLY_TOOLBOX_BUTTON_TEXT_SIZE,
  TRI_POLY_TOOLBOX_CANONICAL_HEIGHT,
  TRI_POLY_TOOLBOX_CANONICAL_WIDTH,
  TRI_POLY_TOOLBOX_CREATE_BUTTON,
  TRI_POLY_TOOLBOX_INPUT_TEXT_SIZE,
  TRI_POLY_TOOLBOX_SIDES_RECT,
  TRI_POLY_TOOLBOX_SVG_RECTS,
  TRI_POLY_TOOLBOX_TRIANGLE_BUTTONS,
  type TriPolyToolboxButtonSlot,
  type TriPolyToolboxRect
} from "../tri-poly/triPolyToolboxGeometry";

export type TriPolyToolboxState = {
  mode: string;
  sides: number;
  sidesDraft: string;
  angleDeg: number;
  angleDraft: string;
};

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

function renderButton(args: {
  key: string;
  label: string;
  title: string;
  ariaLabel: string;
  rect: TriPolyToolboxRect;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { key, label, title, ariaLabel, rect, selected, disabled, onClick } = args;
  return (
    <button
      key={key}
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-pressed={selected ? true : undefined}
      className="tri-poly-toolbox-window-page__button"
      data-selected={selected ? "true" : "false"}
      disabled={disabled}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: `${Math.min(rect.rx, rect.ry)}px`,
        fontSize: `${TRI_POLY_TOOLBOX_BUTTON_TEXT_SIZE}px`
      }}
      onClick={onClick}
    >
      <span className="tri-poly-toolbox-window-page__button-label">{label}</span>
    </button>
  );
}

function renderAngleControl(args: {
  key: string;
  value: string;
  title: string;
  ariaLabel: string;
  rect: TriPolyToolboxRect;
  selected?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const { key, value, title, ariaLabel, rect, selected, disabled, onChange, onSubmit } = args;
  return (
    <div
      key={key}
      title={title}
      aria-label={ariaLabel}
      className="tri-poly-toolbox-window-page__angle-control"
      data-selected={selected ? "true" : "false"}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: `${Math.min(rect.rx, rect.ry)}px`,
        fontSize: `${TRI_POLY_TOOLBOX_INPUT_TEXT_SIZE}px`
      }}
    >
      <input
        type="number"
        min={1}
        max={178}
        step={1}
        value={value}
        disabled={disabled}
        aria-label="Triangle apex angle"
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <button
        type="button"
        className="tri-poly-toolbox-window-page__angle-submit"
        disabled={disabled}
        aria-label="Create triangle with typed apex angle"
        aria-pressed={selected ? true : undefined}
        onClick={onSubmit}
      >
        °
      </button>
    </div>
  );
}

export function TriPolyToolboxSurface({
  record,
  state,
  disabled = false,
  onSidesChange,
  onAngleChange,
  onAction
}: {
  record: PanelScriptFileRecord;
  state: TriPolyToolboxState;
  disabled?: boolean;
  onSidesChange: (sides: string) => void;
  onAngleChange: (angle: string) => void;
  onAction: (command: TriPolyToolboxButtonSlot, payload?: Record<string, unknown>) => void;
}) {
  const sidesValue = Number.isFinite(state.sides) ? state.sides : 15;
  const sidesDraft = state.sidesDraft || String(sidesValue);
  const angleValue = Number.isFinite(state.angleDeg) ? state.angleDeg : 50;
  const angleDraft = state.angleDraft || String(angleValue);

  return (
    <section
      className="tri-poly-toolbox-window-page__surface"
      aria-label={`${record.label} toolbox`}
      style={{
        width: `${TRI_POLY_TOOLBOX_CANONICAL_WIDTH}px`,
        height: `${TRI_POLY_TOOLBOX_CANONICAL_HEIGHT}px`
      }}
    >
      <svg
        className="tri-poly-toolbox-window-page__svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${TRI_POLY_TOOLBOX_CANONICAL_WIDTH} ${TRI_POLY_TOOLBOX_CANONICAL_HEIGHT}`}
        aria-hidden="true"
      >
        {TRI_POLY_TOOLBOX_SVG_RECTS.map((rect, index) => (
          <rect
            key={`tri-poly-svg-rect-${index}`}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            rx={rect.rx}
            ry={rect.ry}
            className="tri-poly-toolbox-window-page__control-shape"
          />
        ))}
      </svg>

      {TRI_POLY_TOOLBOX_TRIANGLE_BUTTONS.map((spec) => {
        const tooltip = resolveChildTooltip(record, spec.slot, spec.tooltip);

        if (spec.slot === "triangle_50") {
          return renderAngleControl({
            key: spec.slot,
            value: angleDraft,
            title: tooltip,
            ariaLabel: tooltip,
            rect: spec.rect,
            selected: state.mode === spec.slot,
            disabled,
            onChange: onAngleChange,
            onSubmit: () => {
              onAction(spec.slot, { angle_deg: angleValue });
            }
          });
        }

        return renderButton({
          key: spec.slot,
          label: resolveChildLabel(record, spec.slot, spec.fallbackLabel),
          title: tooltip,
          ariaLabel: tooltip,
          rect: spec.rect,
          selected: state.mode === spec.slot,
          disabled,
          onClick: () => {
            onAction(spec.slot);
          }
        });
      })}

      <label
        className="tri-poly-toolbox-window-page__sides-control"
        style={{
          left: `${TRI_POLY_TOOLBOX_SIDES_RECT.x}px`,
          top: `${TRI_POLY_TOOLBOX_SIDES_RECT.y}px`,
          width: `${TRI_POLY_TOOLBOX_SIDES_RECT.width}px`,
          height: `${TRI_POLY_TOOLBOX_SIDES_RECT.height}px`,
          borderRadius: `${Math.min(TRI_POLY_TOOLBOX_SIDES_RECT.rx, TRI_POLY_TOOLBOX_SIDES_RECT.ry)}px`,
          fontSize: `${TRI_POLY_TOOLBOX_INPUT_TEXT_SIZE}px`
        }}
      >
        <span>Sides</span>
        <input
          type="number"
          min={3}
          max={96}
          step={1}
          value={sidesDraft}
          disabled={disabled}
          aria-label="Polygon sides"
          onChange={(event) => {
            onSidesChange(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAction("polygon_create", { sides: sidesValue });
            }
          }}
        />
      </label>

      {renderButton({
        key: TRI_POLY_TOOLBOX_CREATE_BUTTON.slot,
        label: resolveChildLabel(
          record,
          TRI_POLY_TOOLBOX_CREATE_BUTTON.slot,
          TRI_POLY_TOOLBOX_CREATE_BUTTON.fallbackLabel
        ),
        title: resolveChildTooltip(
          record,
          TRI_POLY_TOOLBOX_CREATE_BUTTON.slot,
          TRI_POLY_TOOLBOX_CREATE_BUTTON.tooltip
        ),
        ariaLabel: resolveChildTooltip(
          record,
          TRI_POLY_TOOLBOX_CREATE_BUTTON.slot,
          TRI_POLY_TOOLBOX_CREATE_BUTTON.tooltip
        ),
        rect: TRI_POLY_TOOLBOX_CREATE_BUTTON.rect,
        disabled,
        onClick: () => {
          onAction("polygon_create", { sides: sidesValue });
        }
      })}
    </section>
  );
}
