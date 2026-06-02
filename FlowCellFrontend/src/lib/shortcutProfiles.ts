import {
  canonicalizeShortcut,
  formatShortcutForDisplay,
  normalizeShortcut,
  parseShortcutInput
} from "./bindings";
import type {
  BindableButtonRecord,
  BindsWorkspaceData,
  ShortcutProfileDocument,
  ShortcutProfileEntry
} from "../types";

export const UNBOUND_SHORTCUT_LABEL = "Unbound";

type ShortcutOwner = {
  label: string;
  shortcut: string;
};

type ResolvedShortcutProfiles = {
  programProfileId: string;
  programProfileLabel: string;
  windowsRestrictions: Map<string, ShortcutProfileEntry>;
  programRestrictions: Map<string, ShortcutProfileEntry>;
  preferred: string[];
};

type ShortcutRestriction = {
  label: string;
};

const PROGRAM_PROFILE_ID_MAP: Array<{
  match: string;
  profileId: string;
  label: string;
}> = [
  { match: "windows", profileId: "windows", label: "Windows" },
  { match: "photoshop", profileId: "adobe.photoshop.windows", label: "Photoshop" },
  { match: "illustrator", profileId: "adobe.illustrator.windows", label: "Illustrator" },
  { match: "blender", profileId: "blender.windows", label: "Blender" }
];

function pushUniqueShortcut(values: string[], value: string) {
  const canonical = canonicalizeShortcut(value);
  if (!canonical) {
    return;
  }

  const normalized = normalizeShortcut(canonical);
  if (!values.some((entry) => normalizeShortcut(entry) === normalized)) {
    values.push(canonical);
  }
}

