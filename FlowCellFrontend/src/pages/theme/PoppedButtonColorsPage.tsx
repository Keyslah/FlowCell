import { useMemo, useRef } from "react";
import type { JsonObject, JsonValue } from "../../button/types";
import { BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION } from "../../lib/windowContext";
import InstalledPageWindowPage, { type InstalledPageDescriptor, type InstalledPageThemeBridge } from "../installed-page/InstalledPageWindowPage";
import { runInstalledPageCoreAction, type InstalledPageCoreActionPlan, type InstalledPageCoreIdentity } from "../installed-page/installedPageCoreBroker";
import pageScript from "./poppedButtonColors/page.js?raw";
import pageStyle from "./poppedButtonColors/page.css?raw";
import pageHtml from "./poppedButtonColors/index.html?raw";
import pageConfig from "./poppedButtonColors/page.config.json";

export interface PoppedButtonColorsController {
  preservePoppedAppearance(): Promise<boolean>;
  setActiveTheme(theme: { name: string; path: string; buttonSettings?: JsonValue; buttonAppearance?: JsonValue }): Promise<void>;
  refresh(): Promise<void>;
}

// A UI draft cache only. Applied appearance remains in the canonical Button document.
const pageDrafts = new Map<string, JsonValue>();
const paletteOperations: Readonly<Record<string, string>> = Object.freeze({
  "button-theme.scan": "scan", "button-theme.apply": "apply", "button-theme.refill": "refill",
  "button-theme.toggle-text": "toggle-text", "button-theme.settings": "settings",
  "button-theme.edit": "edit", "button-theme.participation": "participation"
});

export function poppedButtonCoreIdentity(programName: string): InstalledPageCoreIdentity {
  const key = programName.trim().toLocaleLowerCase("en");
  if (!key) throw new Error("Select a program for Popped Button Colors.");
  return { ownerButtonId: `core-popped-button-colors:${key}`, programName,
    panelName: "", fileName: "", pageId: "core.popped-button-colors" };
}

/** Fixed Core plans: the page can supply data, never capabilities or options. */
export function poppedButtonCorePlan(actionId: string, payload: unknown): InstalledPageCoreActionPlan {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Button action data must be an object.");
  if (Object.hasOwn(paletteOperations, actionId)) {
    return { kind: "core-action", capability: "button-theme.palette",
      options: { operation: paletteOperations[actionId] }, payload: payload as JsonObject };
  }
  if (actionId === "theme.image.select") return {
    kind: "core-action", capability: "file.select", options: {
      dialogTitle: "Choose Theme Reference Image", filter: "Images (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp",
      extensions: ["png", "jpg", "jpeg", "webp"], multiselect: false
    }, payload: {}
  };
  if (actionId === "theme.image.sample") return {
    kind: "core-action", capability: "image.sample-palette", options: { imagePathField: "theme_image_path" }, payload: payload as JsonObject
  };
  throw new Error(`The common Popped Button Colors page does not allow '${actionId}'.`);
}

export default function PoppedButtonColorsPage({ programName, active = true, onReady }: {
  programName: string;
  active?: boolean;
  onReady?: (controller: PoppedButtonColorsController | null) => void;
}) {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const identity = useMemo(() => poppedButtonCoreIdentity(programName), [programName]);
  const context = useMemo(() => ({ ...identity, kind: "installed-page" as const,
    schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION, alwaysOnTop: false }), [identity]);
  const builtinPage = useMemo(() => {
    const config = structuredClone(pageConfig);
    config.copy.ready = `${programName} Popped Button Colors are ready.`;
    const descriptor: InstalledPageDescriptor = {
      ...identity, programId: "", sourceRecordId: "", installedOwnerRoot: "",
      label: "Popped Button Colors", tooltip: "Edit this program's popped Button appearance.",
      entryHtml: pageHtml, scripts: [{ path: "page/page.js", content: pageScript }],
      styles: [{ path: "page/page.css", content: pageStyle }], assets: [],
      window: { title: "Popped Button Colors", width: 920, height: 720, minWidth: 920, minHeight: 560, alwaysOnTop: false },
      declaredResourcePaths: [], declaredActions: [], declaredCapabilities: [],
      ownerRuntimeStateNamespace: "", supportedDataFormats: [], config, refreshEvents: [],
      embeddedTheme: true, coreOwned: true, themeContribution: { version: 1, persistentFieldIds: [], assetFieldIds: [] }
    };
    return { descriptor, runAction: async (actionId: string, payload: unknown): Promise<unknown> => {
      if (actionId === "owner-state.read") return { state: structuredClone(pageDrafts.get(identity.ownerButtonId) ?? {}) };
      if (actionId === "owner-state.write") {
        const state = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as JsonObject).state : null;
        if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Popped Button draft state must be an object.");
        pageDrafts.set(identity.ownerButtonId, structuredClone(state));
        return {};
      }
      return runInstalledPageCoreAction(identity, actionId, poppedButtonCorePlan(actionId, payload));
    } };
  }, [identity, programName]);
  const bridgeReady = (bridge: InstalledPageThemeBridge | null) => {
    onReadyRef.current?.(bridge ? {
      preservePoppedAppearance: async () => (await bridge.request("policy") as { preservePoppedAppearance?: boolean })?.preservePoppedAppearance === true,
      setActiveTheme: async (theme) => { await bridge.request("set-active", theme); },
      refresh: async () => { await bridge.request("refresh"); }
    } : null);
  };
  return <InstalledPageWindowPage context={context} builtinPage={builtinPage} embedded embeddedVisible={active} onThemeBridge={bridgeReady} />;
}
