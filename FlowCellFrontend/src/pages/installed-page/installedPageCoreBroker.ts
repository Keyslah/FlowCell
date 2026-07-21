import { invoke } from "@tauri-apps/api/core";

import type { JsonValue } from "../../button/types";
import { mappedToolPackageFields } from "../../button/runtime/toolPackageMapping.js";
import { publishButtonCommit } from "../../button/state/ButtonDraftBus";
import {
  installButtonSource,
  loadButtonStateDocument,
  mergeLegacyInstallsIntoDocument,
  saveButtonStateDocument,
  uninstallButtonSource
} from "../../button/state/ButtonStateRepository";
import { createStableButtonId } from "../../button/state/buttonDefaults";
import { showOpenFileDialog, showOpenFolderDialog, showSaveFileDialog } from "../../lib/tauri";

export interface InstalledPageCoreActionPlan {
  kind: "core-action";
  capability: string;
  options: Record<string, JsonValue>;
  payload: JsonValue;
}

export interface InstalledPageCoreIdentity {
  ownerButtonId: string;
  programName: string;
  panelName: string;
  fileName: string;
  pageId: string;
}

interface LoadedToolFields {
  format: string;
  values: Record<string, JsonValue>;
}

interface LoadedToolPackage extends LoadedToolFields {
  name: string;
  manifestPath: string;
  assets: Record<string, string>;
}

interface ToolPackageEntry {
  name: string;
  manifestPath: string;
}

interface AuthorizedGeneratedStage {
  manifestPath: string;
  stageRoot: string;
}

const activeToolPackagePaths = new Map<string, string>();

function objectValue(value: unknown, label: string): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, JsonValue>;
}

function stringValue(
  object: Readonly<Record<string, JsonValue>>,
  key: string,
  fallback = ""
): string {
  const value = object[key];
  return typeof value === "string" ? value.trim() : fallback;
}

