import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { HostSkinButton } from "../../components/HostSkinButton";
import type {
  FlowCellButton,
  FlowCellPanel,
  FlowCellProgram,
  ImportedSkin,
  StyleGroup
} from "../../types";
import {
  ButtonGrid,
  type WorkspaceSelectedButtonRef,
  type WorkspaceSmartAxisAction,
  type WorkspaceSmartAxisVisualState
} from "./ButtonGrid";

interface WorkspaceButtonsPageProps {
  selectedProgram: FlowCellProgram;
  selectedPanel: FlowCellPanel;
  selectedButtonRef: WorkspaceSelectedButtonRef | null;
  selectedPopButtonIds: string[];
  styleGroups?: StyleGroup[];
  importedSkins?: ImportedSkin[];
  miscStyleGroup?: StyleGroup;
  miscImportedSkin?: ImportedSkin;
  mainButtonsStyleGroup?: StyleGroup;
  mainButtonsImportedSkin?: ImportedSkin;
  collapseSmartAxisToOwnerButton?: boolean;
  buttonAppearanceDisabled: boolean;
  buttonOptionsDisabled: boolean;
  allWorkspaceButtonsSelected: boolean;
  workspaceSelectableButtonCount: number;
  getSmartAxisState: (ownerButtonId: string) => WorkspaceSmartAxisVisualState;
  onAddScript: () => void;
  onAddMacro: () => void;
  onPanelFan: () => void;
  onPanelPop: () => void;
  onOpenButtonAppearance: () => void;
  onOpenButtonOptions: () => void;
  onPanelFanOptions: () => void;
  onToggleAllWorkspaceButtons: (checked: boolean) => void;
  onTogglePopSelection: (buttonId: string) => void;
  onFocusButton: (button: FlowCellButton) => void;
  onActivateButton: (button: FlowCellButton) => void;
  onButtonPointerDownCapture: (
    event: ReactPointerEvent<HTMLElement>,
    button: FlowCellButton
  ) => void;
  onButtonMouseDownCapture: (
    event: ReactMouseEvent<HTMLElement>,
    button: FlowCellButton
  ) => void;
  onButtonContextMenuCapture: (
    event: ReactMouseEvent<HTMLElement>,
    button: FlowCellButton
  ) => void;
  onSmartAxisAction: (buttons: FlowCellButton[], action: WorkspaceSmartAxisAction) => void;
  onOpenSmartAxisPopout: (buttons: FlowCellButton[]) => void;
}

export function WorkspaceButtonsPage({
  selectedProgram,
  selectedPanel,
  selectedButtonRef,
  selectedPopButtonIds,
  styleGroups,
  importedSkins,
  miscStyleGroup,
  miscImportedSkin,
  mainButtonsStyleGroup,
  mainButtonsImportedSkin,
  collapseSmartAxisToOwnerButton = false,
  buttonAppearanceDisabled,
  buttonOptionsDisabled,
  allWorkspaceButtonsSelected,
  workspaceSelectableButtonCount,
  getSmartAxisState,
  onAddScript,
  onAddMacro,
  onPanelFan,
  onPanelPop,
  onOpenButtonAppearance,
  onOpenButtonOptions,
  onPanelFanOptions,
  onToggleAllWorkspaceButtons,
  onTogglePopSelection,
  onFocusButton,
  onActivateButton,
  onButtonPointerDownCapture,
  onButtonMouseDownCapture,
  onButtonContextMenuCapture,
  onSmartAxisAction,
  onOpenSmartAxisPopout
}: WorkspaceButtonsPageProps) {
  return (
    <>
      <div className="surface-header">
        <div className="surface-header__meta">
          <h1>Buttons</h1>
          <span className="surface-header__panel-name">{selectedPanel.Name}</span>
        </div>
        <div className="surface-toolbar">
          <label className="button-host__toggle surface-toolbar__toggle">
            <input
              type="checkbox"
              checked={allWorkspaceButtonsSelected}
              disabled={workspaceSelectableButtonCount === 0}
              onChange={(event) => onToggleAllWorkspaceButtons(event.target.checked)}
            />
            <span>
              {allWorkspaceButtonsSelected ? "Uncheck All" : "Select All"}
            </span>
          </label>
          <HostSkinButton
            type="button"
            label="Add Script"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            onClick={onAddScript}
          />
          <HostSkinButton
            type="button"
            label="Fan"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            onClick={onPanelFan}
          />
          <HostSkinButton
            type="button"
            label={selectedPanel.IsPoppedOut ? "Dock" : "Pop"}
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            onClick={onPanelPop}
          />
          <HostSkinButton
            type="button"
            label="Button Appearance"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            disabled={buttonAppearanceDisabled}
            onClick={onOpenButtonAppearance}
          />
          <HostSkinButton
            type="button"
            label="Button Options"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            disabled={buttonOptionsDisabled}
            onClick={onOpenButtonOptions}
          />
          <HostSkinButton
            type="button"
            label="Fan Options"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            onClick={onPanelFanOptions}
          />
          <HostSkinButton
            type="button"
            label="Add Macro"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            onClick={onAddMacro}
          />
        </div>
      </div>
      <ButtonGrid
        selectedProgram={selectedProgram}
        selectedPanel={selectedPanel}
        selectedButtonRef={selectedButtonRef}
        selectedPopButtonIds={selectedPopButtonIds}
        styleGroups={styleGroups}
        importedSkins={importedSkins}
        mainButtonsStyleGroup={mainButtonsStyleGroup}
        mainButtonsImportedSkin={mainButtonsImportedSkin}
        collapseSmartAxisToOwnerButton={collapseSmartAxisToOwnerButton}
        getSmartAxisState={getSmartAxisState}
        onTogglePopSelection={onTogglePopSelection}
        onFocusButton={onFocusButton}
        onActivateButton={onActivateButton}
        onButtonPointerDownCapture={onButtonPointerDownCapture}
        onButtonMouseDownCapture={onButtonMouseDownCapture}
        onButtonContextMenuCapture={onButtonContextMenuCapture}
        onSmartAxisAction={onSmartAxisAction}
        onOpenSmartAxisPopout={onOpenSmartAxisPopout}
      />
    </>
  );
}
