import type { ButtonFanAnimationSettings, ButtonStateDocument } from "../types.js";
import { placementMatchesThemeTarget } from "../../theme/themeModel.js";
import { findPanelOwnerButton } from "../state/panelOwnerButtonOperations.js";
import { resolveButtonFanStyle, type ButtonFanStyleDefinition } from "../fan/buttonFanMotion.js";
import { applyButtonFanDirection, type ButtonFanExpansionDirection } from "../fan/buttonFanDirection.js";

/** A panel's explicit Fan choice applies to live drafts without rewriting their saved settings. */
export function withCanonicalPanelFanMotion(
  draft: ButtonStateDocument,
  canonical: ButtonStateDocument | null
): ButtonStateDocument {
  if (!canonical) return draft;
  const animationForPanel = (programName: string, panelName: string): ButtonFanStyleDefinition["animation"] | null => {
    const style = findPanelOwnerButton(canonical, programName, panelName)?.metadata.panelFanMotionStyle;
    return resolveButtonFanStyle(style)?.animation ?? null;
  };
  const directionForPanel = (programName: string, panelName: string): ButtonFanExpansionDirection | null => {
    const direction = findPanelOwnerButton(canonical, programName, panelName)?.metadata.panelFanDirection;
    return direction === "left" || direction === "right" || direction === "top" || direction === "bottom" ? direction : null;
  };
  const directions: Array<{ target: Parameters<typeof applyButtonFanDirection>[1]; direction: ButtonFanExpansionDirection }> = [];
  const animationMatches = (animation: ButtonFanAnimationSettings | undefined, patch: ButtonFanStyleDefinition["animation"]) =>
    Object.entries(patch).every(([key, value]) => animation?.[key as keyof ButtonFanAnimationSettings] === value);
  let popoutUnits = draft.popoutUnits;
  let fanSetups = draft.fanSetups;
  for (const unit of Object.values(draft.popoutUnits)) {
    const owner = unit.ownerButtonId ? canonical.buttons[unit.ownerButtonId] ?? draft.buttons[unit.ownerButtonId] : null;
    let animationPatch: ButtonFanStyleDefinition["animation"] | null = null;
    let direction: ButtonFanExpansionDirection | null = null;
    if (owner?.role === "panel-owner" && typeof owner.metadata.programName === "string" &&
        typeof owner.metadata.panelName === "string") {
      animationPatch = animationForPanel(owner.metadata.programName, owner.metadata.panelName);
      direction = directionForPanel(owner.metadata.programName, owner.metadata.panelName);
    } else if (unit.kind === "tool-set" && owner?.sourceIdentity) {
      animationPatch = animationForPanel(owner.sourceIdentity.displayProgramName, owner.sourceIdentity.displayPanelName);
      direction = directionForPanel(owner.sourceIdentity.displayProgramName, owner.sourceIdentity.displayPanelName);
    } else if (unit.kind === "regular" && unit.memberSourceIdentities.length > 0) {
      const first = unit.memberSourceIdentities[0];
      if (unit.memberSourceIdentities.every((identity) =>
        identity.normalizedProgramName === first.normalizedProgramName &&
        identity.normalizedPanelName === first.normalizedPanelName)) {
        animationPatch = animationForPanel(first.displayProgramName, first.displayPanelName);
        direction = directionForPanel(first.displayProgramName, first.displayPanelName);
      }
    }
    if (direction && unit.ownerPlacementId && (unit.interactionMode === "fan" || unit.kind === "tool-set")) {
      directions.push({ direction, target: { surfaceId: unit.surfaceId, ownerPlacementId: unit.ownerPlacementId,
        memberPlacementIds: unit.kind === "regular" ? unit.memberPlacementIds : unit.childPlacementIds,
        popoutUnitId: unit.id } });
    }
    if (!animationPatch || animationMatches(unit.fanAnimation, animationPatch)) continue;
    if (popoutUnits === draft.popoutUnits) popoutUnits = { ...popoutUnits };
    popoutUnits[unit.id] = { ...unit, fanAnimation: {
      ...(unit.fanAnimation ?? { durationMs: 180, easing: "ease-out", staggerMs: 30 }), ...animationPatch
    } };
  }
  for (const setup of Object.values(draft.fanSetups)) {
    const direction = directionForPanel(setup.programName, setup.panelName);
    const ownerPlacementId = draft.surfaces[setup.fanSurfaceId]?.placementIds.find(id =>
      draft.placements[id]?.buttonId === setup.panelOwnerButtonId);
    if (direction && ownerPlacementId) directions.push({ direction, target: {
      surfaceId: setup.fanSurfaceId, ownerPlacementId, memberPlacementIds: setup.fanMemberPlacementIds
    } });
    const animationPatch = animationForPanel(setup.programName, setup.panelName);
    if (!animationPatch || animationMatches(setup.animation, animationPatch)) continue;
    if (fanSetups === draft.fanSetups) fanSetups = { ...fanSetups };
    fanSetups[setup.id] = { ...setup, animation: { ...setup.animation, ...animationPatch } };
  }
  let result = popoutUnits === draft.popoutUnits && fanSetups === draft.fanSetups
    ? draft : { ...draft, popoutUnits, fanSetups };
  for (const { target, direction } of directions) result = applyButtonFanDirection(result, target, direction);
  return result;
}