function numberValue(
  object: Readonly<Record<string, JsonValue>>,
  key: string,
  fallback = 0
): number {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(
  object: Readonly<Record<string, JsonValue>>,
  key: string
): string[] {
  const value = object[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function stringMap(
  object: Readonly<Record<string, JsonValue>>,
  key: string
): Record<string, string> {
  const value = object[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] =>
        typeof entry[1] === "string" && Boolean(entry[0].trim()) && Boolean(entry[1].trim())
      )
  );
}

function fileStem(path: string): string {
  const name = path.split(/[\\/]/).pop()?.trim() ?? "";
  return name.replace(/\.[^.]+$/, "").trim() || "Tool Fields";
}

function sourceCapabilityIdentity(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>
) {
  const capability = stringValue(options, "capability");
  if (!capability) {
    throw new Error("The installed page action is missing its source capability grant.");
  }
  return {
    programName: identity.programName,
    panelName: identity.panelName,
    fileName: identity.fileName,
    capability
  };
}

function toolPackageIdentity(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>
) {
  const storageFolder = stringValue(options, "storageFolder");
  const formatId = stringValue(options, "formatId");
  if (!storageFolder || !formatId) {
    throw new Error("The installed page tool-package action is missing its storage contract.");
  }
  return {
    ...sourceCapabilityIdentity(identity, options),
    storageFolder,
    formatId
  };
}

function packageKey(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>
): string {
  const contract = toolPackageIdentity(identity, options);
  return [identity.ownerButtonId, contract.formatId]
    .map((value) => value.toLocaleLowerCase("en"))
    .join("\u0000");
}

function legacyMapping(options: Readonly<Record<string, JsonValue>>) {
  return {
    legacyFormats: stringArray(options, "legacyFormats"),
    fieldMap: stringMap(options, "legacyFieldMap"),
    assetMap: stringMap(options, "legacyAssetMap"),
    fieldTransforms: stringMap(options, "legacyFieldTransforms")
  };
}

async function loadPackageAtPath(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>,
  manifestPath: string
): Promise<Record<string, JsonValue>> {
  const legacy = legacyMapping(options);
  const loaded = await invoke<LoadedToolPackage>("load_tool_package", {
    ...toolPackageIdentity(identity, options),
    manifestPath,
    legacyFormats: legacy.legacyFormats,
    valueFields: stringArray(options, "valueFields"),
    assetFields: stringArray(options, "assetFields"),
    legacyValueKeys: Object.keys(legacy.fieldMap),
    legacyAssetKeys: Object.keys(legacy.assetMap)
  });
  activeToolPackagePaths.set(packageKey(identity, options), loaded.manifestPath);
  return {
    selected: true,
    fieldPatch: mappedToolPackageFields(loaded, legacy),
    packagePath: loaded.manifestPath,
    packageName: loaded.name,
    message: `Loaded ${loaded.name}.`
  };
}

async function runFileSelect(options: Readonly<Record<string, JsonValue>>) {
  const paths = await showOpenFileDialog({
    title: stringValue(options, "dialogTitle", "Choose a file"),
    filter: stringValue(options, "filter", "All Files (*.*)|*.*"),
    multiselect: false
  });
  const path = paths[0]?.trim() ?? "";
  return { selected: Boolean(path), path };
}

async function runFolderSelect(options: Readonly<Record<string, JsonValue>>) {
  const paths = await showOpenFolderDialog({
    title: stringValue(options, "dialogTitle", "Choose a folder"),
    multiselect: false
  });
  const path = paths[0]?.trim() ?? "";
  return { selected: Boolean(path), path };
}

async function runSamplePalette(
  options: Readonly<Record<string, JsonValue>>,
  payload: Readonly<Record<string, JsonValue>>
) {
  const imagePath = stringValue(payload, "imagePath");
  if (!imagePath) {
    return {
      selected: false,
      imagePath: "",
      paletteHexes: [],
      fieldPatch: {},
      message: "Choose an image first."
    };
  }
  const sampled = await invoke<Record<string, JsonValue>>("sample_image_palette", { imagePath });
  const fieldPatch: Record<string, JsonValue> = {};
  const imagePathField = stringValue(options, "imagePathField");
  if (imagePathField) fieldPatch[imagePathField] = imagePath;
  for (const fieldId of stringArray(options, "copyPathTo")) fieldPatch[fieldId] = imagePath;
  for (const [fieldId, sampleKey] of Object.entries(stringMap(options, "fieldMap"))) {
    if (sampleKey in sampled) fieldPatch[fieldId] = sampled[sampleKey];
  }
  const paletteHexes = Array.isArray(sampled.paletteHexes)
    ? sampled.paletteHexes.filter((value): value is string => typeof value === "string")
    : [];
  return {
    selected: true,
    imagePath,
    paletteHexes,
    fieldPatch,
    message: "Sampled image palette."
  };
}

async function runSaveFields(
  options: Readonly<Record<string, JsonValue>>,
  payload: Readonly<Record<string, JsonValue>>
) {
  const formatId = stringValue(options, "formatId");
  if (!formatId) throw new Error("The installed page field action is missing formatId.");
  const values = objectValue(payload.values, "Tool-field values");
  const sourceName = stringValue(values, stringValue(options, "sourceNameField"));
  const suggestedName = `${sourceName ? fileStem(sourceName) : stringValue(options, "defaultName", "Tool Fields")}${stringValue(options, "nameSuffix")}`;
  const path = await showSaveFileDialog({
    title: stringValue(options, "dialogTitle", "Save Tool Fields"),
    filter: "JSON Files (*.json)|*.json|All Files (*.*)|*.*",
    defaultFileName: `${suggestedName}.json`
  });
  if (!path) return { saved: false, savedPath: "", message: "Save cancelled." };
  const savedPath = await invoke<string>("save_tool_field_file", {
    formatId,
    path,
    valueFields: stringArray(options, "valueFields"),
    values
  });
  return { saved: true, savedPath, message: "Saved tool fields." };
}

async function runLoadFields(options: Readonly<Record<string, JsonValue>>) {
  const formatId = stringValue(options, "formatId");
  if (!formatId) throw new Error("The installed page field action is missing formatId.");
  const paths = await showOpenFileDialog({
    title: stringValue(options, "dialogTitle", "Load Tool Fields"),
    filter: "JSON Files (*.json)|*.json|All Files (*.*)|*.*",
    multiselect: false
  });
  const sourcePath = paths[0]?.trim() ?? "";
  if (!sourcePath) {
    return { selected: false, fieldPatch: {}, sourcePath: "", message: "Load cancelled." };
  }
  const legacy = legacyMapping(options);
  const loaded = await invoke<LoadedToolFields>("load_tool_field_file", {
    formatId,
    path: sourcePath,
    legacyFormats: legacy.legacyFormats,
    valueFields: stringArray(options, "valueFields"),
    legacyValueKeys: Object.keys(legacy.fieldMap)
  });
  return {
    selected: true,
    fieldPatch: mappedToolPackageFields({ ...loaded, assets: {} }, legacy),
    sourcePath,
    message: "Loaded tool fields."
  };
}

async function runSavePackage(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>,
  payload: Readonly<Record<string, JsonValue>>
) {
  const values = objectValue(payload.values, "Tool-package values");
  const contract = toolPackageIdentity(identity, options);
  const root = await invoke<string>("resolve_tool_package_root", contract);
  const sourceName = stringValue(values, stringValue(options, "sourceNameField"));
  const suggestedName = fileStem(sourceName || stringValue(options, "defaultName", "Tool Package"));
  const suffix = stringValue(options, "manifestSuffix", ".flowcell-tool-package.json");
  const selectedPath = await showSaveFileDialog({
    title: stringValue(options, "dialogTitle", "Save Tool Package"),
    filter: "Tool Package (*.json)|*.json|All Files (*.*)|*.*",
    defaultFileName: `${suggestedName}${suffix}`,
    initialDirectory: root
  });
  if (!selectedPath) {
    return {
      saved: false,
      savedPath: "",
      packagePath: "",
      packageName: "",
      message: "Save cancelled."
    };
  }
  const savedPath = await invoke<string>("save_tool_package", {
    ...contract,
    manifestPath: selectedPath,
    manifestSuffix: suffix,
    valueFields: stringArray(options, "valueFields"),
    assetFields: stringArray(options, "assetFields"),
    values
  });
  activeToolPackagePaths.set(packageKey(identity, options), savedPath);
  return {
    saved: true,
    savedPath,
    packagePath: savedPath,
    packageName: suggestedName,
    message: `Saved ${suggestedName}.`
  };
}

async function runOpenPackage(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>
) {
  const root = await invoke<string>("resolve_tool_package_root", toolPackageIdentity(identity, options));
  const suffix = stringValue(options, "manifestSuffix", ".flowcell-tool-package.json");
  const paths = await showOpenFileDialog({
    title: stringValue(options, "dialogTitle", "Open Tool Package"),
    filter: `Tool Package (*${suffix})|*${suffix}|JSON Files (*.json)|*.json|All Files (*.*)|*.*`,
    initialDirectory: root,
    multiselect: false
  });
  const selectedPath = paths[0]?.trim() ?? "";
  return selectedPath
    ? loadPackageAtPath(identity, options, selectedPath)
    : { selected: false, fieldPatch: {}, packagePath: "", packageName: "", message: "Open cancelled." };
}

async function runCyclePackage(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>,
  payload: Readonly<Record<string, JsonValue>>
) {
  const entries = await invoke<ToolPackageEntry[]>("list_tool_packages", {
    ...toolPackageIdentity(identity, options),
    manifestSuffix: stringValue(options, "manifestSuffix", ".flowcell-tool-package.json")
  });
  if (entries.length === 0) throw new Error("No saved tool packages were found.");
  const direction = numberValue(options, "direction", 1) < 0 ? -1 : 1;
  const activePath = stringValue(payload, "activePackagePath") ||
    activeToolPackagePaths.get(packageKey(identity, options)) ||
    "";
  const activeIndex = entries.findIndex((entry) => entry.manifestPath === activePath);
  const startIndex = activeIndex >= 0 ? activeIndex : direction > 0 ? -1 : 0;
  const nextIndex = (startIndex + direction + entries.length) % entries.length;
  return loadPackageAtPath(identity, options, entries[nextIndex].manifestPath);
}

function isButtonRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Button state changed before Save.");
}

