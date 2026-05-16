import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import {
  HostSkinButton,
  resolveMainButtonFootprintOverride
} from "../../components/HostSkinButton";
import { SmartAxisStrip } from "../../components/ToolSurfaces";
import { getImportedSkin, resolveStyleGroup } from "../../lib/skins";
import {
  getSmartAxisCommandForButton,
  isAlignmentOwnerButton,
  isFlattenRevolveOwnerButton,
  isHdriWorldOwnerButton,
  isQuickRotateGroupOwnerButton,
  isRegularPopCandidate,
  isSmartAxisButton,
  isSmartAxisOwnerButton
} from "../../lib/state";
import type {
  FlowCellButton,
  FlowCellPanel,
  FlowCellProgram,
  ImportedSkin,
  StyleGroup
} from "../../types";

export interface WorkspaceSelectedButtonRef {
  programId: number;
  panelId: string;
  buttonId: string;
}

export interface WorkspaceSmartAxisVisualState {
  Modes: {
    X: string;
    Y: string;
    Z: string;
  };
  LiveEnabled: boolean;
  RunnerActive: boolean;
  Registered: boolean;
  LastMessage: string;
}

interface BuildPanelRenderItemsOptions {
  collapseSmartAxisToOwnerButton?: boolean;
}

type PanelRenderItem =
  | {
      kind: "button";
      button: FlowCellButton;
    }
  | {
      kind: "smart-axis";
      ownerButton: FlowCellButton;
      buttons: FlowCellButton[];
    };

export type WorkspaceSmartAxisAction =
  | "baseline"
  | "cycle_x"
  | "cycle_y"
  | "cycle_z"
  | "toggle_live";

