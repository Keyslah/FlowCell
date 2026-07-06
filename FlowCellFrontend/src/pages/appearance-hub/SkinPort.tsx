// SkinPort — the ONLY module live FlowCell code may import from the
// appearance system. Every placement (main page, popped, fan) resolves hub
// skins exclusively through these exports; all compile/sizing/latch logic
// stays behind this file inside the appearance-hub folder.
//
// Law: the skin dictates its shape and natural size; the user's uniform
// scale multiplies it; the host only reads the result (footprint fields on
// the compiled ImportedSkin) to place neighbors and size windows. The hitbox
// is the skin's shaped interactive core, never a host-invented rectangle.
//
// Kill switch: set SKIN_PORT_ENABLED to false and every live surface renders
// stock, instantly, with assignments left intact in storage.

import { useMemo } from "react";
import type { FlowCellButton, ImportedSkin } from "../../types";
import {
  HUB_PANEL_BUTTON_KEY,
  resolveHubLabelOverride,
  resolveHubLiveSkin,
  useHubSkinRevision,
  type HubPlacement
} from "./liveBridge";

export { HUB_PANEL_BUTTON_KEY };
export type { HubPlacement };

export const SKIN_PORT_ENABLED = true;

export type SkinPortAddress = {
  programName: string;
  panelName: string;
  buttonKey: string;
  placement: HubPlacement;
};

export type SkinPortResolution = {
  importedSkin: ImportedSkin;
  labelOverride?: string;
};

export function resolveSkinPort(address: SkinPortAddress): SkinPortResolution | null {
  if (!SKIN_PORT_ENABLED) {
    return null;
  }
  const { programName, panelName, buttonKey, placement } = address;
  if (!programName || !panelName || !buttonKey) {
    return null;
  }
  const importedSkin = resolveHubLiveSkin(programName, panelName, buttonKey, placement);
  if (!importedSkin) {
    return null;
  }
  return {
    importedSkin,
    labelOverride: resolveHubLabelOverride(programName, panelName, buttonKey, placement)
  };
}

// Re-render hook: bumps whenever hub assignments change in any window.
export function useSkinPortRevision(): number {
  return useHubSkinRevision();
}

export function useSkinPort(address: SkinPortAddress | null): SkinPortResolution | null {
  const revision = useSkinPortRevision();
  return useMemo(() => {
    void revision;
    return address ? resolveSkinPort(address) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    address?.programName,
    address?.panelName,
    address?.buttonKey,
    address?.placement,
    revision
  ]);
}

// Fan resolver: the owner pill maps to the panel-button address, children map
// to their script file names. Passed to FanOutButtonCluster's hubSkinResolver
// prop; returns undefined for buttons without a hub skin so the cluster's
// stock path runs untouched.
export function createFanSkinPortResolver(
  programName: string,
  panelName: string
): (button: FlowCellButton) => ImportedSkin | undefined {
  return (button: FlowCellButton) => {
    if (!SKIN_PORT_ENABLED) {
      return undefined;
    }
    const buttonKey =
      button.Kind === "panel_fan_owner"
        ? HUB_PANEL_BUTTON_KEY
        : (button.Target || button.Id || "").trim();
    if (!buttonKey) {
      return undefined;
    }
    return resolveHubLiveSkin(programName, panelName, buttonKey, "fan");
  };
}
