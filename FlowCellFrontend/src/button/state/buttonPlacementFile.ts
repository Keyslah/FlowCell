import {
  BUTTON_PLACEMENT_CYCLE_MAX_STATES,
  type ButtonPlacementActivationCycle,
  type ButtonStateDocument,
  type ButtonSurfaceKind
} from "../types.js";
import { cloneButtonDocument } from "./buttonDefaults.js";
import { validateButtonStateDocument } from "./buttonStateValidation.js";

export const BUTTON_PLACEMENT_FILE_FORMAT_V1 = "flowcell-button-placement/v1" as const;
export const BUTTON_PLACEMENT_FILE_FORMAT_V2 = "flowcell-button-placement/v2" as const;
export const BUTTON_PLACEMENT_FILE_FORMAT = BUTTON_PLACEMENT_FILE_FORMAT_V2;
export const BUTTON_PLACEMENT_FILE_EXTENSION = ".flowcell-button-placement.json" as const;

const BUTTON_SURFACE_KINDS = new Set<ButtonSurfaceKind>([
  "main",
  "panel",
  "regular-popout",
  "tool-set-popout",
  "fan"
]);
const BUTTON_CYCLE_ADVANCE_TRIGGERS = new Set(["press", "hover", "release"]);
const BUTTON_SKIN_VISUAL_STATES = new Set([
  "base",
  "hover",
  "play",
  "pressed",
  "held",
  "release",
  "disabled",
  "error"
]);

export interface ButtonPlacementFileSize {
  width: number;
  height: number;
}

export interface ButtonPlacementFileSurface {
  id: string;
  name: string;
  kind: ButtonSurfaceKind;
  width: number;
  height: number;
  uniformButtonSize: ButtonPlacementFileSize | null;
}

