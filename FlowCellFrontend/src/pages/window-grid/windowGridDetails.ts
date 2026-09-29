import type { RegisteredLayoutWindow } from "../../lib/layoutSnapshots.js";
import type { ButtonStateDocument } from "../../button/types.js";

export function resolveWindowGridDetails(
  meta: RegisteredLayoutWindow | null | undefined,
  document: ButtonStateDocument | null,
  nativeTitle: string
) {
  const unit = meta?.buttonPopoutUnitId ? document?.popoutUnits[meta.buttonPopoutUnitId] : undefined;
  const fan = meta?.buttonFanSetupId ? document?.fanSetups[meta.buttonFanSetupId] : undefined;
  const ownerId = unit?.ownerButtonId || fan?.panelOwnerButtonId || meta?.buttonOwnerId || meta?.panelOwnerButtonId;
  const owner = ownerId ? document?.buttons[ownerId] : undefined;
  const metadataText = (key: string) => typeof owner?.metadata[key] === "string" ? owner.metadata[key] as string : "";
  const program = meta?.programName?.trim() || fan?.programName || owner?.sourceIdentity?.displayProgramName || metadataText("programName") || "Other";
  const panel = meta?.panelName?.trim() || fan?.panelName || owner?.sourceIdentity?.displayPanelName || metadataText("panelName") || "";
  const nativeName = nativeTitle.replace(/^FlowCell\s*[-–—]\s*/i, "").trim();
  const members = (unit ? document?.surfaces[unit.surfaceId]?.placementIds ?? [] : fan?.fanMemberPlacementIds ?? [])
    .map((id) => document?.placements[id]?.buttonId)
    .map((id) => id ? document?.buttons[id]?.label.trim() : "")
    .filter((name): name is string => Boolean(name));
  const namedUnit = unit?.name.trim();
  const genericUnit = !namedUnit || /^(?:Regular Popout|\d+ Buttons?)$/i.test(namedUnit);
  const kind = meta?.kind === "installed-page" ? "Page"
    : meta?.kind === "button-editor" ? "Editor"
    : fan || unit?.interactionMode === "fan" ? "Fan"
    : unit?.kind === "tool-set" ? "Toolset" : meta?.kind === "button-popout" ? "Popout" : "Window";
  const title = meta?.kind === "button-editor" ? "Buttons Editor"
    : meta?.kind === "installed-page" ? nativeName || owner?.label || "Page"
    : fan?.name.trim() || (genericUnit ? owner?.label || (members.length === 1 ? members[0] : panel) : namedUnit)
      || owner?.label || nativeName || `${panel || program} ${kind}`;
  return { program, panel, title, kind, members: [...new Set(members)].join(", ") };
}
