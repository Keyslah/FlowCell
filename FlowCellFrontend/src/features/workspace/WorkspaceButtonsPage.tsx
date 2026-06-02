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
  buttonOptionsDisabled: boolean;
  deleteSelectionDisabled: boolean;
  deletePanelDisabled: boolean;
  allWorkspaceButtonsSelected: boolean;
  workspaceSelectableButtonCount: number;
  getSmartAxisState: (ownerButtonId: string) => WorkspaceSmartAxisVisualState;
  onAddScript: () => void;
  onAddMacro: () => void;
  onPanelFan: () => void;
  onPanelPop: () => void;
  onOpenButtonReorder: () => void;
  onOpenButtonOptions: () => void;
  onPanelFanOptions: () => void;
  onDeleteSelection: () => void;
  onDeletePanel: () => void;
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
  buttonOptionsDisabled,
  deleteSelectionDisabled,
  deletePanelDisabled,
  allWorkspaceButtonsSelected,
  workspaceSelectableButtonCount,
  getSmartAxisState,
  onAddScript,
  onAddMacro,
  onPanelFan,
  onPanelPop,
  onOpenButtonReorder,
  onOpenButtonOptions,
  onPanelFanOptions,
  onDeleteSelection,
  onDeletePanel,
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
            label="Delete Selection"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            autoInlineSize={Boolean(miscImportedSkin)}
            targetHeight={44}
            disabled={deleteSelectionDisabled}
            onClick={onDeleteSelection}
          />
          <HostSkinButton
            type="button"
            label="Delete Panel"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            autoInlineSize={Boolean(miscImportedSkin)}
            targetHeight={44}
            disabled={deletePanelDisabled}
            onClick={onDeletePanel}
          />
          <HostSkinButton
            type="button"
            label="Add Script"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            autoInlineSize={Boolean(miscImportedSkin)}
            targetHeight={44}
            onClick={onAddScript}
          />
          <HostSkinButton
            type="button"
            label="Fan"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            autoInlineSize={Boolean(miscImportedSkin)}
            targetHeight={44}
            onClick={onPanelFan}
          />
          <HostSkinButton
            type="button"
            label={selectedPanel.IsPoppedOut ? "Dock" : "Pop"}
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            autoInlineSize={Boolean(miscImportedSkin)}
            targetHeight={44}
            onClick={onPanelPop}
          />
          <HostSkinButton
            type="button"
            label="Reorder"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            autoInlineSize={Boolean(miscImportedSkin)}
            targetHeight={44}
            disabled={selectedPanel.Buttons.length <= 1}
            onClick={onOpenButtonReorder}
          />
          <HostSkinButton
            type="button"
            label="Button Options"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            autoInlineSize={Boolean(miscImportedSkin)}
            targetHeight={44}
            disabled={buttonOptionsDisabled}
            onClick={onOpenButtonOptions}
          />
          <HostSkinButton
            type="button"
            label="Fan Options"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            autoInlineSize={Boolean(miscImportedSkin)}
            targetHeight={44}
            onClick={onPanelFanOptions}
          />
          <HostSkinButton
            type="button"
            label="Add Macro"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            autoInlineSize={Boolean(miscImportedSkin)}
            targetHeight={44}
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