export interface ButtonPlacementFileEntryV1 {
  id: string;
  buttonId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface ButtonPlacementFileEntry extends ButtonPlacementFileEntryV1 {
  activationCycle: ButtonPlacementActivationCycle | null;
  highlightOnHover: boolean;
}

interface ButtonPlacementFileBase {
  savedAt: string;
  programName: string;
  panelName: string;
  surface: ButtonPlacementFileSurface;
}

export interface ButtonPlacementFileV1 extends ButtonPlacementFileBase {
  format: typeof BUTTON_PLACEMENT_FILE_FORMAT_V1;
  placements: ButtonPlacementFileEntryV1[];
}

export interface ButtonPlacementFileV2 extends ButtonPlacementFileBase {
  format: typeof BUTTON_PLACEMENT_FILE_FORMAT_V2;
  placements: ButtonPlacementFileEntry[];
}

export type ButtonPlacementFile = ButtonPlacementFileV1 | ButtonPlacementFileV2;

export interface ButtonPlacementFileBuildContext {
  programName: string;
  panelName: string;
  savedAt?: string;
}

export interface ButtonPlacementFileValidationResult {
  valid: boolean;
  issues: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  issues: string[],
  optionalKeys: readonly string[] = []
): void {
  const expected = new Set([...keys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) issues.push(`${path}.${key}: Unknown field.`);
  }
  for (const key of keys) {
    if (!(key in value)) issues.push(`${path}.${key}: Missing field.`);
  }
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isUtcIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validatePlacementActivationCycle(
  value: unknown,
  path: string,
  issues: string[]
): void {
  if (value === null) return;
  if (!isObject(value)) {
    issues.push(`${path}: Expected null or an activation-cycle object.`);
    return;
  }
  hasExactKeys(value, ["states"], path, issues);
  if (!Array.isArray(value.states)) {
    issues.push(`${path}.states: Expected an ordered state array.`);
    return;
  }
  if (value.states.length < 2) {
    issues.push(`${path}.states: Expected at least two states.`);
  }
  if (value.states.length > BUTTON_PLACEMENT_CYCLE_MAX_STATES) {
    issues.push(
      `${path}.states: Expected no more than ${BUTTON_PLACEMENT_CYCLE_MAX_STATES} states.`
    );
  }

  const stateIds = new Set<string>();
  value.states.forEach((state, index) => {
    const statePath = `${path}.states.${index}`;
    if (!isObject(state)) {
      issues.push(`${statePath}: Expected an activation-cycle state object.`);
      return;
    }
    hasExactKeys(
      state,
      ["id", "label", "advanceTrigger", "visualState"],
      statePath,
      issues,
      ["resultMatches"]
    );
    if (!nonemptyString(state.id)) {
      issues.push(`${statePath}.id: Expected a stable nonempty state ID.`);
    } else if (stateIds.has(state.id)) {
      issues.push(`${statePath}.id: Duplicate activation-cycle state ID '${state.id}'.`);
    } else {
      stateIds.add(state.id);
    }
    if (typeof state.label !== "string") {
      issues.push(`${statePath}.label: Expected a string label.`);
    }
    if (
      typeof state.advanceTrigger !== "string" ||
      !BUTTON_CYCLE_ADVANCE_TRIGGERS.has(state.advanceTrigger)
    ) {
      issues.push(`${statePath}.advanceTrigger: Expected press, hover, or release.`);
    }
    if (
      typeof state.visualState !== "string" ||
      !BUTTON_SKIN_VISUAL_STATES.has(state.visualState)
    ) {
      issues.push(`${statePath}.visualState: Unsupported Button skin visual state.`);
    }
    if (state.resultMatches !== undefined) {
      if (!Array.isArray(state.resultMatches)) {
        issues.push(`${statePath}.resultMatches: Expected an array of JSON objects.`);
      } else {
        state.resultMatches.forEach((match, matchIndex) => {
          if (!isObject(match)) {
            issues.push(`${statePath}.resultMatches.${matchIndex}: Expected a JSON object.`);
          }
        });
      }
    }
  });
}

export function validateButtonPlacementFile(value: unknown): ButtonPlacementFileValidationResult {
  const issues: string[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: ["placement: Button placement file must be an object."] };
  }

  hasExactKeys(
    value,
    ["format", "savedAt", "programName", "panelName", "surface", "placements"],
    "placement",
    issues
  );
  const isV1 = value.format === BUTTON_PLACEMENT_FILE_FORMAT_V1;
  const isV2 = value.format === BUTTON_PLACEMENT_FILE_FORMAT_V2;
  if (!isV1 && !isV2) {
    issues.push(
      `placement.format: Expected '${BUTTON_PLACEMENT_FILE_FORMAT_V1}' or '${BUTTON_PLACEMENT_FILE_FORMAT_V2}'.`
    );
  }
  if (!isUtcIsoTimestamp(value.savedAt)) {
    issues.push("placement.savedAt: Expected a UTC ISO timestamp.");
  }
  if (!nonemptyString(value.programName)) {
    issues.push("placement.programName: Expected a nonempty program name.");
  }
  if (!nonemptyString(value.panelName)) {
    issues.push("placement.panelName: Expected a nonempty panel name.");
  }

  let surfaceWidth: number | null = null;
  let surfaceHeight: number | null = null;
  let uniformButtonSize: ButtonPlacementFileSize | null = null;
  if (!isObject(value.surface)) {
    issues.push("placement.surface: Expected a surface object.");
  } else {
    hasExactKeys(
      value.surface,
      ["id", "name", "kind", "width", "height", "uniformButtonSize"],
      "placement.surface",
      issues
    );
    if (!nonemptyString(value.surface.id)) {
      issues.push("placement.surface.id: Expected a nonempty surface ID.");
    }
    if (!nonemptyString(value.surface.name)) {
      issues.push("placement.surface.name: Expected a nonempty surface name.");
    }
    if (
      typeof value.surface.kind !== "string" ||
      !BUTTON_SURFACE_KINDS.has(value.surface.kind as ButtonSurfaceKind)
    ) {
      issues.push("placement.surface.kind: Unsupported Button surface kind.");
    }
    if (!isFiniteNumber(value.surface.width) || value.surface.width <= 0) {
      issues.push("placement.surface.width: Expected a positive finite width.");
    } else {
      surfaceWidth = value.surface.width;
    }
    if (!isFiniteNumber(value.surface.height) || value.surface.height <= 0) {
      issues.push("placement.surface.height: Expected a positive finite height.");
    } else {
      surfaceHeight = value.surface.height;
    }
    if (value.surface.uniformButtonSize !== null) {
      if (!isObject(value.surface.uniformButtonSize)) {
        issues.push("placement.surface.uniformButtonSize: Expected null or a size object.");
      } else {
        hasExactKeys(
          value.surface.uniformButtonSize,
          ["width", "height"],
          "placement.surface.uniformButtonSize",
          issues
        );
        const width = value.surface.uniformButtonSize.width;
        const height = value.surface.uniformButtonSize.height;
        if (!isFiniteNumber(width) || width <= 0) {
          issues.push("placement.surface.uniformButtonSize.width: Expected a positive finite width.");
        }
        if (!isFiniteNumber(height) || height <= 0) {
          issues.push("placement.surface.uniformButtonSize.height: Expected a positive finite height.");
        }
        if (isFiniteNumber(width) && width > 0 && isFiniteNumber(height) && height > 0) {
          uniformButtonSize = { width, height };
          if (surfaceWidth !== null && width > surfaceWidth) {
            issues.push("placement.surface.uniformButtonSize.width: Uniform width exceeds the surface.");
          }
          if (surfaceHeight !== null && height > surfaceHeight) {
            issues.push("placement.surface.uniformButtonSize.height: Uniform height exceeds the surface.");
          }
        }
      }
    }
  }

  if (!Array.isArray(value.placements)) {
    issues.push("placement.placements: Expected an ordered placement array.");
  } else {
    const seenPlacementIds = new Set<string>();
    value.placements.forEach((entry, index) => {
      const path = `placement.placements.${index}`;
      if (!isObject(entry)) {
        issues.push(`${path}: Expected a placement object.`);
        return;
      }
      hasExactKeys(
        entry,
        isV1
          ? ["id", "buttonId", "x", "y", "width", "height", "zIndex"]
          : ["id", "buttonId", "x", "y", "width", "height", "zIndex", "activationCycle", "highlightOnHover"],
        path,
        issues
      );
      if (!nonemptyString(entry.id)) {
        issues.push(`${path}.id: Expected a nonempty placement ID.`);
      } else if (seenPlacementIds.has(entry.id)) {
        issues.push(`${path}.id: Duplicate placement ID '${entry.id}'.`);
      } else {
        seenPlacementIds.add(entry.id);
      }
      if (!nonemptyString(entry.buttonId)) {
        issues.push(`${path}.buttonId: Expected a nonempty Button ID.`);
      }
      if (!isFiniteNumber(entry.x) || entry.x < 0) {
        issues.push(`${path}.x: Expected a nonnegative finite coordinate.`);
      }
      if (!isFiniteNumber(entry.y) || entry.y < 0) {
        issues.push(`${path}.y: Expected a nonnegative finite coordinate.`);
      }
      if (!isFiniteNumber(entry.width) || entry.width <= 0) {
        issues.push(`${path}.width: Expected a positive finite width.`);
      }
      if (!isFiniteNumber(entry.height) || entry.height <= 0) {
        issues.push(`${path}.height: Expected a positive finite height.`);
      }
      if (!Number.isSafeInteger(entry.zIndex) || entry.zIndex !== index) {
        issues.push(`${path}.zIndex: Expected the ordered index ${index}.`);
      }
      if (!isV1) {
        validatePlacementActivationCycle(entry.activationCycle, `${path}.activationCycle`, issues);
        if (typeof entry.highlightOnHover !== "boolean") {
          issues.push(`${path}.highlightOnHover: Expected a boolean.`);
        }
      }
      if (
        surfaceWidth !== null &&
        isFiniteNumber(entry.x) &&
        isFiniteNumber(entry.width) &&
        entry.x + entry.width > surfaceWidth
      ) {
        issues.push(`${path}: Placement exceeds the surface width.`);
      }
      if (
        surfaceHeight !== null &&
        isFiniteNumber(entry.y) &&
        isFiniteNumber(entry.height) &&
        entry.y + entry.height > surfaceHeight
      ) {
        issues.push(`${path}: Placement exceeds the surface height.`);
      }
      if (
        uniformButtonSize &&
        isFiniteNumber(entry.width) &&
        isFiniteNumber(entry.height) &&
        (
          Math.abs(entry.width - uniformButtonSize.width) > 0.05 ||
          Math.abs(entry.height - uniformButtonSize.height) > 0.05
        )
      ) {
        issues.push(`${path}: Placement does not match the uniform Button size.`);
      }
    });
  }

  return { valid: issues.length === 0, issues };
}

export function buildButtonPlacementFile(
  document: ButtonStateDocument,
  surfaceId: string,
  context: ButtonPlacementFileBuildContext
): ButtonPlacementFileV2 {
  const surface = document.surfaces[surfaceId];
  if (!surface) throw new Error(`Button surface '${surfaceId}' does not exist.`);

  const seenPlacementIds = new Set<string>();
  const placements = surface.placementIds.map((placementId, index): ButtonPlacementFileEntry => {
    if (seenPlacementIds.has(placementId)) {
      throw new Error(`Button surface '${surfaceId}' repeats placement '${placementId}'.`);
    }
    seenPlacementIds.add(placementId);
    const placement = document.placements[placementId];
    if (!placement) {
      throw new Error(`Button surface '${surfaceId}' references missing placement '${placementId}'.`);
    }
    if (placement.surfaceId !== surfaceId) {
      throw new Error(`Button placement '${placementId}' belongs to a different surface.`);
    }
    if (!document.buttons[placement.buttonId]) {
      throw new Error(`Button placement '${placementId}' references missing Button '${placement.buttonId}'.`);
    }
    return {
      id: placement.id,
      buttonId: placement.buttonId,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      zIndex: index,
      activationCycle: placement.activationCycle
        ? structuredClone(placement.activationCycle)
        : null,
      highlightOnHover: placement.highlightOnHover
    };
  });

  const file: ButtonPlacementFileV2 = {
    format: BUTTON_PLACEMENT_FILE_FORMAT,
    savedAt: context.savedAt ?? new Date().toISOString(),
    programName: context.programName.trim(),
    panelName: context.panelName.trim(),
    surface: {
      id: surface.id,
      name: surface.name,
      kind: surface.kind,
      width: surface.width,
      height: surface.height,
      uniformButtonSize: surface.uniformButtonSize
        ? {
            width: surface.uniformButtonSize.width,
            height: surface.uniformButtonSize.height
          }
        : null
    },
    placements
  };
  const validation = validateButtonPlacementFile(file);
  if (!validation.valid) throw new Error(validation.issues.join("\n"));
  return file;
}

export function applyButtonPlacementFile(
  document: ButtonStateDocument,
  selectedSurfaceId: string,
  value: unknown
): ButtonStateDocument {
  const validation = validateButtonPlacementFile(value);
  if (!validation.valid) throw new Error(validation.issues.join("\n"));
  const file = value as ButtonPlacementFile;
  const selectedSurface = document.surfaces[selectedSurfaceId];
  if (!selectedSurface) {
    throw new Error("Select an existing Button surface before loading a placement.");
  }
  if (file.surface.id !== selectedSurfaceId) {
    throw new Error(
      `This placement file belongs to '${file.surface.name}' (${file.surface.id}), ` +
      `not the selected surface '${selectedSurface.name}' (${selectedSurface.id}).`
    );
  }
  if (file.surface.kind !== selectedSurface.kind) {
    throw new Error(
      `This placement file targets a '${file.surface.kind}' surface, ` +
      `but the selected surface is '${selectedSurface.kind}'.`
    );
  }

  const savedPlacementIds = file.placements.map((placement) => placement.id);
  const savedPlacementIdSet = new Set(savedPlacementIds);
  const selectedPlacementIdSet = new Set(selectedSurface.placementIds);
  const missingPlacementIds = savedPlacementIds.filter(
    (placementId) => !selectedPlacementIdSet.has(placementId)
  );
  const extraPlacementIds = selectedSurface.placementIds.filter(
    (placementId) => !savedPlacementIdSet.has(placementId)
  );
  if (missingPlacementIds.length > 0 || extraPlacementIds.length > 0) {
    const details = [
      missingPlacementIds.length > 0
        ? `missing ${missingPlacementIds.slice(0, 4).join(", ")}`
        : "",
      extraPlacementIds.length > 0
        ? `additional ${extraPlacementIds.slice(0, 4).join(", ")}`
        : ""
    ].filter(Boolean).join("; ");
    throw new Error(
      `The selected surface no longer has the same Button placements as this file (${details}).`
    );
  }

  for (const entry of file.placements) {
    const placement = document.placements[entry.id];
    if (!placement || placement.surfaceId !== selectedSurfaceId) {
      throw new Error(
        `Button placement '${entry.id}' is missing from the selected surface.`
      );
    }
    if (placement.buttonId !== entry.buttonId) {
      throw new Error(
        `Button placement '${entry.id}' now points to a different Button.`
      );
    }
  }

  const next = cloneButtonDocument(document);
  const nextSurface = next.surfaces[selectedSurfaceId];
  nextSurface.width = file.surface.width;
  nextSurface.height = file.surface.height;
  nextSurface.uniformButtonSize = file.surface.uniformButtonSize
    ? { ...file.surface.uniformButtonSize }
    : null;
  nextSurface.placementIds = [...savedPlacementIds];

  for (const entry of file.placements) {
    const placement = next.placements[entry.id];
    placement.x = entry.x;
    placement.y = entry.y;
    placement.width = entry.width;
    placement.height = entry.height;
    placement.zIndex = entry.zIndex;
    if (file.surface.uniformButtonSize) {
      placement.matchHitboxToSkin = false;
      placement.allowLabelResize = false;
    }
    if (file.format === BUTTON_PLACEMENT_FILE_FORMAT_V2) {
      const v2Entry = entry as ButtonPlacementFileEntry;
      placement.highlightOnHover = v2Entry.highlightOnHover;
      placement.activationCycle = v2Entry.activationCycle
        ? structuredClone(v2Entry.activationCycle)
        : null;
    }
  }

  const documentValidation = validateButtonStateDocument(next);
  if (!documentValidation.valid) {
    throw new Error(
      documentValidation.issues
        .slice(0, 8)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n")
    );
  }
  return next;
}
