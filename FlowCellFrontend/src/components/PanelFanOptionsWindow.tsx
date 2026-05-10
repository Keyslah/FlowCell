import type { PanelFanLayout, PanelFanPlacement } from "../types";

interface PanelFanOptionsWindowProps {
  panelName: string;
  layout: PanelFanLayout;
  placement: PanelFanPlacement;
  onLayoutChange: (layout: PanelFanLayout) => void;
  onPlacementChange: (placement: PanelFanPlacement) => void;
  onSave: () => void;
}

const LAYOUT_OPTIONS: Array<{ value: PanelFanLayout; label: string }> = [
  { value: "grid", label: "Grid" },
  { value: "radial", label: "Radial" },
  { value: "half-radial", label: "Half Radial" }
];

const PLACEMENT_ROWS: Array<Array<{ value?: PanelFanPlacement; label?: string }>> = [
  [
    { value: "top-left", label: "Top Left" },
    { value: "top", label: "Top" },
    { value: "top-right", label: "Top Right" }
  ],
  [{}, { value: "center", label: "Center" }, {}],
  [
    { value: "bottom-left", label: "Bottom Left" },
    { value: "bottom", label: "Bottom" },
    { value: "bottom-right", label: "Bottom Right" }
  ]
];

export function PanelFanOptionsWindow({
  panelName,
  layout,
  placement,
  onLayoutChange,
  onPlacementChange,
  onSave
}: PanelFanOptionsWindowProps) {
  return (
    <form
      className="panel-fan-options"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="panel-fan-options__header">
        <div>
          <span className="eyebrow">Fan Options</span>
          <h2>{panelName}</h2>
        </div>
        <p className="caption">These options apply only to this panel fan window.</p>
      </div>

      <section className="panel-fan-options__section">
        <div>
          <h3>Type Of Fan Out</h3>
          <p className="caption">Choose how the panel fan buttons are arranged when the fan opens.</p>
        </div>
        <div className="panel-fan-options__layout-grid">
          {LAYOUT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`panel-fan-options__choice ${layout === option.value ? "is-selected" : ""}`}
              onClick={() => onLayoutChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-fan-options__section">
        <div>
          <h3>Button Placement</h3>
          <p className="caption">Set where the fan buttons open from the owner button.</p>
        </div>
        <div className="panel-fan-options__placement-grid">
          {PLACEMENT_ROWS.flatMap((row, rowIndex) =>
            row.map((cell, cellIndex) =>
              cell.value && cell.label ? (
                <button
                  key={cell.value}
                  type="button"
                  className={`panel-fan-options__choice panel-fan-options__choice--placement ${placement === cell.value ? "is-selected" : ""}`}
                  onClick={() => onPlacementChange(cell.value!)}
                >
                  {cell.label}
                </button>
              ) : (
                <span
                  key={`spacer-${rowIndex}-${cellIndex}`}
                  className="panel-fan-options__placement-spacer"
                  aria-hidden="true"
                />
              )
            )
          )}
        </div>
      </section>

      <div className="panel-fan-options__actions">
        <button
          type="submit"
          className="surface-action panel-fan-options__save"
        >
          Save
        </button>
      </div>
    </form>
  );
}
