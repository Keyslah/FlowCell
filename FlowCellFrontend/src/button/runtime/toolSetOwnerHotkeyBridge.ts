import type { ButtonStateDocument } from "../types.js";
import type { FlowCellBounds } from "../../types.js";

export const TOOL_SET_OWNER_HOTKEY_EVENT = "flowcell:tool-set-owner-hotkey";

export interface ToolSetOwnerHotkeyPayload {
  bindingId: number;
  shortcut: string;
  targetKind: "tool-set-owner";
  buttonId: string;
  ownerButtonId: string;
}

export interface ToolSetOwnerActivationTarget {
  programName: string;
  panelName: string;
  popoutUnitId: string;
  ownerButtonId: string;
  bounds?: FlowCellBounds;
}

export function ownerButtonIdFromHotkeyPayload(payload: ToolSetOwnerHotkeyPayload): string {
  const buttonId = payload.buttonId?.trim();
  const ownerButtonId = payload.ownerButtonId?.trim();
  if (payload.targetKind !== "tool-set-owner" || !buttonId || buttonId !== ownerButtonId) {
    throw new Error("Tool-set owner hotkey payload does not identify one canonical owner Button.");
  }
  return ownerButtonId;
}

export function resolveToolSetOwnerActivationTarget(
  document: ButtonStateDocument,
  rawOwnerButtonId: string
): ToolSetOwnerActivationTarget {
  const ownerButtonId = rawOwnerButtonId.trim();
  const owner = document.buttons[ownerButtonId];
  if (!owner || owner.id !== ownerButtonId || owner.role !== "tool-set-owner") {
    throw new Error(`Canonical tool-set owner Button '${ownerButtonId}' was not found.`);
  }

  const identity = owner.sourceIdentity;
  const programName = identity?.displayProgramName.trim() ?? "";
  const panelName = identity?.displayPanelName.trim() ?? "";
  if (!programName || !panelName) {
    throw new Error(`Tool-set owner Button '${ownerButtonId}' has no canonical source identity.`);
  }

  const units = Object.values(document.popoutUnits).filter(
    (candidate) => candidate.kind === "tool-set" && candidate.ownerButtonId === ownerButtonId
  );
  if (units.length !== 1) {
    throw new Error(
      `Tool-set owner Button '${ownerButtonId}' must own exactly one canonical popout; found ${units.length}.`
    );
  }
  const unit = units[0];
  const bounds = unit.desktopBounds
    ? {
        Left: unit.desktopBounds.left,
        Top: unit.desktopBounds.top,
        Width: unit.desktopBounds.width,
        Height: unit.desktopBounds.height
      }
    : undefined;

  return {
    programName,
    panelName,
    popoutUnitId: unit.id,
    ownerButtonId,
    bounds
  };
}
