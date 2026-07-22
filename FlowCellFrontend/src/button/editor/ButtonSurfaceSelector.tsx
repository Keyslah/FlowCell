import type {
  ButtonEditorButtonOption,
  ButtonEditorPlacementOption
} from "./buttonEditorSelection";

export function ButtonSurfaceSelector({
  programs,
  panels,
  buttonOptions,
  placementOptions,
  programName,
  panelName,
  navigationLocked = false,
  buttonId,
  placementId,
  onProgramChange,
  onPanelChange,
  onButtonChange,
  onPlacementChange
}: {
  programs: readonly string[];
  panels: readonly string[];
  buttonOptions: readonly ButtonEditorButtonOption[];
  placementOptions: readonly ButtonEditorPlacementOption[];
  programName: string;
  panelName: string;
  navigationLocked?: boolean;
  buttonId: string;
  placementId: string;
  onProgramChange: (programName: string) => void;
  onPanelChange: (panelName: string) => void;
  onButtonChange: (buttonId: string) => void;
  onPlacementChange: (placementId: string) => void;
}) {
  const buttonGroups = new Map<string, ButtonEditorButtonOption[]>();
  buttonOptions.forEach((option) => {
    const group = buttonGroups.get(option.group) ?? [];
    group.push(option);
    buttonGroups.set(option.group, group);
  });
  return (
    <div className="button-surface-selector">
      <div className="button-surface-selector__navigation">
        <label>
          <span>Program</span>
          <select
            value={programName}
            disabled={navigationLocked}
            onChange={(event) => onProgramChange(event.currentTarget.value)}
          >
            <option value="">Choose program</option>
            {programs.map((program) => <option key={program} value={program}>{program}</option>)}
          </select>
        </label>
        <label>
          <span>Panel</span>
          <select
            value={panelName}
            disabled={navigationLocked || !programName}
            onChange={(event) => onPanelChange(event.currentTarget.value)}
          >
            <option value="">Choose panel</option>
            {panels.map((panel) => <option key={panel} value={panel}>{panel}</option>)}
          </select>
        </label>
        <label>
          <span>Button</span>
          <select
            value={buttonId}
            disabled={!programName || !panelName}
            onChange={(event) => onButtonChange(event.currentTarget.value)}
          >
            <option value="">Choose Button</option>
            {[...buttonGroups.entries()].map(([group, options]) => (
              <optgroup key={group} label={group}>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          <span>Placement</span>
          <select
            value={placementId}
            disabled={!buttonId}
            onChange={(event) => onPlacementChange(event.currentTarget.value)}
          >
            <option value="">Choose placement</option>
            {placementOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