/** Program popout rules are canonical even while a Button editor owns its layout draft. */
export function withCanonicalProgramPopoutThemes(
  draft: ButtonStateDocument,
  canonical: ButtonStateDocument | null
): ButtonStateDocument {
  if (!canonical || (draft.programPopoutThemes === canonical.programPopoutThemes &&
    draft.programPopoutColorOverrides === canonical.programPopoutColorOverrides &&
    draft.programPopoutThemeLocks === canonical.programPopoutThemeLocks &&
    draft.programPopoutColorOverrideRevisions === canonical.programPopoutColorOverrideRevisions)) return draft;
  let overrides = canonical.programPopoutColorOverrides;
  let locks = canonical.programPopoutThemeLocks;
  for (const [id, appearance] of Object.entries(draft.programPopoutThemeLocks ?? {})) {
    // Only draft-only placements own their locks; canonical re-enabling must win.
    if (!canonical.placements[id] && draft.placements[id]) locks = { ...locks, [id]: appearance };
  }
  const revisions = draft.programPopoutColorOverrideRevisions
    ? { ...draft.programPopoutColorOverrideRevisions, ...canonical.programPopoutColorOverrideRevisions }
    : canonical.programPopoutColorOverrideRevisions;
  const programNames = Object.keys(draft.programPopoutColorOverrideRevisions ?? {});
  for (const [id, override] of Object.entries(draft.programPopoutColorOverrides ?? {})) {
    // Canonical placements use canonical presence or absence, so Reset cannot
    // resurrect an older exception. Only transient placements remain draft-owned.
    if (canonical.placements[id]) continue;
    const placement = draft.placements[id];
    if (!placement) continue;
    const programName = programNames.find((name) => placementMatchesThemeTarget(draft, placement, {
      kind: "program", programName: name, panelName: null
    }));
    if (!programName) continue;
    for (const channel of ["surface", "text"] as const) {
      const color = override[channel];
      if (!color || canonical.programPopoutColorOverrides?.[id]?.[channel] !== undefined) continue;
      const draftRevision = draft.programPopoutColorOverrideRevisions?.[programName]?.[channel] ?? 0;
      const canonicalRevision = canonical.programPopoutColorOverrideRevisions?.[programName]?.[channel] ?? 0;
      if (draftRevision !== canonicalRevision) continue;
      overrides = { ...overrides, [id]: { ...overrides?.[id], [channel]: color } };
    }
  }
  return {
    ...draft,
    programPopoutThemes: canonical.programPopoutThemes,
    programPopoutColorOverrides: overrides,
    programPopoutThemeLocks: locks,
    programPopoutColorOverrideRevisions: revisions
  };
}
