import { invoke } from "@tauri-apps/api/core";

import {
  showOpenFileDialog,
  showSaveFileDialog
} from "../../lib/tauri";
import { openToolPageWindow } from "../../lib/coreWindows";
import type { CoreActionExecutionTarget, JsonValue } from "../types";
import type { ButtonCoreActionContext } from "./ButtonRuntimeAdapter";
import { registerButtonCoreAction } from "./ButtonRuntimeAdapter";
import { mappedToolPackageFields } from "./toolPackageMapping.js";

type CoreActionHandler = (
  target: CoreActionExecutionTarget,
  context: ButtonCoreActionContext
) => Promise<unknown>;

function fieldString(
  fieldValues: Readonly<Record<string, JsonValue>>,
  fieldId: string
): string {
  const value = fieldValues[fieldId];
  return typeof value === "string" ? value.trim() : "";
}

function fileStem(path: string): string {
  const name = path.split(/[\\/]/).pop()?.trim() ?? "";
  return name.replace(/\.[^.]+$/, "").trim() || "Tool Fields";
}

function payloadString(payload: Readonly<Record<string, JsonValue>> | undefined, key: string): string {
  const value = payload?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function payloadStringArray(
  payload: Readonly<Record<string, JsonValue>> | undefined,
  key: string
): string[] {
  const value = payload?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function payloadStringMap(
  payload: Readonly<Record<string, JsonValue>> | undefined,
  key: string
): Record<string, string> {
  const value = payload?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim()))
  );
}