async function runInstallGeneratedButton(
  identity: InstalledPageCoreIdentity,
  actionId: string,
  options: Readonly<Record<string, JsonValue>>,
  payload: Readonly<Record<string, JsonValue>>
) {
  const programName = stringValue(options, "programName");
  const importKind = stringValue(options, "importKind");
  const panelName = stringValue(payload, "panelName");
  const stageToken = stringValue(payload, "stageToken");
  const stagedSourcePath = stringValue(payload, "stagedSourcePath");
  if (!programName || programName.toLocaleLowerCase("en") !== identity.programName.toLocaleLowerCase("en")) {
    throw new Error("Generated Button program must match the installed page owner program.");
  }
  if (importKind !== "script") {
    throw new Error("Generated page Buttons must use the ordinary script source lifecycle.");
  }
  if (!panelName || !stageToken || !stagedSourcePath) {
    throw new Error(
      "Generated Button installation requires a destination panel, stage token, and staged manifest."
    );
  }
  const authorizedStage = await invoke<AuthorizedGeneratedStage>(
    "authorize_installed_page_generated_stage",
    {
      ...identity,
      actionId,
      stageToken,
      stagedSourcePath
    }
  );
  if (!authorizedStage.manifestPath || !authorizedStage.stageRoot) {
    throw new Error("Generated Button stage authorization returned an incomplete result.");
  }
  const ownerButtonId = createStableButtonId("button-generated");
  let installed: Awaited<ReturnType<typeof installButtonSource>> | null = null;
  let committed = false;
  try {
    installed = await installButtonSource({
      ownerButtonId,
      programName,
      panelName,
      sourcePath: authorizedStage.manifestPath,
      importKind: "script"
    });
    if (!installed.executionTarget || installed.children.length > 0) {
      throw new Error("Generated source did not install as one ordinary single-script Button.");
    }
    let current = await loadButtonStateDocument();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = mergeLegacyInstallsIntoDocument(current, [installed]);
      try {
        const saved = await saveButtonStateDocument(next, current.revision);
        committed = true;
        await publishButtonCommit(saved).catch((error) => {
          console.error("Generated Button committed but its cross-window event failed.", error);
        });
        return {
          installed: true,
          ownerButtonId: installed.ownerButtonId,
          programName: installed.sourceIdentity.displayProgramName,
          panelName: installed.sourceIdentity.displayPanelName
        };
      } catch (error) {
        if (attempt === 2 || !isButtonRevisionConflict(error)) throw error;
        current = await loadButtonStateDocument();
      }
    }
    throw new Error("Generated Button canonical state could not be committed.");
  } catch (error) {
    if (installed && !committed) {
      await uninstallButtonSource({
        ownerButtonId: installed.ownerButtonId,
        sourceIdentity: installed.sourceIdentity
      }).catch((cleanupError) => {
        console.error("Generated Button rollback could not uninstall its staged owner.", cleanupError);
      });
    }
    throw error;
  } finally {
    await invoke("discard_installed_page_generated_stage", {
      ...identity,
      actionId,
      stageToken,
      stagedSourcePath: authorizedStage.manifestPath
    }).catch((cleanupError) => {
      console.error("Generated Button staging cleanup failed.", cleanupError);
    });
  }
}

