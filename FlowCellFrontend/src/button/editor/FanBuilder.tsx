import type { ButtonEditorFanCandidate } from "./buttonEditorSelection";

export interface FanBuilderProps {
  programName: string;
  panelName: string;
  candidates: readonly ButtonEditorFanCandidate[];
  selectedButtonIds: ReadonlySet<string>;
  activeFanName?: string;
  busy?: boolean;
  onToggleButton: (buttonId: string, selected: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onBuildNewFan: () => void;
  onUpdateActiveFan?: () => void;
}

export function FanBuilder({
  programName,
  panelName,
  candidates,
  selectedButtonIds,
  activeFanName,
  busy = false,
  onToggleButton,
  onSelectAll,
  onClear,
  onBuildNewFan,
  onUpdateActiveFan
}: FanBuilderProps) {
  const selectedCount = candidates.filter((candidate) => selectedButtonIds.has(candidate.id)).length;
  const hasTarget = Boolean(programName && panelName);

  return (
    <section className="button-fan-builder">
      <h3>Fan Builder</h3>
      <p className="button-fan-builder__summary">
        {hasTarget ? `${selectedCount} selected for ${programName} / ${panelName}` : "Choose a Program and Panel."}
      </p>
      {hasTarget && candidates.length === 0 ? (
        <p className="button-fan-builder__empty">This panel has no script Buttons or Tool Set owners.</p>
      ) : null}
      {candidates.length > 0 ? (
        <div className="button-fan-builder__list" role="group" aria-label="Fan members">
          {candidates.map((candidate) => (
            <label key={candidate.id} className="button-fan-builder__candidate">
              <input
                type="checkbox"
                checked={selectedButtonIds.has(candidate.id)}
                disabled={busy}
                onChange={(event) => onToggleButton(candidate.id, event.currentTarget.checked)}
              />
              <span>{candidate.label}</span>
              <small>{candidate.role === "tool-set-owner" ? "Tool Set owner" : "Button"}</small>
            </label>
          ))}
        </div>
      ) : null}
      <div className="button-editor-actions">
        <button type="button" disabled={busy || candidates.length === 0} onClick={onSelectAll}>Select all</button>
        <button type="button" disabled={busy || selectedCount === 0} onClick={onClear}>Clear</button>
      </div>
      <div className="button-editor-actions button-fan-builder__commit-actions">
        <button type="button" disabled={busy || selectedCount === 0} onClick={onBuildNewFan}>
          {selectedCount > 0 ? `Build new Fan from ${selectedCount}` : "Build new Fan"}
        </button>
        {activeFanName && onUpdateActiveFan ? (
          <button type="button" disabled={busy || selectedCount === 0} onClick={onUpdateActiveFan}>
            Update {activeFanName}
          </button>
        ) : null}
      </div>
      <p className="button-fan-builder__note">
        The panel Button is added automatically. Tool Set owners stay separate specialized popouts.
      </p>
    </section>
  );
}
