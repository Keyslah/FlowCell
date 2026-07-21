import type {
  ButtonDesktopBounds,
  ButtonPopoutCloseRule,
  ButtonPopoutOpenRule,
  ButtonStateDocument,
  ButtonWindowFitMode
} from "../types";
import type {
  ButtonEditorButtonOption,
  ButtonEditorPlacementOption
} from "./buttonEditorSelection";

type PopoutPatch = {
  name?: string;
  openRule?: ButtonPopoutOpenRule;
  closeRule?: ButtonPopoutCloseRule;
  transparency?: number;
  pinnedDefault?: boolean;
  windowFitMode?: ButtonWindowFitMode;
};

type FanPatch = {
  name?: string;
  openRule?: ButtonPopoutOpenRule;
  closeRule?: ButtonPopoutCloseRule;
  pinnedDefault?: boolean;
  collapsedPanelOwnerBounds?: ButtonDesktopBounds;
  windowFitMode?: ButtonWindowFitMode;
};

function BoundsFields({
  label,
  bounds,
  onChange,
  includePosition = true
}: {
  label: string;
  bounds: ButtonDesktopBounds;
  onChange: (bounds: ButtonDesktopBounds) => void;
  includePosition?: boolean;
}) {
  return (
    <span className="button-surface-selector__bounds">
      <strong>{label}</strong>
      {(includePosition
        ? (["left", "top", "width", "height"] as const)
        : (["width", "height"] as const)
      ).map((key) => (
        <label key={key}>
          <span>{key === "left" ? "X" : key === "top" ? "Y" : key === "width" ? "W" : "H"}</span>
          <input
            type="number"
            min={key === "width" || key === "height" ? 1 : undefined}
            value={bounds[key]}
            onChange={(event) =>
              onChange({
                ...bounds,
                [key]: key === "width" || key === "height"
                  ? Math.max(1, Number(event.currentTarget.value))
                  : Number(event.currentTarget.value)
              })
            }
          />
        </label>
      ))}
    </span>
  );
}