function payloadNumber(
  payload: Readonly<Record<string, JsonValue>> | undefined,
  key: string,
  fallback = 0
): number {
  const value = payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

interface ToolPackageLoadResult {
  format: string;
  name: string;
  manifestPath: string;
  values: Record<string, JsonValue>;
  assets: Record<string, string>;
}

interface ToolFieldLoadResult {
  format: string;
  values: Record<string, JsonValue>;
}

interface ToolPackageEntry {
  name: string;
  manifestPath: string;
}

const activeToolPackagePaths = new Map<string, string>();

function sourceCapabilityIdentity(target: CoreActionExecutionTarget) {
  const identity = {
    programName: payloadString(target.payload, "programName"),
    panelName: payloadString(target.payload, "panelName"),
    fileName: payloadString(target.payload, "fileName"),
    capability: payloadString(target.payload, "capability")
  };
  if (Object.values(identity).some((value) => !value)) {
    throw new Error("The installed core action is missing its source capability identity.");
  }
  return identity;
}

function toolPackageIdentity(target: CoreActionExecutionTarget) {
  const identity = {
    ...sourceCapabilityIdentity(target),
    storageFolder: payloadString(target.payload, "storageFolder"),
    formatId: payloadString(target.payload, "formatId")
  };
  if (Object.values(identity).some((value) => !value)) {
    throw new Error("The installed tool package action is missing its source identity or package contract.");
  }
  return identity;
}

function toolPackageKey(target: CoreActionExecutionTarget): string {
  const identity = toolPackageIdentity(target);
  return [identity.programName, identity.panelName, identity.fileName, identity.formatId]
    .map((value) => value.toLocaleLowerCase())
    .join("\u0000");
}

async function resolveToolPackageRoot(target: CoreActionExecutionTarget): Promise<string> {
  return invoke<string>("resolve_tool_package_root", toolPackageIdentity(target));
}

function mappedLoadedPackageFields(
  target: CoreActionExecutionTarget,
  loaded: ToolPackageLoadResult
): Record<string, JsonValue> {
  return mappedToolPackageFields(loaded, {
    legacyFormats: payloadStringArray(target.payload, "legacyFormats"),
    fieldMap: payloadStringMap(target.payload, "legacyFieldMap"),
    assetMap: payloadStringMap(target.payload, "legacyAssetMap"),
    fieldTransforms: payloadStringMap(target.payload, "legacyFieldTransforms")
  });
}

async function loadToolPackageAtPath(
  target: CoreActionExecutionTarget,
  manifestPath: string
): Promise<{ fieldPatch: Record<string, JsonValue>; packagePath: string; packageName: string }> {
  const legacyFieldMap = payloadStringMap(target.payload, "legacyFieldMap");
  const legacyAssetMap = payloadStringMap(target.payload, "legacyAssetMap");
  const loaded = await invoke<ToolPackageLoadResult>("load_tool_package", {
    ...toolPackageIdentity(target),
    manifestPath,
    legacyFormats: payloadStringArray(target.payload, "legacyFormats"),
    valueFields: payloadStringArray(target.payload, "valueFields"),
    assetFields: payloadStringArray(target.payload, "assetFields"),
    legacyValueKeys: Object.keys(legacyFieldMap),
    legacyAssetKeys: Object.keys(legacyAssetMap)
  });
  activeToolPackagePaths.set(toolPackageKey(target), loaded.manifestPath);
  return {
    fieldPatch: mappedLoadedPackageFields(target, loaded),
    packagePath: loaded.manifestPath,
    packageName: loaded.name
  };
}

const openToolPage: CoreActionHandler = async (target) => {
  const contributionId = payloadString(target.payload, "contributionId");
  const renderer = payloadString(target.payload, "renderer");
  const capability = payloadString(target.payload, "capability");
  const programName = payloadString(target.payload, "programName");
  const panelName = payloadString(target.payload, "panelName");
  const fileName = payloadString(target.payload, "fileName");
  const ownerButtonId = payloadString(target.payload, "ownerButtonId");
  const title = payloadString(target.payload, "title");
  if (
    !contributionId || renderer !== "tree-inspector" || !capability ||
    !programName || !panelName || !fileName || !title
  ) {
    throw new Error("The installed tool-page contribution is incomplete or unsupported.");
  }
  await openToolPageWindow({
    contributionId,
    renderer,
    capability,
    programName,
    panelName,
    fileName,
    ownerButtonId: ownerButtonId || undefined,
    title,
    resourceLabel: payloadString(target.payload, "resourceLabel") || undefined,
    emptyMessage: payloadString(target.payload, "emptyMessage") || undefined,
    refreshEvent: payloadString(target.payload, "refreshEvent") || undefined
  });
  return { opened: true };
};

const sampleImagePalette: CoreActionHandler = async (target, context) => {
  const pathField = payloadString(target.payload, "pathField");
  const imagePath = pathField ? fieldString(context.fieldValues, pathField) : "";
  if (!pathField || !imagePath) throw new Error("Choose an image first.");
  const sampled = await invoke<Record<string, JsonValue>>("sample_image_palette", { imagePath });
  const fieldPatch: Record<string, JsonValue> = { [pathField]: imagePath };
  for (const fieldId of payloadStringArray(target.payload, "copyPathTo")) {
    fieldPatch[fieldId] = imagePath;
  }
  for (const [fieldId, sampleKey] of Object.entries(payloadStringMap(target.payload, "fieldMap"))) {
    if (sampleKey in sampled) fieldPatch[fieldId] = sampled[sampleKey];
  }
  return { fieldPatch };
};

const saveToolFields: CoreActionHandler = async (target, context) => {
  const formatId = payloadString(target.payload, "formatId");
  if (!formatId) throw new Error("The tool page is missing its field-file format ID.");
  const sourceNameField = payloadString(target.payload, "sourceNameField");
  const defaultName = payloadString(target.payload, "defaultName") || "Tool Fields";
  const suffix = payloadString(target.payload, "nameSuffix");
  const sourceName = sourceNameField ? fieldString(context.fieldValues, sourceNameField) : "";
  const suggestedName = `${sourceName ? fileStem(sourceName) : defaultName}${suffix}`.trim();
  const selectedPath = await showSaveFileDialog({
    title: payloadString(target.payload, "dialogTitle") || "Save Tool Fields",
    filter: "JSON Files (*.json)|*.json|All Files (*.*)|*.*",
    defaultFileName: `${suggestedName}.json`
  });
  if (!selectedPath) return { cancelled: true };
  const savedPath = await invoke<string>("save_tool_field_file", {
    formatId,
    path: selectedPath,
    valueFields: payloadStringArray(target.payload, "valueFields"),
    values: context.fieldValues
  });
  return { savedPath };
};

const loadToolFields: CoreActionHandler = async (target) => {
  const formatId = payloadString(target.payload, "formatId");
  if (!formatId) throw new Error("The tool page is missing its field-file format ID.");
  const selectedPaths = await showOpenFileDialog({
    title: payloadString(target.payload, "dialogTitle") || "Load Tool Fields",
    filter: "JSON Files (*.json)|*.json|All Files (*.*)|*.*",
    multiselect: false
  });
  const selectedPath = selectedPaths[0]?.trim();
  if (!selectedPath) return { cancelled: true };
  const legacyFieldMap = payloadStringMap(target.payload, "legacyFieldMap");
  const loaded = await invoke<ToolFieldLoadResult>("load_tool_field_file", {
    formatId,
    path: selectedPath,
    legacyFormats: payloadStringArray(target.payload, "legacyFormats"),
    valueFields: payloadStringArray(target.payload, "valueFields"),
    legacyValueKeys: Object.keys(legacyFieldMap)
  });
  const fieldPatch = mappedToolPackageFields({ ...loaded, assets: {} }, {
    legacyFormats: payloadStringArray(target.payload, "legacyFormats"),
    fieldMap: legacyFieldMap,
    assetMap: {},
    fieldTransforms: payloadStringMap(target.payload, "legacyFieldTransforms")
  });
  return { fieldPatch };
};

const loadLegacyToolState: CoreActionHandler = async (target) => {
  const stateFileName = payloadString(target.payload, "stateFileName");
  const expectedFormat = payloadString(target.payload, "expectedFormat");
  if (!stateFileName || !expectedFormat) {
    throw new Error("The legacy tool-state action is missing its declared file or format.");
  }
  const legacyState = await invoke<JsonValue | null>("load_legacy_tool_state", {
    ...sourceCapabilityIdentity(target),
    stateFileName,
    expectedFormat
  });
  return { legacyState };
};

const saveToolPackage: CoreActionHandler = async (target, context) => {
  const identity = toolPackageIdentity(target);
  const manifestSuffix = payloadString(target.payload, "manifestSuffix") || ".flowcell-tool-package.json";
  const sourceNameField = payloadString(target.payload, "sourceNameField");
  const sourceName = sourceNameField ? fieldString(context.fieldValues, sourceNameField) : "";
  const suggestedName = fileStem(sourceName || payloadString(target.payload, "defaultName") || "Tool Package");
  const root = await resolveToolPackageRoot(target);
  const selectedPath = await showSaveFileDialog({
    title: payloadString(target.payload, "dialogTitle") || "Save Tool Package",
    filter: "Tool Package (*.json)|*.json|All Files (*.*)|*.*",
    defaultFileName: `${suggestedName}${manifestSuffix}`,
    initialDirectory: root
  });
  if (!selectedPath) return { cancelled: true };
  const savedPath = await invoke<string>("save_tool_package", {
    ...identity,
    manifestPath: selectedPath,
    manifestSuffix,
    valueFields: payloadStringArray(target.payload, "valueFields"),
    assetFields: payloadStringArray(target.payload, "assetFields"),
    values: context.fieldValues
  });
  activeToolPackagePaths.set(toolPackageKey(target), savedPath);
  return { savedPath, packagePath: savedPath };
};

const openToolPackage: CoreActionHandler = async (target) => {
  const root = await resolveToolPackageRoot(target);
  const manifestSuffix = payloadString(target.payload, "manifestSuffix") || ".flowcell-tool-package.json";
  const selectedPaths = await showOpenFileDialog({
    title: payloadString(target.payload, "dialogTitle") || "Open Tool Package",
    filter: `Tool Package (*${manifestSuffix})|*${manifestSuffix}|JSON Files (*.json)|*.json|All Files (*.*)|*.*`,
    initialDirectory: root,
    multiselect: false
  });
  const selectedPath = selectedPaths[0]?.trim();
  return selectedPath ? loadToolPackageAtPath(target, selectedPath) : { cancelled: true };
};

const cycleToolPackage: CoreActionHandler = async (target) => {
  const direction = payloadNumber(target.payload, "direction") < 0 ? -1 : 1;
  const entries = await invoke<ToolPackageEntry[]>("list_tool_packages", {
    ...toolPackageIdentity(target),
    manifestSuffix: payloadString(target.payload, "manifestSuffix") || ".flowcell-tool-package.json"
  });
  if (entries.length === 0) throw new Error("No saved tool packages were found.");
  const activePath = activeToolPackagePaths.get(toolPackageKey(target)) ?? "";
  const activeIndex = entries.findIndex((entry) => entry.manifestPath === activePath);
  const startIndex = activeIndex >= 0 ? activeIndex : direction > 0 ? -1 : 0;
  const nextIndex = (startIndex + direction + entries.length) % entries.length;
  return loadToolPackageAtPath(target, entries[nextIndex].manifestPath);
};

export function registerBuiltinButtonCoreActions(): () => void {
  const unregister = [
    registerButtonCoreAction("open-tool-page", openToolPage),
    registerButtonCoreAction("sample-image-palette", sampleImagePalette),
    registerButtonCoreAction("save-tool-fields", saveToolFields),
    registerButtonCoreAction("load-tool-fields", loadToolFields),
    registerButtonCoreAction("load-legacy-tool-state", loadLegacyToolState),
    registerButtonCoreAction("save-tool-package", saveToolPackage),
    registerButtonCoreAction("open-tool-package", openToolPackage),
    registerButtonCoreAction("cycle-tool-package", cycleToolPackage)
  ];
  return () => unregister.reverse().forEach((dispose) => dispose());
}