interface ButtonGridProps {
  selectedProgram: FlowCellProgram;
  selectedPanel: FlowCellPanel;
  selectedButtonRef: WorkspaceSelectedButtonRef | null;
  selectedPopButtonIds: string[];
  styleGroups?: StyleGroup[];
  importedSkins?: ImportedSkin[];
  mainButtonsStyleGroup?: StyleGroup;
  mainButtonsImportedSkin?: ImportedSkin;
  collapseSmartAxisToOwnerButton?: boolean;
  getSmartAxisState: (ownerButtonId: string) => WorkspaceSmartAxisVisualState;
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

function isToolOwnerPopCandidate(button: FlowCellButton): boolean {
  return (
    isAlignmentOwnerButton(button) ||
    isFlattenRevolveOwnerButton(button) ||
    isHdriWorldOwnerButton(button) ||
    isQuickRotateGroupOwnerButton(button) ||
    isSmartAxisOwnerButton(button)
  );
}

function isBlenderToolSetPanel(
  program: FlowCellProgram,
  panel: FlowCellPanel
): boolean {
  const normalizedProgram =
    program.ProgramConfig?.NormalizedName?.trim().toLowerCase() ?? "";
  return normalizedProgram === "blender" && panel.Name.trim().toLowerCase() === "tool set";
}

export function buildPanelRenderItems(
  buttons: FlowCellButton[],
  options?: BuildPanelRenderItemsOptions
): PanelRenderItem[] {
  const smartAxisButtons = buttons.filter(isSmartAxisButton);
  const orderedSmartAxisButtons = [
    smartAxisButtons.find((button) => getSmartAxisCommandForButton(button) === "baseline"),
    smartAxisButtons.find((button) => getSmartAxisCommandForButton(button) === "cycle_x"),
    smartAxisButtons.find((button) => getSmartAxisCommandForButton(button) === "cycle_y"),
    smartAxisButtons.find((button) => getSmartAxisCommandForButton(button) === "cycle_z"),
    smartAxisButtons.find((button) => getSmartAxisCommandForButton(button) === "toggle_live")
  ].filter((button): button is FlowCellButton => Boolean(button));

  const items: PanelRenderItem[] = [];
  let smartAxisRendered = false;
  const smartAxisOwnerButton =
    orderedSmartAxisButtons.find((entry) => isSmartAxisOwnerButton(entry)) ??
    orderedSmartAxisButtons[0];

  buttons.forEach((button) => {
    if (isSmartAxisButton(button)) {
      if (smartAxisRendered) {
        return;
      }
      smartAxisRendered = true;
      if (smartAxisOwnerButton) {
        if (options?.collapseSmartAxisToOwnerButton) {
          items.push({
            kind: "button",
            button: smartAxisOwnerButton
          });
          return;
        }
        items.push({
          kind: "smart-axis",
          ownerButton: smartAxisOwnerButton,
          buttons: orderedSmartAxisButtons
        });
      }
      return;
    }

    items.push({
      kind: "button",
      button
    });
  });

  return items;
}

export function ButtonGrid({
  selectedProgram,
  selectedPanel,
  selectedButtonRef,
  selectedPopButtonIds,
  styleGroups,
  importedSkins,
  mainButtonsStyleGroup,
  mainButtonsImportedSkin,
  collapseSmartAxisToOwnerButton = false,
  getSmartAxisState,
  onTogglePopSelection,
  onFocusButton,
  onActivateButton,
  onButtonPointerDownCapture,
  onButtonMouseDownCapture,
  onButtonContextMenuCapture,
  onSmartAxisAction,
  onOpenSmartAxisPopout
}: ButtonGridProps) {
  const panelRenderItems = buildPanelRenderItems(selectedPanel.Buttons, {
    collapseSmartAxisToOwnerButton
  });
  const toolSetPanel = isBlenderToolSetPanel(selectedProgram, selectedPanel);

  return (
    <div
      className={
        toolSetPanel
          ? "button-grid button-grid--tool-set"
          : "button-grid button-grid--variable-hosts"
      }
    >
      {panelRenderItems.map((item) =>
        item.kind === "smart-axis" ? (
          <div
            key={item.ownerButton.Id}
            className="button-host button-host--smart-axis"
          >
            <SmartAxisStrip
              label={item.ownerButton.Label}
              panelName={selectedPanel.Name}
              state={getSmartAxisState(item.ownerButton.Id)}
              onAction={(action) => {
                onSmartAxisAction(item.buttons, action);
              }}
              onPopout={() => {
                onOpenSmartAxisPopout(item.buttons);
              }}
            />
          </div>
        ) : (
          <MainButtonHost
            key={item.button.Id}
            button={item.button}
            selectedProgram={selectedProgram}
            selectedPanel={selectedPanel}
            selectedButtonRef={selectedButtonRef}
            selectedPopButtonIds={selectedPopButtonIds}
            styleGroups={styleGroups}
            importedSkins={importedSkins}
            mainButtonsStyleGroup={mainButtonsStyleGroup}
            mainButtonsImportedSkin={mainButtonsImportedSkin}
            onTogglePopSelection={onTogglePopSelection}
            onFocusButton={onFocusButton}
            onActivateButton={onActivateButton}
            onButtonPointerDownCapture={onButtonPointerDownCapture}
            onButtonMouseDownCapture={onButtonMouseDownCapture}
            onButtonContextMenuCapture={onButtonContextMenuCapture}
          />
        )
      )}
    </div>
  );
}

interface MainButtonHostProps {
  button: FlowCellButton;
  selectedProgram: FlowCellProgram;
  selectedPanel: FlowCellPanel;
  selectedButtonRef: WorkspaceSelectedButtonRef | null;
  selectedPopButtonIds: string[];
  styleGroups?: StyleGroup[];
  importedSkins?: ImportedSkin[];
  mainButtonsStyleGroup?: StyleGroup;
  mainButtonsImportedSkin?: ImportedSkin;
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
}

function MainButtonHost({
  button,
  selectedProgram,
  selectedPanel,
  selectedButtonRef,
  selectedPopButtonIds,
  styleGroups,
  importedSkins,
  mainButtonsStyleGroup,
  mainButtonsImportedSkin,
  onTogglePopSelection,
  onFocusButton,
  onActivateButton,
  onButtonPointerDownCapture,
  onButtonMouseDownCapture,
  onButtonContextMenuCapture
}: MainButtonHostProps) {
  const checkedForPop = selectedPopButtonIds.includes(button.Id);
  const specificButtonStyleGroup = resolveStyleGroup(styleGroups, button.style_group_id ?? "");
  const buttonStyleGroup = specificButtonStyleGroup ?? mainButtonsStyleGroup;
  const specificButtonImportedSkin =
    specificButtonStyleGroup?.skinId === "imported-skin"
      ? getImportedSkin(importedSkins, specificButtonStyleGroup.importedSkinId)
      : undefined;
  const buttonImportedSkin =
    getImportedSkin(importedSkins, buttonStyleGroup?.importedSkinId) ??
    mainButtonsImportedSkin;
  const explicitFootprint = resolveMainButtonFootprintOverride(specificButtonImportedSkin);
  const isToolbarEventTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement && Boolean(target.closest(".button-host__toolbar"));

  return (
    <div
      className={`button-host ${isAlignmentOwnerButton(button) || isFlattenRevolveOwnerButton(button) || isHdriWorldOwnerButton(button) || isQuickRotateGroupOwnerButton(button) || isSmartAxisOwnerButton(button) ? "button-host--compound" : ""}`}
      onPointerDownCapture={(event) => {
        if (isToolbarEventTarget(event.target)) {
          return;
        }
        onButtonPointerDownCapture(event, button);
      }}
      onMouseDownCapture={(event) => {
        if (isToolbarEventTarget(event.target)) {
          return;
        }
        onButtonMouseDownCapture(event, button);
      }}
      onContextMenuCapture={(event) => {
        if (isToolbarEventTarget(event.target)) {
          return;
        }
        onButtonContextMenuCapture(event, button);
      }}
    >
      <div className="button-host__toolbar">
        <label className="button-host__toggle">
          <input
            type="checkbox"
            checked={checkedForPop}
            onChange={() => onTogglePopSelection(button.Id)}
          />
          <span>Select</span>
        </label>
      </div>
      <HostSkinButton
        type="button"
        label={button.Label}
        flowId={button.Id}
        title={button.Tooltip || button.Label}
        className="button-host__surface-button"
        styleGroup={buttonStyleGroup}
        importedSkin={buttonImportedSkin}
        footprintMode={buttonImportedSkin ? "default-axis-normalized" : undefined}
        footprintOverride={explicitFootprint}
        selected={false}
        hostMode="neutral"
        highlightKey={`button:${selectedProgram.ProgramTabId}:${selectedPanel.Id}:${button.Id}`}
        onFocus={() => onFocusButton(button)}
        onClick={() => {
          onFocusButton(button);
          onActivateButton(button);
        }}
      />
    </div>
  );
}