export function isInstalledPageCoreActionPlan(value: unknown): value is InstalledPageCoreActionPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.kind === "core-action" &&
    typeof record.capability === "string" &&
    Boolean(record.options) &&
    typeof record.options === "object" &&
    !Array.isArray(record.options);
}

export async function runInstalledPageCoreAction(
  identity: InstalledPageCoreIdentity,
  actionId: string,
  plan: InstalledPageCoreActionPlan
): Promise<JsonValue> {
  const options = objectValue(plan.options, "Installed page Core action options");
  const payload = objectValue(plan.payload, "Installed page Core action payload");
  switch (plan.capability) {
    case "file.select": return runFileSelect(options);
    case "folder.select": return runFolderSelect(options);
    case "image.sample-palette": return runSamplePalette(options, payload);
    case "tool-fields.save": return runSaveFields(options, payload);
    case "tool-fields.load": return runLoadFields(options);
    case "tool-package.save": return runSavePackage(identity, options, payload);
    case "tool-package.open": return runOpenPackage(identity, options);
    case "tool-package.cycle": return runCyclePackage(identity, options, payload);
    case "button.install-generated":
      return runInstallGeneratedButton(identity, actionId, options, payload);
    default:
      throw new Error(`Installed page Core capability '${plan.capability}' is unavailable.`);
  }
}
