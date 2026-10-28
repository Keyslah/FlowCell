import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION } from "../../lib/windowContext";
import type { JsonObject, JsonValue } from "../../button/types";
import { mappedToolPackageFields, type LoadedToolPackageFields } from "../../button/runtime/toolPackageMapping";
import type { ReadThemeResult } from "../../theme/themeFile";
import InstalledPageWindowPage, {
  type InstalledPageDescriptor,
  type InstalledPageThemeBridge
} from "../installed-page/InstalledPageWindowPage";

export interface CapturedThemeContribution {
  version: 1;
  sourceId: string;
  sourceVersion?: string;
  state: JsonObject;
  assetFields: string[];
}

export interface ThemeContributionController {
  sourceId: string;
  preservePoppedAppearance(): Promise<boolean>;
  setActiveTheme(theme: { name: string; path: string; buttonSettings?: JsonValue; buttonAppearance?: JsonValue }): Promise<void>;
  capture(): Promise<CapturedThemeContribution>;
  validate(state: JsonObject): Promise<void>;
  stage(state: JsonObject): Promise<void>;
  apply(state: JsonObject): Promise<void>;
  refresh(): Promise<void>;
  normalizeLegacy(value: unknown): JsonObject;
  loadLegacy(path: string, value: unknown): Promise<{
    state: JsonObject; buttonSettings?: JsonValue; buttonAppearance?: JsonValue;
  }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Legacy saves contribute only explicitly present fields. They never reset absent fields. */
export function normalizeLegacyContribution(value: unknown, fieldIds: readonly string[]): JsonObject {
  const root = record(value);
  if (!root) throw new Error("The legacy program theme must be a JSON object.");
  const values = record(root.values) ?? record(root.fieldPatch) ?? record(root.fields) ?? root;
  const fields: JsonObject = {};
  for (const id of fieldIds) if (Object.hasOwn(values, id)) fields[id] = structuredClone(values[id]) as JsonValue;
  if (Object.keys(fields).length === 0) throw new Error("This file contains no supported settings for the selected program.");
  return { fields, ...(record(root.tone) ? { tone: structuredClone(root.tone) as JsonObject } : {}) };
}

function declaredAssetPaths(state: JsonObject, fieldPaths: readonly string[]): string[] {
  return fieldPaths.flatMap((path) => {
    let value: unknown = state;
    for (const key of path.split(".")) value = record(value)?.[key];
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  });
}

/** Library inspection validates package requirements without staging, installation, or host actions. */
export async function reviewThemeContribution(
  controller: ThemeContributionController | null,
  loaded: ReadThemeResult
): Promise<string[]> {
  const contributions = Object.values(loaded.portable?.contributions ?? {});
  if (contributions.length === 0 && loaded.legacy == null) return [];
  if (!controller) return ["This theme requires the selected program's installed theme features. Install or update that program contribution before applying."];
  const issues: string[] = [];
  if (contributions.length > 1) issues.push("This theme declares more than 1 program feature contribution; the selected program supports 1.");
  try {
    const installed = await controller.capture();
    for (const contribution of contributions) {
      if (contribution.sourceId !== controller.sourceId) {
        issues.push(`Theme features require '${contribution.sourceId}'; the installed contribution is '${controller.sourceId}'.`);
        continue;
      }
      if (contribution.sourceVersion && contribution.sourceVersion !== installed.sourceVersion) {
        issues.push(`Theme features require version ${contribution.sourceVersion}; installed version is ${installed.sourceVersion ?? "unknown"}.`);
      }
      if (JSON.stringify([...contribution.assetFields].sort()) !== JSON.stringify([...installed.assetFields].sort())) {
        issues.push("The theme's asset declarations do not match the installed program contribution.");
      }
      try { await controller.validate(contribution.state); }
      catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
    }
    if (loaded.legacy != null) {
      const legacy = await controller.loadLegacy(loaded.path, loaded.legacy);
      await controller.validate(legacy.state);
      const paths = declaredAssetPaths(legacy.state, installed.assetFields);
      if (paths.length) await invoke("validate_flowcell_theme_assets", { paths });
    }
  } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  return [...new Set(issues)];
}

export default function ThemeContribution({ programName, active = true, onReady, onAvailable, onLibraryAction }: {
  programName: string;
  active?: boolean;
  onReady: (controller: ThemeContributionController | null) => void;
  onAvailable: (available: boolean) => void;
  onLibraryAction: (action: "save" | "open" | "previous" | "next") => void;
}) {
  const [descriptor, setDescriptor] = useState<InstalledPageDescriptor | null>(null);
  const [error, setError] = useState("");
  const callbacks = useRef({ onReady, onAvailable, onLibraryAction });
  callbacks.current = { onReady, onAvailable, onLibraryAction };
  useEffect(() => {
    let disposed = false;
    setDescriptor(null);
    setError("");
    callbacks.current.onReady(null);
    void invoke<InstalledPageDescriptor | null>("resolve_theme_contribution", { programName })
      .then((value) => {
        if (!disposed) {
          setDescriptor(value);
          callbacks.current.onAvailable(value !== null);
        }
      })
      .catch((reason) => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; callbacks.current.onReady(null); };
  }, [programName]);
  const context = useMemo(() => descriptor ? {
    kind: "installed-page" as const,
    schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
    ownerButtonId: descriptor.ownerButtonId,
    programName: descriptor.programName,
    panelName: descriptor.panelName,
    fileName: descriptor.fileName,
    pageId: descriptor.pageId,
    alwaysOnTop: false
  } : null, [descriptor]);
  const bridgeReady = (bridge: InstalledPageThemeBridge | null) => {
    if (!bridge || !descriptor?.themeContribution) { callbacks.current.onReady(null); return; }
    const declaration = descriptor.themeContribution;
    const sourceId = descriptor.sourceId || descriptor.pageId;
    callbacks.current.onReady({
      sourceId,
      preservePoppedAppearance: async () => (await bridge.request("policy") as { preservePoppedAppearance?: boolean })?.preservePoppedAppearance === true,
      setActiveTheme: async (theme) => { await bridge.request("set-active", theme); },
      capture: async () => ({
        version: 1, sourceId,
        ...(descriptor.sourceVersion ? { sourceVersion: descriptor.sourceVersion } : {}),
        state: await bridge.request("capture") as JsonObject,
        assetFields: declaration.assetFieldIds.map((id) => `fields.${id}`)
      }),
      validate: async (state) => { await bridge.request("validate", state); },
      stage: async (state) => { await bridge.request("stage", state); },
      apply: async (state) => { await bridge.request("apply", state); },
      refresh: async () => { await bridge.request("refresh"); },
      normalizeLegacy: (value) => normalizeLegacyContribution(value, declaration.persistentFieldIds),
      loadLegacy: async (path, value) => {
        const saved = record(value);
        const format = typeof saved?.format === "string" ? saved.format : "";
        const actions = descriptor.declaredActions.map(record).filter((action) => action !== null);
        const compatible = actions.flatMap((action) => {
          const handler = record(action.handler);
          const options = record(handler?.options);
          if (!options || !["tool-package.open", "tool-fields.load"].includes(String(handler?.capability))) return [];
          const prefix = handler?.capability === "tool-package.open" ? "flowcell-tool-package" : "flowcell-tool-fields";
          const formats = Array.isArray(options.legacyFormats) ? options.legacyFormats : [];
          return format === `${prefix}/${options.formatId}/v1` || formats.includes(format)
            ? [{ options, package: handler?.capability === "tool-package.open" }] : [];
        });
        if (compatible.length !== 1) throw new Error("The selected file's format is unsupported or ambiguous for this program theme.");
        const { options, package: isPackage } = compatible[0];
        const strings = (key: string) => Array.isArray(options[key]) ? options[key].filter((item): item is string => typeof item === "string") : [];
        const map = (key: string) => Object.fromEntries(Object.entries(record(options[key]) ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
        const mapping = { legacyFormats: strings("legacyFormats"), fieldMap: map("legacyFieldMap"), assetMap: map("legacyAssetMap"), fieldTransforms: map("legacyFieldTransforms") };
        const common = { formatId: options.formatId, legacyFormats: mapping.legacyFormats,
          valueFields: strings("valueFields"), legacyValueKeys: Object.keys(mapping.fieldMap) };
        const loaded = isPackage
          ? await invoke<LoadedToolPackageFields>("load_tool_package", { ...common,
            programName: descriptor.programName, panelName: descriptor.panelName, fileName: descriptor.fileName,
            capability: options.capability, storageFolder: options.storageFolder, manifestPath: path,
            assetFields: strings("assetFields"), legacyAssetKeys: Object.keys(mapping.assetMap) })
          : await invoke<LoadedToolPackageFields>("load_tool_field_file", { ...common, path });
        const fields = mappedToolPackageFields(loaded, mapping);
        return {
          state: normalizeLegacyContribution({ fields }, declaration.persistentFieldIds),
          ...(fields.popped_button_settings === undefined ? {} : { buttonSettings: fields.popped_button_settings }),
          ...(fields.popped_button_appearance === undefined ? {} : { buttonAppearance: fields.popped_button_appearance })
        };
      }
    });
  };
  if (error) return <p role="alert">{error}</p>;
  if (!descriptor || !context) return null;
  return <section hidden={!active} className="theme-editor-contribution" aria-label={`${programName} program theme features`}>
    <div className="theme-editor-contribution__page">
      <InstalledPageWindowPage context={context} embedded embeddedVisible={active} onThemeBridge={bridgeReady}
        onThemeLibrary={(action) => callbacks.current.onLibraryAction(action)} />
    </div>
  </section>;
}