function normalizeBindingTarget(value: string): string {
  return value.trim().replace(/\//g, "\\").toLowerCase();
}

function buildBindingOwnerKey(programTabId: number, target: string): string {
  return `${programTabId}:${normalizeBindingTarget(target)}`;
}

function resolveProgramProfileMatch(programName: string | undefined) {
  const normalizedProgramName = (programName ?? "").trim().toLowerCase();
  for (const entry of PROGRAM_PROFILE_ID_MAP) {
    if (normalizedProgramName.includes(entry.match)) {
      return entry;
    }
  }

  return {
    match: "flowcell",
    profileId: "flowcell",
    label: "FlowCell"
  };
}

function upsertRestriction(
  target: Map<string, ShortcutProfileEntry>,
  entry: ShortcutProfileEntry | null | undefined
) {
  const canonical = canonicalizeShortcut(entry?.shortcut ?? "");
  if (!canonical) {
    return;
  }

  target.set(normalizeShortcut(canonical), {
    shortcut: canonical,
    display: entry?.display?.trim() || formatShortcutForDisplay(canonical),
    reason: entry?.reason?.trim() || "",
    source: entry?.source?.trim() || ""
  });
}

function sortShortcutProfileDocuments(
  documents: ShortcutProfileDocument[]
): ShortcutProfileDocument[] {
  return [...documents].sort((left, right) => {
    if (left.isLocalOverride !== right.isLocalOverride) {
      return left.isLocalOverride ? 1 : -1;
    }

    return left.fileName.localeCompare(right.fileName, undefined, { sensitivity: "base" });
  });
}

export function buildShortcutCandidatePool(): string[] {
  const shortcuts: string[] = [];
  for (let index = 1; index <= 9; index += 1) {
    shortcuts.push(`^+${index}`);
  }
  for (let index = 1; index <= 9; index += 1) {
    shortcuts.push(`^!${index}`);
  }
  for (let index = 1; index <= 9; index += 1) {
    shortcuts.push(`^!+${index}`);
  }
  for (let index = 6; index <= 12; index += 1) {
    shortcuts.push(`F${index}`);
  }
  for (let index = 1; index <= 12; index += 1) {
    shortcuts.push(`^+F${index}`);
  }
  for (let index = 1; index <= 12; index += 1) {
    shortcuts.push(`^!F${index}`);
  }

  return shortcuts.map((shortcut) => canonicalizeShortcut(shortcut)).filter(Boolean);
}

function resolveShortcutProfiles(
  documents: ShortcutProfileDocument[],
  programName: string
): ResolvedShortcutProfiles {
  const profileMatch = resolveProgramProfileMatch(programName);
  const sortedDocuments = sortShortcutProfileDocuments(documents);
  const windowsDocuments = sortedDocuments.filter((document) => document.profileId === "windows");
  const programDocuments =
    profileMatch.profileId === "windows"
      ? []
      : sortedDocuments.filter((document) => document.profileId === profileMatch.profileId);
  const restrictionsWindows = new Map<string, ShortcutProfileEntry>();
  const restrictionsProgram = new Map<string, ShortcutProfileEntry>();
  const preferred: string[] = [];

  for (const document of windowsDocuments) {
    document.profile.blocked?.forEach((entry) => upsertRestriction(restrictionsWindows, entry));
    document.profile.reserved?.forEach((entry) => upsertRestriction(restrictionsWindows, entry));
    document.profile.preferred?.forEach((shortcut) => pushUniqueShortcut(preferred, shortcut));
  }

  for (const document of programDocuments) {
    document.profile.blocked?.forEach((entry) => upsertRestriction(restrictionsProgram, entry));
    document.profile.reserved?.forEach((entry) => upsertRestriction(restrictionsProgram, entry));
    document.profile.preferred?.forEach((shortcut) => pushUniqueShortcut(preferred, shortcut));
  }

  return {
    programProfileId: profileMatch.profileId,
    programProfileLabel: profileMatch.label,
    windowsRestrictions: restrictionsWindows,
    programRestrictions: restrictionsProgram,
    preferred
  };
}

function buildButtonLabelLookup(workspace: BindsWorkspaceData): Map<string, string> {
  const labels = new Map<string, string>();
  workspace.programs.forEach((program) => {
    program.panels.forEach((panel) => {
      panel.buttons.forEach((button) => {
        labels.set(buildBindingOwnerKey(program.programTabId, button.target), button.label);
        if (button.executionTarget?.trim()) {
          labels.set(
            buildBindingOwnerKey(program.programTabId, button.executionTarget),
            button.label
          );
        }
      });
    });
  });
  workspace.macros.forEach((macro) => {
    labels.set(buildBindingOwnerKey(0, macro.id), macro.label);
  });
  return labels;
}

function buildUsedShortcutOwnerMap(args: {
  workspace: BindsWorkspaceData;
  selectedButton?: BindableButtonRecord | null;
  selectedProgramTabId: number;
}): Map<string, ShortcutOwner> {
  const used = new Map<string, ShortcutOwner>();
  const selectedButton = args.selectedButton ?? null;
  const selectedBindingId = selectedButton?.bindingId ?? 0;
  const selectedTargetKey = selectedButton
    ? buildBindingOwnerKey(args.selectedProgramTabId, selectedButton.target)
    : "";
  const selectedActionId =
    selectedButton?.kind?.trim().toLowerCase() === "macro"
      ? selectedButton.target.trim()
      : "";
  const selectedExecutionTargetKey =
    selectedButton?.executionTarget?.trim()
      ? buildBindingOwnerKey(args.selectedProgramTabId, selectedButton.executionTarget)
      : "";
  const buttonLabels = buildButtonLabelLookup(args.workspace);

  args.workspace.bindings.scriptBindings.forEach((binding) => {
    const bindingId = binding.id ?? binding.bindingId ?? 0;
    const bindingProgramTabId = binding.programTabId ?? 0;
    const bindingTargetKey = buildBindingOwnerKey(bindingProgramTabId, binding.target ?? "");
    const isSelectedBinding =
      (selectedBindingId > 0 && bindingId === selectedBindingId) ||
      (bindingProgramTabId === args.selectedProgramTabId &&
        (bindingTargetKey === selectedTargetKey ||
          bindingTargetKey === selectedExecutionTargetKey));
    if (isSelectedBinding) {
      return;
    }

    const normalizedShortcut = normalizeShortcut(binding.shortcut);
    if (!normalizedShortcut) {
      return;
    }

    used.set(normalizedShortcut, {
      label:
        buttonLabels.get(bindingTargetKey) ??
        binding.label?.trim() ??
        binding.target?.trim() ??
        "another FlowCell button",
      shortcut: binding.shortcut
    });
  });

  Object.entries(args.workspace.bindings.actionHotkeys).forEach(([actionId, shortcut]) => {
    if (selectedActionId && actionId.localeCompare(selectedActionId, undefined, { sensitivity: "accent" }) === 0) {
      return;
    }

    const normalizedShortcut = normalizeShortcut(shortcut);
    if (!normalizedShortcut) {
      return;
    }

    used.set(normalizedShortcut, {
      label: buttonLabels.get(buildBindingOwnerKey(0, actionId)) ?? `Action: ${actionId}`,
      shortcut
    });
  });

  return used;
}

function resolveShortcutRestriction(
  shortcut: string,
  profiles: ResolvedShortcutProfiles
): ShortcutRestriction | null {
  const normalizedShortcut = normalizeShortcut(shortcut);
  if (!normalizedShortcut) {
    return null;
  }

  if (profiles.windowsRestrictions.has(normalizedShortcut)) {
    return {
      label: "Windows"
    };
  }

  if (profiles.programRestrictions.has(normalizedShortcut)) {
    return {
      label: profiles.programProfileLabel
    };
  }

  return null;
}

export function formatBoundShortcut(shortcut: string | undefined): string {
  const canonical = canonicalizeShortcut(shortcut ?? "");
  if (!canonical) {
    return UNBOUND_SHORTCUT_LABEL;
  }

  return formatShortcutForDisplay(canonical);
}

export function computeAvailableShortcutChoices(args: {
  workspace: BindsWorkspaceData;
  programName: string;
  programTabId: number;
  selectedButton?: BindableButtonRecord | null;
}): string[] {
  const profiles = resolveShortcutProfiles(args.workspace.shortcutProfiles, args.programName);
  const usedShortcutOwners = buildUsedShortcutOwnerMap({
    workspace: args.workspace,
    selectedButton: args.selectedButton,
    selectedProgramTabId: args.programTabId
  });
  const currentShortcut = canonicalizeShortcut(args.selectedButton?.shortcut ?? "");
  const currentShortcutNormalized = normalizeShortcut(currentShortcut);
  const orderedCandidates: string[] = [];

  profiles.preferred.forEach((shortcut) => pushUniqueShortcut(orderedCandidates, shortcut));
  buildShortcutCandidatePool().forEach((shortcut) => pushUniqueShortcut(orderedCandidates, shortcut));

  const available = orderedCandidates.filter((shortcut) => {
    const normalizedShortcut = normalizeShortcut(shortcut);
    if (!normalizedShortcut) {
      return false;
    }
    if (normalizedShortcut === currentShortcutNormalized) {
      return true;
    }
    if (resolveShortcutRestriction(shortcut, profiles)) {
      return false;
    }
    return !usedShortcutOwners.has(normalizedShortcut);
  });

  if (
    currentShortcutNormalized &&
    !available.some((shortcut) => normalizeShortcut(shortcut) === currentShortcutNormalized)
  ) {
    available.unshift(currentShortcut);
  }

  return available;
}

export function buildShortcutPickerOptions(shortcuts: string[]): string[] {
  const options = [UNBOUND_SHORTCUT_LABEL];
  shortcuts.forEach((shortcut) => {
    const displayShortcut = formatShortcutForDisplay(shortcut);
    if (displayShortcut && !options.includes(displayShortcut)) {
      options.push(displayShortcut);
    }
  });
  return options;
}

export function validateShortcutInput(args: {
  rawValue: string;
  workspace: BindsWorkspaceData;
  programName: string;
  programTabId: number;
  selectedButton?: BindableButtonRecord | null;
}):
  | {
      ok: true;
      shortcut: string;
    }
  | {
      ok: false;
      message: string;
    } {
  const rawValue = args.rawValue.trim();
  if (!rawValue || rawValue.localeCompare(UNBOUND_SHORTCUT_LABEL, undefined, { sensitivity: "accent" }) === 0) {
    return {
      ok: true,
      shortcut: ""
    };
  }

  const parsedShortcut = parseShortcutInput(rawValue);
  const shortcut = canonicalizeShortcut(parsedShortcut);
  if (!shortcut) {
    return {
      ok: false,
      message: "Shortcut is not valid."
    };
  }

  const selectedCurrentShortcut = canonicalizeShortcut(args.selectedButton?.shortcut ?? "");
  const selectedCurrentShortcutNormalized = normalizeShortcut(selectedCurrentShortcut);
  const shortcutNormalized = normalizeShortcut(shortcut);
  if (shortcutNormalized && shortcutNormalized === selectedCurrentShortcutNormalized) {
    return {
      ok: true,
      shortcut: selectedCurrentShortcut
    };
  }

  const profiles = resolveShortcutProfiles(args.workspace.shortcutProfiles, args.programName);
  const restriction = resolveShortcutRestriction(shortcut, profiles);
  if (restriction) {
    return {
      ok: false,
      message: `Shortcut is reserved by ${restriction.label}.`
    };
  }

  const usedShortcutOwners = buildUsedShortcutOwnerMap({
    workspace: args.workspace,
    selectedButton: args.selectedButton,
    selectedProgramTabId: args.programTabId
  });
  const owner = usedShortcutOwners.get(shortcutNormalized);
  if (owner) {
    return {
      ok: false,
      message: `Shortcut is already bound to ${owner.label}.`
    };
  }

  return {
    ok: true,
    shortcut
  };
}