export function ButtonSurfaceSelector({
  document,
  surfaceId,
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
  onPlacementChange,
  onSurfaceSizeChange,
  onDesktopBoundsChange,
  onPopoutChange,
  onFanSetupChange,
  onFanToolSetAnchorChange,
  onOpenWindow
}: {
  document: ButtonStateDocument;
  surfaceId: string;
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
  onSurfaceSizeChange?: (surfaceId: string, width: number, height: number) => void;
  onDesktopBoundsChange?: (unitId: string, bounds: ButtonDesktopBounds) => void;
  onPopoutChange?: (unitId: string, patch: PopoutPatch) => void;
  onFanSetupChange?: (setupId: string, patch: FanPatch) => void;
  onFanToolSetAnchorChange?: (
    setupId: string,
    ownerButtonId: string,
    bounds: ButtonDesktopBounds
  ) => void;
  onOpenWindow?: () => void | Promise<void>;
}) {
  const surface = document.surfaces[surfaceId];
  const unit = Object.values(document.popoutUnits).find((candidate) => candidate.surfaceId === surfaceId);
  const fanSetup = Object.values(document.fanSetups).find(
    (candidate) => candidate.fanSurfaceId === surfaceId
  );
  const buttonGroups = new Map<string, ButtonEditorButtonOption[]>();
  buttonOptions.forEach((option) => {
    const group = buttonGroups.get(option.group) ?? [];
    group.push(option);
    buttonGroups.set(option.group, group);
  });
  const desktop = unit?.desktopBounds ?? {
    left: 0,
    top: 0,
    width: surface?.width ?? 1,
    height: surface?.height ?? 1
  };

  return (
    <div className="button-surface-selector">
      <div className="button-surface-selector__navigation">
        <label>
          <span>1 Program</span>
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
          <span>2 Panel</span>
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
          <span>3 Button</span>
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
          <span>4 Placement</span>
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
      <div className="button-surface-selector__settings">
        {surface ? (
          <>
            <span className="button-surface-selector__current">
              <strong>{surface.name}</strong>
            </span>
            <BoundsFields
              label="Surface"
              bounds={{ left: 0, top: 0, width: surface.width, height: surface.height }}
              onChange={(bounds) => onSurfaceSizeChange?.(surface.id, bounds.width, bounds.height)}
              includePosition={false}
            />
          </>
        ) : null}
        {unit ? (
          <>
          <label className="button-surface-selector__name">
            <span>Popout name</span>
            <input value={unit.name} onChange={(event) => onPopoutChange?.(unit.id, { name: event.currentTarget.value })} />
          </label>
          <BoundsFields label="Desktop" bounds={desktop} onChange={(bounds) => onDesktopBoundsChange?.(unit.id, bounds)} />
          <label><span>Open</span><select value={unit.openRule} onChange={(event) => onPopoutChange?.(unit.id, { openRule: event.currentTarget.value as ButtonPopoutOpenRule })}><option value="toggle">Toggle</option><option value="click">Click</option><option value="hover">Hover</option><option value="manual">Manual</option></select></label>
          <label><span>Close</span><select value={unit.closeRule} onChange={(event) => onPopoutChange?.(unit.id, { closeRule: event.currentTarget.value as ButtonPopoutCloseRule })}><option value="toggle">Toggle</option><option value="escape">Escape</option><option value="hover-out">Hover out</option><option value="manual">Manual</option></select></label>
          <label><span>Transparency</span><input type="number" min={0} max={1} step={0.05} value={unit.transparency} onChange={(event) => onPopoutChange?.(unit.id, { transparency: Number(event.currentTarget.value) })} /></label>
          <label className="button-editor-check"><input type="checkbox" checked={unit.pinnedDefault} onChange={(event) => onPopoutChange?.(unit.id, { pinnedDefault: event.currentTarget.checked })} /><span>Pinned</span></label>
          <label><span>Window fit</span><select value={unit.windowFitMode ?? "surface"} onChange={(event) => onPopoutChange?.(unit.id, { windowFitMode: event.currentTarget.value as ButtonWindowFitMode })}><option value="surface">Saved Surface</option><option value="hitbox">All Button Hitboxes</option><option value="visual">Current Button Visuals</option></select></label>
          </>
        ) : null}
        {fanSetup ? (
          <>
          <label className="button-surface-selector__name">
            <span>Fan setup name</span>
            <input value={fanSetup.name} onChange={(event) => onFanSetupChange?.(fanSetup.id, { name: event.currentTarget.value })} />
          </label>
          {fanSetup.collapsedPanelOwnerBounds ? (
            <BoundsFields label="Panel owner desktop" bounds={fanSetup.collapsedPanelOwnerBounds} onChange={(bounds) => onFanSetupChange?.(fanSetup.id, { collapsedPanelOwnerBounds: bounds })} />
          ) : (
            <span className="button-surface-selector__bounds"><strong>Panel owner desktop</strong> Not placed yet — drag the fan window to set it.</span>
          )}
          <label><span>Open</span><select value={fanSetup.openRule} onChange={(event) => onFanSetupChange?.(fanSetup.id, { openRule: event.currentTarget.value as ButtonPopoutOpenRule })}><option value="toggle">Toggle</option><option value="click">Click</option><option value="hover">Hover</option><option value="manual">Manual</option></select></label>
          <label><span>Close</span><select value={fanSetup.closeRule} onChange={(event) => onFanSetupChange?.(fanSetup.id, { closeRule: event.currentTarget.value as ButtonPopoutCloseRule })}><option value="toggle">Toggle</option><option value="escape">Escape</option><option value="hover-out">Hover out</option><option value="manual">Manual</option></select></label>
          <label className="button-editor-check"><input type="checkbox" checked={fanSetup.pinnedDefault} onChange={(event) => onFanSetupChange?.(fanSetup.id, { pinnedDefault: event.currentTarget.checked })} /><span>Pinned</span></label>
          <label><span>Window fit</span><select value={fanSetup.windowFitMode ?? "surface"} onChange={(event) => onFanSetupChange?.(fanSetup.id, { windowFitMode: event.currentTarget.value as ButtonWindowFitMode })}><option value="surface">Saved Surface</option><option value="hitbox">All Button Hitboxes</option><option value="visual">Current Button Visuals</option></select></label>
          {fanSetup.selectedToolSetOwnerButtonIds.map((ownerButtonId) => {
            const anchor = fanSetup.toolSetOwnerAnchors[ownerButtonId];
            if (!anchor) return null;
            return (
              <BoundsFields
                key={ownerButtonId}
                label={`${document.buttons[ownerButtonId]?.label ?? ownerButtonId} owner desktop`}
                bounds={anchor}
                onChange={(bounds) => onFanToolSetAnchorChange?.(fanSetup.id, ownerButtonId, bounds)}
              />
            );
          })}
          </>
        ) : null}
        {unit || fanSetup ? (
          <>
            <button type="button" onClick={() => void onOpenWindow?.()}>
              {unit ? "Open Pop" : "Open Fan"}
            </button>
            <span className="button-surface-selector__hint">
              Editor frame updates immediately. Save keeps this fit; in the live window, hold Space and drag any Button to move it.
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
