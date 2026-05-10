import type { FanoutDirection, FlowCellButton } from "../types";

export interface FanoutCandidate {
  panelName: string;
  button: FlowCellButton;
}

interface FanoutAssignmentDialogProps {
  ownerButton: FlowCellButton;
  candidates: FanoutCandidate[];
  selectedChildIds: string[];
  layout: "row" | "grid" | "radial";
  direction: FanoutDirection;
  onToggle: (buttonId: string) => void;
  onLayoutChange: (layout: "row" | "grid" | "radial") => void;
  onDirectionChange: (direction: FanoutDirection) => void;
  onClose: () => void;
  onSave: () => void;
}

export function FanoutAssignmentDialog({
  ownerButton,
  candidates,
  selectedChildIds,
  layout,
  direction,
  onToggle,
  onLayoutChange,
  onDirectionChange,
  onClose,
  onSave
}: FanoutAssignmentDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Assign fanout actions for ${ownerButton.Label}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-card__header">
          <div>
            <span className="eyebrow">Assign Fanout Actions</span>
            <h2>{ownerButton.Label}</h2>
          </div>
          <button type="button" className="modal-card__close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="fanout-candidate-list">
          <label className="compound-field">
            <span>Layout</span>
            <select
              value={layout}
              onChange={(event) =>
                onLayoutChange(event.target.value as "row" | "grid" | "radial")
              }
            >
              <option value="row">Row</option>
              <option value="grid">Grid</option>
              <option value="radial">Radial</option>
            </select>
          </label>
          <label className="compound-field">
            <span>Direction</span>
            <select
              value={direction}
              onChange={(event) =>
                onDirectionChange(event.target.value as FanoutDirection)
              }
            >
              <option value="up">Up</option>
              <option value="down">Down</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="center">Center</option>
              <option value="up-left">Up Left</option>
              <option value="up-right">Up Right</option>
              <option value="down-left">Down Left</option>
              <option value="down-right">Down Right</option>
            </select>
          </label>
          {candidates.map((candidate) => {
            const checked = selectedChildIds.includes(candidate.button.Id);
            return (
              <label className="fanout-candidate" key={candidate.button.Id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(candidate.button.Id)}
                />
                <span className="fanout-candidate__body">
                  <strong>{candidate.button.Label}</strong>
                  <span className="caption">
                    {candidate.panelName} | {candidate.button.command_id}
                  </span>
                </span>
              </label>
            );
          })}
          {candidates.length === 0 ? (
            <p className="caption">No other buttons were available for fanout assignment.</p>
          ) : null}
        </div>
        <div className="modal-card__actions">
          <button type="button" className="surface-action" onClick={onSave}>
            Save Fanout
          </button>
          <button type="button" className="surface-action" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
