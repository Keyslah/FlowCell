import { useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { makeSafeTauriUnlisten } from "../../lib/safeTauriUnlisten.js";
import {
  THEME_EDITOR_CONTEXT_EVENT,
  type ThemeEditorWindowContext
} from "../../lib/windowContext.js";
import { listPanelFolders, listProgramFolders } from "../../lib/programRails.js";
import { showOpenFileDialog } from "../../lib/tauri.js";
import {
  listButtonSkinFiles,
  loadButtonSkinFile,
  loadButtonStateDocument,
  saveButtonStateDocument
} from "../../button/state/ButtonStateRepository.js";
import { loadMainPageButtonBootstrap } from "../../button/state/mainPageButtonBootstrap.js";
import {
  publishButtonCommit,
  subscribeButtonCommits
} from "../../button/state/ButtonDraftBus.js";
import { cloneButtonDocument } from "../../button/state/buttonDefaults.js";
import { createButtonSkinFromFile } from "../../button/editor/buttonSkinFiles.js";
import {
  BUTTON_GLOW_AMOUNT_MAX,
  BUTTON_HIGHLIGHT_AMOUNT_MAX,
  BUTTON_HIGHLIGHT_AMOUNT_MIN,
  DEFAULT_BUTTON_HIGHLIGHT_AMOUNT,
  buttonSkinColorOpacityPercent,
  buttonSkinColorWithOpacity,
  buttonSkinColorWithPreservedAlpha,
  buttonSkinPickerColor,
  normalizeButtonGlowAmount,
  normalizeButtonHighlightAmount,
  normalizeButtonSkinColor,
  resolveButtonGlowAmount,
  resolveButtonHighlightAmount
} from "../../button/skins/buttonSkinColors.js";
import type {
  ButtonPlacement,
  ButtonSkin,
  ButtonStateDocument,
  ButtonThemeOverride,
  JsonValue
} from "../../button/types.js";
import {
  applyThemeFile,
  bakeThemeGradientForDeployedLayout,
  buttonThemeOverrideIsEmpty,
  captureThemeFile,
  clearButtonThemeOverrideColors,
  emptyButtonThemeOverride,
  listThemePlacements,
  resolveThemeHighlightColorResetPlacementIds,
  resolveThemeSkinAssignmentPlacementIds,
  themeSkinAssignmentIdentity,
  type FlowCellThemeFile,
  type ThemeApplyResult,
  type ThemeGradientDefinition,
  type ThemeTarget
} from "../../theme/themeModel.js";
import {
  FLOWCELL_THEME_PAGE_REGISTRY,
  MAIN_THEME_PRESETS,
  defaultThemePageAppearance,
  getFlowCellThemePageDefinition,
  isFlowCellThemePageId,
  mainThemePresetAppearance,
  type FlowCellThemePageId,
  type ThemePageAppearance,
  type ThemePageAssetDefinition,
  type ThemePageAssetValue,
  type ThemePageTokenDefinition
} from "../../theme/themePageRegistry.js";
import {
  authorizeThemePageAssets,
  migrateStoredThemePaths,
  readActiveThemePageAppearance,
  writeAuthorizedThemePageAppearance
} from "../../theme/themeRuntime.js";
import {
  readThemeEditorScopeState,
  writeThemeEditorScopeState
} from "../../theme/themeEditorState.js";
import {
  exportPortableTheme, importedThemeFileName, legacyThemeIdentity, listThemeLibrary, materializeTheme, readTheme, savePortableTheme,
  type ReadThemeResult
} from "../../theme/themeFile.js";
import { capturePortableTheme, planPortableThemeImport, type PortableTheme, type ThemeToolDescriptor } from "../../theme/portableTheme.js";
import { applyCommonProgramThemeEdit, applyLegacyProgramAppearance } from "../../theme/commonProgramTheme.js";
import { resolveProgramPopoutThemeOverride } from "../../theme/programPopoutTheme.js";
import { resolveButtonPlacementPresentation } from "../../button/state/buttonPresentation.js";
import { openButtonEditorWindow } from "../../button/windows/buttonWindows.js";
import { getThemeToolDescriptors, preparePortableThemeImport } from "../../theme/portableThemeService.js";
import ThemeContribution, { reviewThemeContribution, type ThemeContributionController } from "./ThemeContribution.js";
import PoppedButtonColorsPage, { type PoppedButtonColorsController } from "./PoppedButtonColorsPage.js";
import ThemeLibraryDialog from "./ThemeLibraryDialog.js";
import "./themeEditorPage.css";

const FLOWCELL_TARGET_VALUE = "__flowcell__";
const ALL_PANELS_VALUE = "__all_panels__";
const POPOUTS_ONLY_VALUE = "__popouts_only__";

type PageControlGroup = {
  name: string;
  tokens: ThemePageTokenDefinition[];
  assets: ThemePageAssetDefinition[];
};

type ResolvedEditorContext = {
  targetValue: string;
  pageValue: FlowCellThemePageId;
  panelValue: string;
  unavailableTarget: string | null;
};

type SavedSkinChoice = {
  path: string;
  skin: ButtonSkin;
};

type ThemeEffectAmountField =
  | "hoverHighlightAmount"
  | "activeHighlightAmount"
  | "hoverGlowAmount"
  | "activeGlowAmount";

type ThemeEffectAmountControl = {
  field: ThemeEffectAmountField;
  label: string;
  ariaLabel: string;
  max: number;
};

const HIGHLIGHT_AMOUNT_CONTROLS: readonly ThemeEffectAmountControl[] = [
  { field: "hoverHighlightAmount", label: "On hover", ariaLabel: "Highlight on hover", max: BUTTON_HIGHLIGHT_AMOUNT_MAX },
  { field: "activeHighlightAmount", label: "When active", ariaLabel: "Highlight when active", max: BUTTON_HIGHLIGHT_AMOUNT_MAX }
];

const GLOW_AMOUNT_CONTROLS: readonly ThemeEffectAmountControl[] = [
  { field: "hoverGlowAmount", label: "On hover", ariaLabel: "Glow on hover", max: BUTTON_GLOW_AMOUNT_MAX },
  { field: "activeGlowAmount", label: "When active", ariaLabel: "Glow when active", max: BUTTON_GLOW_AMOUNT_MAX }
];

const ALL_EFFECT_AMOUNT_CONTROLS = [
  ...HIGHLIGHT_AMOUNT_CONTROLS,
  ...GLOW_AMOUNT_CONTROLS
] as const;

const DEFAULT_GRADIENT: ThemeGradientDefinition = {
  role: "surface",
  topColor: "#8DCF9B",
  bottomColor: "#254936",
  spread: 100,
  scatter: 20,
  seed: 1
};

const THEME_EDITOR_GRADIENT_ROLES: readonly string[] = [
  "surface",
  "text"
];

function initialScopeGradient(stored: ThemeGradientDefinition | null | undefined): ThemeGradientDefinition {
  return { ...(stored ?? DEFAULT_GRADIENT), role: "surface" };
}

function gradientRoleLabel(role: string): string {
  if (role === "surface") return "Surface";
  if (role === "text") return "Text";
  return role;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function warningSuffix(warnings: readonly string[]): string {
  return warnings.length > 0 ? ` Warning: ${warnings.join(" ")}` : "";
}

function normalizeName(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en");
}

function activePlacementSkin(
  document: ButtonStateDocument,
  placement: ButtonPlacement
): ButtonSkin | null {
  const button = document.buttons[placement.buttonId];
  return button
    ? document.skins[placement.skinOverrideId ?? button.defaultSkinId] ?? null
    : null;
}

function ensureThemeOverride(
  document: ButtonStateDocument,
  placementId: string
): ButtonThemeOverride {
  document.themeOverrides ??= {};
  document.themeOverrides[placementId] ??= emptyButtonThemeOverride();
  return document.themeOverrides[placementId];
}

function scopedEffectAmountSummary(
  document: ButtonStateDocument | null,
  placements: readonly ButtonPlacement[],
  field: ThemeEffectAmountField
): { value: number; mixed: boolean } {
  const values = placements.map((placement) => {
    const override = document ? resolveProgramPopoutThemeOverride(document, placement.id) : undefined;
    const value = override?.[field] ?? override?.highlightAmount;
    return field === "hoverGlowAmount" || field === "activeGlowAmount"
      ? resolveButtonGlowAmount(value)
      : resolveButtonHighlightAmount(value);
  });
  const value = values[0] ?? DEFAULT_BUTTON_HIGHLIGHT_AMOUNT;
  return {
    value,
    mixed: values.some((candidate) => candidate !== value)
  };
}

function readAllPageAppearances(): Record<FlowCellThemePageId, ThemePageAppearance> {
  return Object.fromEntries(
    FLOWCELL_THEME_PAGE_REGISTRY.map((page) => [
      page.id,
      readActiveThemePageAppearance(page.id)
    ])
  ) as Record<FlowCellThemePageId, ThemePageAppearance>;
}

function initialPageValue(context: ThemeEditorWindowContext): FlowCellThemePageId {
  return isFlowCellThemePageId(context.page) ? context.page : "main";
}

function resolvedEditorContext(
  context: ThemeEditorWindowContext,
  programs: readonly string[]
): ResolvedEditorContext {
  const requestedTarget = context.target?.trim() ?? "";
  const requestedPage = initialPageValue(context);
  if (!requestedTarget || ["flowcell", "main"].includes(normalizeName(requestedTarget))) {
    return {
      targetValue: FLOWCELL_TARGET_VALUE,
      pageValue: requestedPage,
      panelValue: ALL_PANELS_VALUE,
      unavailableTarget: null
    };
  }
  const matchedProgram = programs.find(
    (programName) => normalizeName(programName) === normalizeName(requestedTarget)
  );
  if (!matchedProgram) {
    return {
      targetValue: FLOWCELL_TARGET_VALUE,
      pageValue: "main",
      panelValue: ALL_PANELS_VALUE,
      unavailableTarget: requestedTarget
    };
  }
  return {
    targetValue: matchedProgram,
    pageValue: requestedPage,
    panelValue: context.page?.trim() || ALL_PANELS_VALUE,
    unavailableTarget: null
  };
}

function targetFromSelection(
  targetValue: string,
  pageValue: FlowCellThemePageId,
  panelValue: string
): ThemeTarget {
  if (targetValue === FLOWCELL_TARGET_VALUE) {
    return { kind: "flowcell", page: pageValue };
  }
  const popoutsOnly = panelValue === POPOUTS_ONLY_VALUE;
  return {
    kind: "program",
    programName: targetValue,
    panelName: popoutsOnly || panelValue === ALL_PANELS_VALUE ? null : panelValue,
    ...(popoutsOnly ? { area: "popouts" as const } : {})
  };
}

function themeSuggestedName(target: ThemeTarget): string {
  if (target.kind === "flowcell") {
    return `FlowCell ${getFlowCellThemePageDefinition(target.page).label} Theme`;
  }
  if (target.area === "popouts") return `${target.programName} Pop-outs Theme`;
  return target.panelName
    ? `${target.programName} ${target.panelName} Theme`
    : `${target.programName} Theme`;
}

function pageControlGroups(pageId: FlowCellThemePageId): PageControlGroup[] {
  const definition = getFlowCellThemePageDefinition(pageId);
  const groups = new Map<string, PageControlGroup>();
  const groupFor = (name: string) => {
    const existing = groups.get(name);
    if (existing) return existing;
    const created = { name, tokens: [], assets: [] } satisfies PageControlGroup;
    groups.set(name, created);
    return created;
  };
  definition.tokens.forEach((token) => groupFor(token.group).tokens.push(token));
  definition.assets.forEach((asset) => groupFor(asset.group).assets.push(asset));
  return [...groups.values()];
}

function formatApplyStatus(prefix: string, result: ThemeApplyResult): string {
  const messages = [
    `${prefix} ${result.appliedButtonCount} Button${result.appliedButtonCount === 1 ? "" : "s"}.`
  ];
  if (result.missingButtonCount > 0) {
    messages.push(
      `${result.missingButtonCount} saved Button${result.missingButtonCount === 1 ? " was" : "s were"} not found.`
    );
  }
  result.issues.forEach((issue) => messages.push(`${issue.surfaceName}: ${issue.message}`));
  return messages.join(" ");
}

function mergeCanonicalIntoDraft(
  current: ButtonStateDocument | null,
  incoming: ButtonStateDocument,
  dirtyPlacementIds: ReadonlySet<string>,
  baseline?: ButtonStateDocument | null
): ButtonStateDocument {
  if (!current || dirtyPlacementIds.size === 0) return cloneButtonDocument(incoming);
  const merged = cloneButtonDocument(incoming);
  for (const placementId of dirtyPlacementIds) {
    const draftPlacement = current.placements[placementId];
    const incomingPlacement = merged.placements[placementId];
    if (!draftPlacement || !incomingPlacement) continue;
    for (const field of Object.keys(draftPlacement) as (keyof ButtonPlacement)[]) {
      if (["id", "buttonId", "surfaceId"].includes(field) || stableJson(draftPlacement[field]) === stableJson(baseline?.placements[placementId]?.[field])) continue;
      Object.assign(incomingPlacement, { [field]: structuredClone(draftPlacement[field]) });
    }
    merged.themeOverrides ??= {};
    const override = current.themeOverrides?.[placementId];
    if (override) merged.themeOverrides[placementId] = structuredClone(override);
    else delete merged.themeOverrides[placementId];
    const skinId = draftPlacement.skinOverrideId;
    if (skinId && current.skins[skinId] && !merged.skins[skinId]) {
      merged.skins[skinId] = structuredClone(current.skins[skinId]);
    }
    for (const key of ["programPopoutColorOverrides", "programPopoutThemeLocks"] as const) {
      const value = current[key]?.[placementId];
      if (stableJson(value) === stableJson(baseline?.[key]?.[placementId])) continue;
      merged[key] ??= {};
      if (value) (merged[key] as Record<string, typeof value>)[placementId] = structuredClone(value);
      else delete merged[key]![placementId];
    }
  }
  for (const surface of Object.values(current.surfaces)) {
    const incomingSurface = merged.surfaces[surface.id];
    if (!incomingSurface || stableJson(surface.placementIds) === stableJson(baseline?.surfaces[surface.id]?.placementIds)) continue;
    if (surface.placementIds.some((id) => dirtyPlacementIds.has(id))) {
      incomingSurface.placementIds = [...surface.placementIds.filter((id) => incomingSurface.placementIds.includes(id)),
        ...incomingSurface.placementIds.filter((id) => !surface.placementIds.includes(id))];
    }
  }
  for (const [programName, settings] of Object.entries(current.programPopoutThemes ?? {})) {
    if (![...dirtyPlacementIds].some((id) => listThemePlacements(current, { kind: "program", programName, panelName: null }).some((placement) => placement.id === id))) continue;
    for (const field of Object.keys(settings) as (keyof typeof settings)[]) {
      if (stableJson(settings[field]) === stableJson(baseline?.programPopoutThemes?.[programName]?.[field])) continue;
      merged.programPopoutThemes ??= {};
      merged.programPopoutThemes[programName] ??= structuredClone(settings);
      Object.assign(merged.programPopoutThemes[programName], { [field]: structuredClone(settings[field]) });
    }
  }
  return merged;
}

function skinSourcesMatch(left: ButtonSkin, right: ButtonSkin): boolean {
  return [
    "structure",
    "keyframes",
    "base",
    "hover",
    "play",
    "pressed",
    "held",
    "release",
    "disabled",
    "error"
  ].every((section) => (
    left[section as keyof ButtonSkin] === right[section as keyof ButtonSkin]
  ));
}

function stableSkinId(path: string, source: string): string {
  let hash = 0x811c9dc5;
  const value = `${normalizeName(path)}\u0000${source}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `flowcell-saved-skin-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function installSavedSkin(document: ButtonStateDocument, saved: ButtonSkin): string {
  const existing = Object.values(document.skins).find((skin) => skinSourcesMatch(skin, saved));
  if (existing) return existing.id;
  let id = saved.id;
  let suffix = 2;
  while (document.skins[id] && !skinSourcesMatch(document.skins[id], saved)) {
    id = `${saved.id}-${suffix}`;
    suffix += 1;
  }
  document.skins[id] = { ...structuredClone(saved), id, compileCache: null };
  return id;
}

function ThemeColorControl({
  value,
  label,
  onChange
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const normalized = normalizeButtonSkinColor(value) ?? "#FFFFFF";
  const opacity = buttonSkinColorOpacityPercent(normalized);
  return (
    <div className="theme-editor__color-control">
      <input
        type="color"
        aria-label={`${label} color`}
        value={buttonSkinPickerColor(normalized)}
        onChange={(event) => {
          const next = buttonSkinColorWithPreservedAlpha(event.currentTarget.value, normalized);
          if (next) onChange(next);
        }}
      />
      <label className="theme-editor__opacity-control">
        <span>Opacity</span>
        <input
          type="number"
          aria-label={`${label} opacity percent`}
          min="0"
          max="100"
          step="1"
          value={opacity}
          onChange={(event) => {
            const next = buttonSkinColorWithOpacity(normalized, Number(event.currentTarget.value));
            if (next) onChange(next);
          }}
        />
        <b>%</b>
      </label>
    </div>
  );
}

export default function ThemeEditorPage({
  context
}: {
  context: ThemeEditorWindowContext;
}) {
  const initialTarget = context.target?.trim() || FLOWCELL_TARGET_VALUE;
  const [programNames, setProgramNames] = useState<string[]>([]);
  const [targetValue, setTargetValue] = useState(
    normalizeName(initialTarget) === "flowcell" ? FLOWCELL_TARGET_VALUE : initialTarget
  );
  const [pageValue, setPageValue] = useState<FlowCellThemePageId>(initialPageValue(context));
  const [panelValue, setPanelValue] = useState(
    normalizeName(initialTarget) === "flowcell"
      ? ALL_PANELS_VALUE
      : context.page?.trim() || ALL_PANELS_VALUE
  );
  const [canonicalDocument, setCanonicalDocument] = useState<ButtonStateDocument | null>(null);
  const canonicalBaseline = useRef<ButtonStateDocument | null>(null);
  const [draftDocument, setDraftDocument] = useState<ButtonStateDocument | null>(null);
  const [pageAppearances, setPageAppearances] = useState(readAllPageAppearances);
  const [savedSkins, setSavedSkins] = useState<SavedSkinChoice[]>([]);
  const [selectedPlacementId, setSelectedPlacementId] = useState("");
  const [selectedSavedSkinPath, setSelectedSavedSkinPath] = useState("");
  const [assignEveryButtonInScope, setAssignEveryButtonInScope] = useState(false);
  const [gradient, setGradient] = useState<ThemeGradientDefinition>(DEFAULT_GRADIENT);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("Loading Theme Editor...");
  const [libraryMode, setLibraryMode] = useState<"open" | "import" | null>(null);
  const [contributionAvailable, setContributionAvailable] = useState<boolean | null>(null);
  const [themeName, setThemeName] = useState("My Theme");
  const [activeTheme, setActiveTheme] = useState<{ id: string; path: string; name: string } | null>(null);
  const contribution = useRef<ThemeContributionController | null>(null);
  const poppedColors = useRef<PoppedButtonColorsController | null>(null);
  const dirtyPlacementIds = useRef(new Set<string>());
  const skinAssignmentPlacementIds = useRef(new Set<string>());
  const highlightColorResetPlacementIds = useRef({
    hover: new Set<string>(),
    active: new Set<string>()
  });
  const editorDirty = useRef(false);

  const target = useMemo(
    () => targetFromSelection(targetValue, pageValue, panelValue),
    [pageValue, panelValue, targetValue]
  );
  const targetLibraryKey = target.kind === "program" ? target.programName : "main";
  const showingProgramPage = target.kind === "program";
  useEffect(() => {
    let cancelled = false;
    setContributionAvailable(null);
    poppedColors.current = null;
    void migrateStoredThemePaths().then(() => {
      if (cancelled) return;
      try {
        const saved = JSON.parse(window.localStorage.getItem("flowcell.selected-themes.v1") ?? "{}")[targetLibraryKey];
        setActiveTheme(saved ?? null);
        setThemeName(saved?.name ?? `${targetLibraryKey === "main" ? "Main" : targetLibraryKey} Theme`);
      } catch { setActiveTheme(null); }
    }).catch((error) => { if (!cancelled) setStatus(`Theme paths could not migrate: ${errorMessage(error)}`); });
    setLibraryMode(null);
    return () => { cancelled = true; };
  }, [targetLibraryKey]);
  const rememberTheme = (selection: { id: string; path: string; name: string }) => {
    setActiveTheme(selection); setThemeName(selection.name);
    try {
      const stored = JSON.parse(window.localStorage.getItem("flowcell.selected-themes.v1") ?? "{}");
      stored[targetLibraryKey] = selection;
      window.localStorage.setItem("flowcell.selected-themes.v1", JSON.stringify(stored));
    } catch { /* The canonical presentation is persisted independently. */ }
  };
  const selectedPageDefinition = getFlowCellThemePageDefinition(pageValue);
  const selectedPageAppearance = pageAppearances[pageValue] ?? defaultThemePageAppearance(pageValue);
  const selectedPageGroups = useMemo(() => pageControlGroups(pageValue), [pageValue]);
  const supportsButtons = target.kind === "program" ||
    selectedPageDefinition.buttonSurfaceIds.length > 0 ||
    selectedPageDefinition.buttonSurfaceIdPrefixes.length > 0;

  useEffect(() => {
    let cancelled = false;
    void migrateStoredThemePaths().then(() => loadMainPageButtonBootstrap({ removeStaleOwners: false }))
      .then(({ document, registeredPanels }) => {
        if (cancelled) return;
        const programs = registeredPanels.map((entry) => entry.programName);
        const resolved = resolvedEditorContext(context, programs);
        setProgramNames(programs);
        setTargetValue(resolved.targetValue);
        setPageValue(resolved.pageValue);
        setPanelValue(resolved.panelValue);
        setCanonicalDocument(document);
        canonicalBaseline.current = document;
        setPageAppearances(readAllPageAppearances());
        setDraftDocument(cloneButtonDocument(document));
        setStatus(resolved.unavailableTarget
          ? `Target '${resolved.unavailableTarget}' is not currently installed; showing FlowCell.`
          : "Ready.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(`Theme Editor could not load: ${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listButtonSkinFiles()
      .then(async (paths) => Promise.all(paths.map(async (path) => {
        const source = await loadButtonSkinFile(path);
        return {
          path,
          skin: createButtonSkinFromFile(source, path, stableSkinId(path, source))
        } satisfies SavedSkinChoice;
      })))
      .then((choices) => {
        if (cancelled) return;
        setSavedSkins(choices);
        setSelectedSavedSkinPath((current) => current || choices[0]?.path || "");
      })
      .catch((error) => {
        if (!cancelled) setStatus(`Saved skins could not load: ${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    void listen<ThemeEditorWindowContext>(THEME_EDITOR_CONTEXT_EVENT, (event) => {
      void loadMainPageButtonBootstrap({ removeStaleOwners: false })
        .then(({ document, registeredPanels }) => {
          if (cancelled) return;
          const programs = registeredPanels.map((entry) => entry.programName);
          const resolved = resolvedEditorContext(event.payload, programs);
          setProgramNames(programs);
          setTargetValue(resolved.targetValue);
          setPageValue(resolved.pageValue);
          setPanelValue(resolved.panelValue);
          setCanonicalDocument(cloneButtonDocument(document));
            const baseline = canonicalBaseline.current;
            canonicalBaseline.current = document;
          setDraftDocument((current) => mergeCanonicalIntoDraft(
            current,
            document,
              dirtyPlacementIds.current,
              baseline
          ));
          setStatus(resolved.unavailableTarget
            ? `Target '${resolved.unavailableTarget}' is not currently installed; showing FlowCell.`
            : "Theme Editor scope updated.");
        })
        .catch((error) => {
          if (!cancelled) setStatus(`Theme Editor scope could not update: ${errorMessage(error)}`);
        });
    })
      .then((dispose) => {
        const safeDispose = makeSafeTauriUnlisten(dispose);
        if (cancelled) safeDispose();
        else unlisten = safeDispose;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    void subscribeButtonCommits((document) => {
      if (cancelled) return;
      setCanonicalDocument(cloneButtonDocument(document));
      const baseline = canonicalBaseline.current;
      canonicalBaseline.current = document;
      setDraftDocument((current) => mergeCanonicalIntoDraft(
        current,
        document,
        dirtyPlacementIds.current,
        baseline
      ));
      if (editorDirty.current) {
        setStatus("Canonical Buttons updated; unsaved Theme Editor changes were preserved.");
      }
    })
      .then((dispose) => {
        const safeDispose = makeSafeTauriUnlisten(dispose);
        if (cancelled) safeDispose();
        else unlisten = safeDispose;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (targetValue === FLOWCELL_TARGET_VALUE) {
      setPanelValue(ALL_PANELS_VALUE);
      return;
    }
    let cancelled = false;
    void listPanelFolders(targetValue)
      .then((panels) => {
        if (cancelled) return;
        setPanelValue((current) =>
          current === ALL_PANELS_VALUE ||
          current === POPOUTS_ONLY_VALUE ||
          panels.includes(current)
            ? current
            : ALL_PANELS_VALUE
        );
      })
      .catch((error) => {
        if (!cancelled) setStatus(`Panels could not load: ${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [targetValue]);

  useEffect(() => {
    const stored = readThemeEditorScopeState(target);
    setGradient(initialScopeGradient(stored?.gradient));
    setAssignEveryButtonInScope(false);
    skinAssignmentPlacementIds.current.clear();
  }, [target]);

  const scopedPlacements = useMemo(
    () => draftDocument ? listThemePlacements(draftDocument, target) : [],
    [draftDocument, target]
  );

  useEffect(() => {
    if (!scopedPlacements.some((placement) => placement.id === selectedPlacementId)) {
      setSelectedPlacementId(scopedPlacements[0]?.id ?? "");
    }
  }, [scopedPlacements, selectedPlacementId]);

  useEffect(() => {
    if (!THEME_EDITOR_GRADIENT_ROLES.includes(gradient.role)) {
      setGradient((current) => ({ ...current, role: "surface" }));
    }
  }, [gradient.role]);

  const markEditorDirty = () => {
    editorDirty.current = true;
  };

  const updateDraft = (
    mutate: (document: ButtonStateDocument) => void,
    placementIds: readonly string[]
  ) => {
    placementIds.forEach((placementId) => dirtyPlacementIds.current.add(placementId));
    markEditorDirty();
    setDraftDocument((current) => {
      if (!current) return current;
      const next = cloneButtonDocument(current);
      mutate(next);
      return next;
    });
  };

  const updatePageAppearance = (mutate: (appearance: ThemePageAppearance) => void) => {
    markEditorDirty();
    setPageAppearances((current) => {
      const appearance = structuredClone(
        current[pageValue] ?? defaultThemePageAppearance(pageValue)
      );
      mutate(appearance);
      return { ...current, [pageValue]: appearance };
    });
  };

  const updateGradient = (mutate: (current: ThemeGradientDefinition) => ThemeGradientDefinition) => {
    markEditorDirty();
    setGradient(mutate);
  };

  const applyGradient = (nextGradient = gradient) => {
    if (!draftDocument || !nextGradient.role || scopedPlacements.length === 0) return;
    try {
      const previewTheme = captureThemeFile({
        document: draftDocument,
        target,
        page: target.kind === "flowcell" ? selectedPageAppearance : null,
        gradient: nextGradient,
        buttonParticipation: {},
        skinAssignmentPlacementIds: skinAssignmentPlacementIds.current
      });
      const baked = bakeThemeGradientForDeployedLayout(draftDocument, previewTheme);
      const placementIds = Object.keys(baked.colorsBySavedPlacementId);
      const resolvedPlacementIds = new Set(placementIds);
      if (
        placementIds.length !== scopedPlacements.length ||
        scopedPlacements.some((placement) => !resolvedPlacementIds.has(placement.id))
      ) {
        setStatus(
          `Nothing changed: the gradient did not resolve the exact ${scopedPlacements.length}-Button scope.`
        );
        return;
      }
      updateDraft((document) => {
        applyCommonProgramThemeEdit(document, target, placementIds, {
          kind: "colors", role: nextGradient.role, colors: baked.colorsBySavedPlacementId
        });
      }, placementIds);
      setGradient(nextGradient);
      setStatus(`Applied ${nextGradient.role} across all ${placementIds.length} in-scope Buttons.`);
    } catch (error) {
      setStatus(`Gradient could not be applied: ${errorMessage(error)}`);
    }
  };

  const applyEffectAmount = (
    field: ThemeEffectAmountField,
    label: string,
    value: number
  ) => {
    if (!draftDocument || scopedPlacements.length === 0) return;
    const amount = field === "hoverGlowAmount" || field === "activeGlowAmount"
      ? normalizeButtonGlowAmount(value)
      : normalizeButtonHighlightAmount(value);
    if (amount === null) {
      setStatus(`Amount must be a whole percentage from 0 through ${
        field === "hoverGlowAmount" || field === "activeGlowAmount"
          ? BUTTON_GLOW_AMOUNT_MAX
          : BUTTON_HIGHLIGHT_AMOUNT_MAX
      }.`);
      return;
    }
    const placementIds = scopedPlacements.map((placement) => placement.id);
    updateDraft((document) => {
      applyCommonProgramThemeEdit(document, target, placementIds, { kind: "effect", field, amount });
    }, placementIds);
    setStatus(
      `Set ${label.toLocaleLowerCase("en")} to ${amount}% across all ${placementIds.length} in-scope Buttons.`
    );
  };

  const handleAssignSkin = () => {
    if (!draftDocument || !selectedPlacementId) return;
    const selectedPlacement = scopedPlacements.find(
      (placement) => placement.id === selectedPlacementId
    );
    const saved = savedSkins.find((choice) => choice.path === selectedSavedSkinPath);
    if (!selectedPlacement || !saved) return;
    const targetIds = resolveThemeSkinAssignmentPlacementIds(
      scopedPlacements,
      selectedPlacement.id,
      assignEveryButtonInScope
    );
    if (targetIds.length === 0) return;
    updateDraft((document) => {
      const assignedSkinId = installSavedSkin(document, saved.skin);
      targetIds.forEach((placementId) => {
        const placement = document.placements[placementId];
        const button = placement ? document.buttons[placement.buttonId] : null;
        if (!placement || !button) return;
        placement.skinOverrideId = button.defaultSkinId === assignedSkinId ? null : assignedSkinId;
        const colorReset = clearButtonThemeOverrideColors(
          document.themeOverrides?.[placementId]
        );
        if (buttonThemeOverrideIsEmpty(colorReset)) {
          if (document.themeOverrides) delete document.themeOverrides[placementId];
        } else {
          document.themeOverrides ??= {};
          document.themeOverrides[placementId] = colorReset;
        }
        skinAssignmentPlacementIds.current.add(placementId);
      });
    }, targetIds);
    setStatus(
      `Assigned '${saved.skin.name}' to ${assignEveryButtonInScope ? "all " : ""}${targetIds.length} Button${targetIds.length === 1 ? "" : "s"} inside the current scope with its authored colors. No saved skin file was edited.`
    );
  };

  const captureCurrentTheme = (): FlowCellThemeFile => {
    if (!draftDocument) throw new Error("Canonical Button state is not loaded yet.");
    return captureThemeFile({
      document: draftDocument,
      target,
      page: target.kind === "flowcell" ? selectedPageAppearance : null,
      gradient,
      buttonParticipation: {},
      skinAssignmentPlacementIds: skinAssignmentPlacementIds.current,
      highlightColorResetPlacementIds: highlightColorResetPlacementIds.current
    });
  };

  const captureCompleteTheme = async (): Promise<PortableTheme> => {
    if (!draftDocument) throw new Error("Button state is not loaded yet.");
    if (target.kind === "program") {
      const installed = await invoke<unknown>("resolve_theme_contribution", { programName: target.programName });
      if (installed && !contribution.current) throw new Error("The program theme features are still loading. Try saving again when they are ready.");
    }
    const extension = target.kind === "program" ? await contribution.current?.capture() : null;
    return capturePortableTheme({ document: draftDocument, target, name: themeName,
      descriptors: await getThemeToolDescriptors(target), theme: captureCurrentTheme(),
      ...(activeTheme?.id && activeTheme.name === themeName ? { id: activeTheme.id } : {}),
      contributions: extension ? { [extension.sourceId]: extension } : {} });
  };

  const updateContributionSelection = async (theme: PortableTheme, path: string) => {
    const controls = contribution.current ?? poppedColors.current;
    if (!controls || target.kind !== "program") return;
    const document = await loadButtonStateDocument();
    const plan = planPortableThemeImport(document, theme, target, await getThemeToolDescriptors(target));
    const appearance = theme.programAppearance;
    const placements = appearance ? Object.entries(plan.placementIds).map(([savedId, placementId]) => ({
      placementId, buttonId: document.placements[placementId].buttonId,
      ...(appearance.overrides[savedId]?.surface ? { color: appearance.overrides[savedId].surface } : {}),
      ...(appearance.overrides[savedId]?.text ? { textColor: appearance.overrides[savedId].text } : {}),
      ...(appearance.locks[savedId] ? { lockedAppearance: appearance.locks[savedId] } : {})
    })) : [];
    await controls.setActiveTheme({ name: theme.name, path,
      ...(appearance?.settings ? { buttonSettings: appearance.settings as unknown as JsonValue } : {}),
      ...(appearance ? { buttonAppearance: { version: 1, placements } as unknown as JsonValue } : {}) });
  };

  const commitCompleteTheme = async (theme: PortableTheme) => {
    const extensions = Object.values(theme.contributions);
    const controller = contribution.current;
    const controls = controller ?? poppedColors.current;
    if (extensions.length > 1 || extensions.some((entry) => entry.sourceId !== controller?.sourceId)) {
      throw new Error("The selected program's required theme contribution is unavailable or incompatible.");
    }
    const previous = extensions.length ? await controller!.capture() : null;
    if (previous && extensions.some((entry) => entry.sourceVersion && previous.sourceVersion !== entry.sourceVersion)) {
      throw new Error(`The theme requires program contribution version ${extensions[0].sourceVersion}; installed version is ${previous.sourceVersion ?? "unknown"}.`);
    }
    if (previous && extensions.some((entry) => stableJson([...entry.assetFields].sort()) !== stableJson([...previous.assetFields].sort()))) {
      throw new Error("The theme's declared assets do not match the installed program contribution.");
    }
    if (extensions[0]) await controller!.validate(extensions[0].state);
    const authorizedPage = theme.theme.page ? await authorizeThemePageAssets(theme.theme.page) : null;
    const stagedSources = await invoke<{ token: string | null; descriptors: ThemeToolDescriptor[] }>("prepare_theme_archive_sources", {
      theme, programName: target.kind === "program" ? target.programName : null
    });
    const appliedTheme = structuredClone(theme);
    if (controls && await controls.preservePoppedAppearance()) delete appliedTheme.programAppearance;
    const prepared = await preparePortableThemeImport({ theme: appliedTheme, target, extraDescriptors: stagedSources.descriptors })
      .catch(async (error) => {
        if (stagedSources.token) await invoke("finish_theme_archive_sources", { token: stagedSources.token });
        throw error;
      });
    let hostChanged = false;
    const previousPage = authorizedPage ? readActiveThemePageAppearance(authorizedPage.pageId) : null;
    let pageChanged = false;
    const warnings: string[] = [];
    try {
      if (extensions[0]) {
        hostChanged = true;
        await controller!.apply(extensions[0].state);
      }
      let page: ThemePageAppearance | null = null;
      if (authorizedPage) {
        pageChanged = true;
        page = await writeAuthorizedThemePageAppearance(authorizedPage);
      }
      const saved = await prepared.commit();
      await publishButtonCommit(saved).catch((error) => warnings.push(`Theme saved; live Button updates could not be published: ${errorMessage(error)}`));
      acceptCommittedTheme(saved, page);
      await controls?.refresh().catch((error) => warnings.push(`Theme applied; program controls could not refresh: ${errorMessage(error)}`));
      return { saved, warnings };
    } catch (error) {
      const recoveryErrors: string[] = [];
      try { await prepared.rollback(); } catch (failure) { recoveryErrors.push(errorMessage(failure)); }
      if (pageChanged && previousPage) {
        try { await writeAuthorizedThemePageAppearance(previousPage); } catch (failure) { recoveryErrors.push(errorMessage(failure)); }
      }
      if (hostChanged && previous) {
        try { await controller!.apply(previous.state); }
        catch (restoreError) { recoveryErrors.push(`Previous program settings could not be restored: ${errorMessage(restoreError)}`); }
      }
      if (recoveryErrors.length) throw new Error(`${errorMessage(error)} Recovery remains pending: ${recoveryErrors.join("; ")}`);
      throw error;
    } finally {
      if (stagedSources.token) await invoke("finish_theme_archive_sources", { token: stagedSources.token })
        .catch((error) => warnings.push(`Temporary source cleanup remains pending: ${errorMessage(error)}`));
    }
  };

  const commitTheme = async (theme: FlowCellThemeFile): Promise<{
    saved: ButtonStateDocument;
    applied: ThemeApplyResult;
    page: ThemePageAppearance | null;
    warnings: string[];
  }> => {
    const latest = await loadButtonStateDocument();
    const applied = applyThemeFile(latest, theme);
    const authorizedPage = theme.page
      ? await authorizeThemePageAssets(theme.page)
      : null;
    let saved = latest;
    const warnings: string[] = [];
    const previousPage = authorizedPage ? readActiveThemePageAppearance(authorizedPage.pageId) : null;
    const storedPage = authorizedPage ? await writeAuthorizedThemePageAppearance(authorizedPage) : null;
    const buttonStateChanged = stableJson(applied.document) !== stableJson(latest);
    if (buttonStateChanged) {
      const expectedSaved = cloneButtonDocument(applied.document);
      expectedSaved.revision = latest.revision + 1;
      try {
        saved = await saveButtonStateDocument(applied.document, latest.revision);
      } catch (saveError) {
        const recovered = await loadButtonStateDocument().catch(() => null);
        if (!recovered || stableJson(recovered) !== stableJson(expectedSaved)) {
          if (previousPage) await writeAuthorizedThemePageAppearance(previousPage);
          throw saveError;
        }
        saved = recovered;
        warnings.push(`Buttons were saved, but native cleanup reported: ${errorMessage(saveError)}`);
      }
      try {
        await publishButtonCommit(saved);
      } catch (publishError) {
        warnings.push(`Buttons were saved, but live Button updates could not be published: ${errorMessage(publishError)}`);
      }
    }
    return { saved, applied, page: storedPage, warnings };
  };

  const acceptCommittedTheme = (
    saved: ButtonStateDocument,
    page: ThemePageAppearance | null
  ) => {
    dirtyPlacementIds.current.clear();
    editorDirty.current = false;
    setCanonicalDocument(saved);
    canonicalBaseline.current = saved;
    setDraftDocument(cloneButtonDocument(saved));
    if (page) {
      setPageAppearances((current) => ({ ...current, [page.pageId]: page }));
    }
  };

  const adoptHighlightColorResetIntents = (
    theme: FlowCellThemeFile,
    applied: ThemeApplyResult
  ) => {
    const resetPlacementIds = highlightColorResetPlacementIds.current;
    const resolved = resolveThemeHighlightColorResetPlacementIds(
      theme,
      applied.matchedPlacementIds
    );
    resetPlacementIds.hover.clear();
    resetPlacementIds.active.clear();
    resolved.hover.forEach((placementId) => resetPlacementIds.hover.add(placementId));
    resolved.active.forEach((placementId) => resetPlacementIds.active.add(placementId));
  };

  const handleApply = async () => {
    if (pending) return;
    setPending(true);
    try {
      const theme = await captureCompleteTheme();
      const committed = await commitCompleteTheme(theme);
      const acceptedGradient = theme.theme.gradient ?? DEFAULT_GRADIENT;
      writeThemeEditorScopeState(target, {
        gradient: acceptedGradient,
        buttonParticipation: {}
      });
      setGradient(acceptedGradient);
      setStatus(`Applied theme to ${theme.theme.buttons.length} Button occurrences.${warningSuffix(committed.warnings)}`);
    } catch (error) {
      setStatus(`Theme could not be applied: ${errorMessage(error)}`);
    } finally {
      setPending(false);
    }
  };

  const handleSaveTheme = async () => {
    if (pending || !draftDocument) return;
    setPending(true);
    try {
      const theme = await captureCompleteTheme();
      const path = await savePortableTheme(theme, activeTheme?.id && activeTheme.name === themeName ? activeTheme.path : undefined);
      if (path) {
        rememberTheme({ id: theme.id, path, name: theme.name });
        const warnings: string[] = [];
        await updateContributionSelection(theme, path).catch((error) => warnings.push(`Selected theme controls could not update: ${errorMessage(error)}`));
        setStatus(`Saved theme: ${path}${warningSuffix(warnings)}`);
      }
    } catch (error) {
      setStatus(`Theme could not be saved: ${errorMessage(error)}`);
    } finally {
      setPending(false);
    }
  };

  const handleLoadTheme = async () => {
    setLibraryMode("open");
  };

  const applyLoadedTheme = async (loaded: ReadThemeResult, importCopy: boolean) => {
    let path = loaded.path;
    let id = "";
    const warnings: string[] = [];
    let name = path.split(/[\\/]/).pop()?.replace(/\.(flowtheme|flowcell-theme-pack)\.json$/i, "") ?? "Theme";
    if (loaded.portable) {
      const theme = await materializeTheme(loaded.portable);
      id = theme.id; name = theme.name;
      if (importCopy) {
        const root = await invoke<string>("get_flowcell_theme_directory", { programName: target.kind === "program" ? target.programName : null });
        path = await savePortableTheme(theme, `${root}/${importedThemeFileName(theme)}`) ?? path;
      }
      warnings.push(...(await commitCompleteTheme(theme)).warnings);
      await updateContributionSelection(theme, path).catch((error) => warnings.push(`Selected theme controls could not update: ${errorMessage(error)}`));
    } else if (loaded.theme) {
      const scoped = { ...loaded.theme, target };
      if (importCopy) {
        const root = await invoke<string>("get_flowcell_theme_directory", { programName: target.kind === "program" ? target.programName : null });
        path = await invoke<string>("save_flowcell_theme_file", { path: `${root}/${name}.flowtheme.json`, theme: loaded.theme,
          programName: target.kind === "program" ? target.programName : null });
      }
      const committed = await commitTheme(scoped);
      adoptHighlightColorResetIntents(scoped, committed.applied);
      acceptCommittedTheme(committed.saved, committed.page);
      warnings.push(...committed.warnings);
      if (loaded.theme.gradient) setGradient(loaded.theme.gradient);
    } else {
      if (!contribution.current) throw new Error("This legacy theme requires the selected program's installed theme features.");
      const legacy = await contribution.current.loadLegacy(loaded.path, loaded.legacy);
      await contribution.current.validate(legacy.state);
      const previous = await contribution.current.capture();
      const latest = await loadButtonStateDocument();
      const next = applyLegacyProgramAppearance(latest, target, legacy.buttonSettings, legacy.buttonAppearance);
      const state = { ...previous.state, ...legacy.state,
        fields: { ...(previous.state.fields as object), ...(legacy.state.fields as object) } };
      const complete = capturePortableTheme({ document: next, target, name, id: await legacyThemeIdentity(loaded.legacy),
        descriptors: await getThemeToolDescriptors(target),
        contributions: { [previous.sourceId]: { ...previous, state } } });
      if (importCopy) {
        const root = await invoke<string>("get_flowcell_theme_directory", { programName: target.kind === "program" ? target.programName : null });
        path = await savePortableTheme(complete, `${root}/${importedThemeFileName(complete)}`) ?? path;
        id = complete.id;
      }
      warnings.push(...(await commitCompleteTheme(complete)).warnings);
      await updateContributionSelection(complete, path).catch((error) => warnings.push(`Selected theme controls could not update: ${errorMessage(error)}`));
    }
    rememberTheme({ id, path, name });
    setStatus(`Applied theme: ${path}${warningSuffix(warnings)}`);
  };

  const cycleTheme = async (direction: -1 | 1) => {
    if (pending) return;
    setPending(true);
    try {
      const entries = (await listThemeLibrary(target)).filter((entry) => !entry.supplied);
      if (!entries.length) { setStatus("No saved themes in this target's library."); return; }
      const index = entries.findIndex((entry) => entry.path === activeTheme?.path);
      const next = entries[(index + direction + entries.length) % entries.length];
      await applyLoadedTheme(await readTheme(next.path, target), false);
    } catch (error) {
      setStatus(`Theme could not be opened: ${errorMessage(error)}`);
    } finally {
      setPending(false);
    }
  };

  const handleExportTheme = async () => {
    if (pending) return;
    setPending(true);
    try {
      if (!activeTheme?.path) throw new Error("Save this theme before exporting it.");
      const saved = await readTheme(activeTheme.path, target);
      if (!saved.portable) throw new Error("Save this legacy theme with Save Theme before exporting a complete archive.");
      const path = await exportPortableTheme(saved.portable);
      if (path) setStatus(`Exported saved theme: ${path}`);
    } catch (error) { setStatus(`Theme could not be exported: ${errorMessage(error)}`); }
    finally { setPending(false); }
  };

  const handleMainThemePreset = (presetId: string) => {
    const preset = MAIN_THEME_PRESETS.find((entry) => entry.id === presetId);
    const presetAppearance = mainThemePresetAppearance(presetId);
    if (!preset || !presetAppearance) return;
    updatePageAppearance((appearance) => {
      appearance.tokens = presetAppearance.tokens;
      appearance.assets = presetAppearance.assets;
    });
    setStatus(`Loaded the ${preset.label} preset. Apply to use it, or Save Theme to keep it as a file. Buttons are unchanged.`);
  };

  const handleBrowsePageAsset = async (asset: ThemePageAssetDefinition) => {
    const path = (await showOpenFileDialog({
      title: `Choose ${selectedPageDefinition.label} ${asset.label}`,
      filter: "Images (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp",
      multiselect: false
    }))[0]?.trim();
    if (!path) return;
    updatePageAppearance((appearance) => {
      appearance.assets[asset.id] = { mode: "custom", path };
    });
  };

  const resetDraftFromCanonical = () => {
    if (canonicalDocument) setDraftDocument(cloneButtonDocument(canonicalDocument));
    setPageAppearances(readAllPageAppearances());
    const stored = readThemeEditorScopeState(target);
    setGradient(initialScopeGradient(stored?.gradient));
    dirtyPlacementIds.current.clear();
    skinAssignmentPlacementIds.current.clear();
    highlightColorResetPlacementIds.current.hover.clear();
    highlightColorResetPlacementIds.current.active.clear();
    editorDirty.current = false;
    setStatus("Discarded unsaved Theme Editor changes.");
  };

  const surfaceSummary = useMemo(() => {
    if (!draftDocument) return "";
    const counts = new Map<string, number>();
    scopedPlacements.forEach((placement) => {
      const kind = draftDocument.surfaces[placement.surfaceId]?.kind ?? "unknown";
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    });
    return [...counts.entries()].map(([kind, count]) => `${kind}: ${count}`).join(" · ");
  }, [draftDocument, scopedPlacements]);

  const effectAmountSummaries = useMemo(() => {
    return Object.fromEntries(ALL_EFFECT_AMOUNT_CONTROLS.map((control) => [
      control.field,
      scopedEffectAmountSummary(draftDocument, scopedPlacements, control.field)
    ])) as Record<ThemeEffectAmountField, { value: number; mixed: boolean }>;
  }, [draftDocument, scopedPlacements]);

  const selectedPlacement = scopedPlacements.find(
    (placement) => placement.id === selectedPlacementId
  ) ?? null;
  const selectedRawButton = selectedPlacement ? draftDocument?.buttons[selectedPlacement.buttonId] : null;
  const selectedButton = selectedRawButton && selectedPlacement
    ? resolveButtonPlacementPresentation(selectedRawButton, selectedPlacement) : null;
  const selectedSkin = selectedPlacement && draftDocument
    ? activePlacementSkin(draftDocument, selectedPlacement)
    : null;
  const selectedSkinIdentity = selectedPlacement && draftDocument
    ? themeSkinAssignmentIdentity(draftDocument, selectedPlacement)
    : null;

  return (
    <main className={`theme-editor${showingProgramPage ? " theme-editor--program-page" : ""}`}>
      {!showingProgramPage && <header className="theme-editor__header">
        <div>
          <h1>Theme Editor</h1>
          <p>Interface colors, Button appearance, and authored arrangements.</p>
        </div>
        <div className="theme-editor__header-actions">
          <button type="button" disabled={pending} onClick={() => void handleLoadTheme()}>Open Theme</button>
          <button type="button" disabled={pending || !draftDocument} onClick={() => void handleSaveTheme()}>Save Theme</button>
          <button type="button" disabled={pending} onClick={() => setLibraryMode("import")}>Import Theme</button>
          <button type="button" disabled={pending} onClick={() => void handleExportTheme()}>Export Theme</button>
          <button type="button" disabled={pending || !draftDocument} onClick={() => void handleApply()}>Apply</button>
          <button type="button" disabled={pending} onClick={resetDraftFromCanonical}>Discard</button>
          <button type="button" disabled={pending} onClick={() => void getCurrentWindow().close()}>Close</button>
        </div>
      </header>}

      <section className="theme-editor__card theme-editor__scope">
        <label>
          <span>Target</span>
          <select value={targetValue} onChange={(event) => setTargetValue(event.currentTarget.value)}>
            <option value={FLOWCELL_TARGET_VALUE}>Main</option>
            {programNames.map((programName) => (
              <option key={programName} value={programName}>{programName}</option>
            ))}
          </select>
        </label>
        {targetValue === FLOWCELL_TARGET_VALUE ? (
          <label>
            <span>Page</span>
            <select value={pageValue} onChange={(event) => {
              const value = event.currentTarget.value;
              if (isFlowCellThemePageId(value)) setPageValue(value);
            }}>
              {FLOWCELL_THEME_PAGE_REGISTRY.map((page) => (
                <option key={page.id} value={page.id}>{page.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        {!showingProgramPage && <p className="theme-editor__scope-summary">
          {scopedPlacements.length} Button occurrence{scopedPlacements.length === 1 ? "" : "s"} in scope
          {surfaceSummary ? ` · ${surfaceSummary}` : ""}
        </p>}
      </section>

      <div className="theme-editor__content">
      {!showingProgramPage && <div className="theme-editor__common">
      {target.kind === "flowcell" ? (
        <section className="theme-editor__card">
          <div className="theme-editor__section-heading">
            <div>
              <h2>{selectedPageDefinition.label} Page</h2>
              <p>Pick colors visually; opacity is shown as a percentage.</p>
            </div>
            {pageValue === "main" ? (
              <div className="theme-editor__section-actions">
                <label>
                  <span>Preset</span>
                  <select value="" disabled={pending} onChange={(event) => handleMainThemePreset(event.currentTarget.value)}>
                    <option value="">Choose a preset</option>
                    {MAIN_THEME_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
          <div className="theme-editor__token-groups">
            {selectedPageGroups.map((group) => (
              <div className="theme-editor__token-group" key={group.name}>
                <h3>{group.name}</h3>
                <div className="theme-editor__grid">
                  {group.tokens.map((token) => (
                    <label key={token.id}>
                      <span>{token.label}</span>
                      <ThemeColorControl
                        label={token.label}
                        value={selectedPageAppearance.tokens[token.id]}
                        onChange={(color) => updatePageAppearance((appearance) => {
                          appearance.tokens[token.id] = color;
                        })}
                      />
                    </label>
                  ))}
                  {group.assets.map((asset) => {
                    const current = selectedPageAppearance.assets[asset.id];
                    return (
                      <div className="theme-editor__asset-row" key={asset.id}>
                        <label>
                          <span>{asset.label}</span>
                          <select value={current.mode} onChange={(event) => {
                            const mode = event.currentTarget.value as ThemePageAssetValue["mode"];
                            updatePageAppearance((appearance) => {
                              appearance.assets[asset.id] = {
                                mode,
                                path: mode === "custom" ? current.path : null
                              };
                            });
                          }}>
                            <option value="default">Default</option>
                            <option value="concrete">Concrete</option>
                            <option value="none">None</option>
                            <option value="custom">Custom image</option>
                          </select>
                        </label>
                        <output>{current.path ?? "No custom image selected"}</output>
                        <button type="button" onClick={() => void handleBrowsePageAsset(asset)}>Browse</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {supportsButtons ? (
        <>
          <section className="theme-editor__card">
            <h2>Button arrangement</h2>
            <p>Coordinates and sizes are in CSS pixels. Edits keep the authored arrangement without reflow.</p>
            <label>Button occurrence <select value={selectedPlacementId} onChange={(event) => setSelectedPlacementId(event.currentTarget.value)}>
              {scopedPlacements.map((placement) => <option key={placement.id} value={placement.id}>
                {draftDocument ? resolveButtonPlacementPresentation(draftDocument.buttons[placement.buttonId], placement).label : placement.id} · {draftDocument?.surfaces[placement.surfaceId]?.name}
              </option>)}
            </select></label>
            {selectedPlacement && selectedButton && <div className="theme-editor__grid">
              <label>Label <input value={selectedButton.label} onChange={(event) => {
                const label = event.currentTarget.value;
                updateDraft((document) => { document.placements[selectedPlacement.id].presentationOverride = {
                  ...document.placements[selectedPlacement.id].presentationOverride, label }; }, [selectedPlacement.id]);
              }} /></label>
              {(["x", "y", "width", "height", "zIndex"] as const).map((field) => <label key={field}>
                {field === "zIndex" ? "Stack order" : `${field} (px)`}
                <input type="number" value={selectedPlacement[field]} step={field === "zIndex" ? 1 : .1}
                  min={field === "width" || field === "height" ? .1 : undefined} onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (!Number.isFinite(value) || ((field === "width" || field === "height") && value <= 0)) return;
                    updateDraft((document) => { document.placements[selectedPlacement.id][field] = field === "zIndex" ? Math.round(value) : value; }, [selectedPlacement.id]);
                  }} />
              </label>)}
              <button onClick={() => void openButtonEditorWindow({ buttonId: selectedButton.id, surfaceId: selectedPlacement.surfaceId })}>Open Button Editor</button>
            </div>}
          </section>
          <section className="theme-editor__card">
            <div className="theme-editor__section-heading">
              <div>
                <h2>Button Appearance</h2>
                <p>One gradient/scatter rule is applied to every Button in the selected scope.</p>
              </div>
              <div className="theme-editor__section-actions">
                <button type="button" disabled={!draftDocument || scopedPlacements.length === 0} onClick={() => applyGradient()}>
                  Apply Gradient
                </button>
                <button
                  type="button"
                  disabled={!draftDocument || scopedPlacements.length === 0}
                  onClick={() => applyGradient({
                    ...gradient,
                    bottomColor: gradient.topColor,
                    spread: 0,
                    scatter: 0
                  })}
                >
                  Apply One Color
                </button>
              </div>
            </div>
            <div className="theme-editor__gradient-grid">
              <label>
                <span>Channel</span>
                <select value={gradient.role} onChange={(event) => {
                  const role = event.currentTarget.value;
                  updateGradient((current) => ({ ...current, role }));
                }}>
                  {THEME_EDITOR_GRADIENT_ROLES.map((role) => (
                    <option key={role} value={role}>{gradientRoleLabel(role)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Top</span>
                <ThemeColorControl
                  label="Gradient top"
                  value={gradient.topColor}
                  onChange={(topColor) => updateGradient((current) => ({ ...current, topColor }))}
                />
              </label>
              <label>
                <span>Bottom</span>
                <ThemeColorControl
                  label="Gradient bottom"
                  value={gradient.bottomColor}
                  onChange={(bottomColor) => updateGradient((current) => ({ ...current, bottomColor }))}
                />
              </label>
              <label>
                <span>Spread {gradient.spread}%</span>
                <input type="range" min="0" max="100" value={gradient.spread} onChange={(event) => {
                  const spread = Number(event.currentTarget.value);
                  updateGradient((current) => ({ ...current, spread }));
                }} />
              </label>
              <label>
                <span>Scatter {gradient.scatter}%</span>
                <input type="range" min="0" max="100" value={gradient.scatter} onChange={(event) => {
                  const scatter = Number(event.currentTarget.value);
                  updateGradient((current) => ({ ...current, scatter }));
                }} />
              </label>
              <button
                type="button"
                onClick={() => applyGradient({ ...gradient, seed: gradient.seed + 1 })}
                disabled={!draftDocument || scopedPlacements.length === 0}
              >
                Reshuffle
              </button>
            </div>
          </section>

          <section className="theme-editor__card">
            <div className="theme-editor__section-heading">
              <div>
                <h2>Highlight</h2>
                <p>Set the brightness lift independently for hover and active Buttons.</p>
              </div>
            </div>
            <div className="theme-editor__effect-amount-grid">
              {HIGHLIGHT_AMOUNT_CONTROLS.map((control) => {
                const summary = effectAmountSummaries[control.field];
                return (
                  <div className="theme-editor__effect-amount" key={control.field}>
                    <label>
                      <span>{control.label}</span>
                      <input
                        type="range"
                        aria-label={control.ariaLabel}
                        min={BUTTON_HIGHLIGHT_AMOUNT_MIN}
                        max={control.max}
                        step="1"
                        value={summary.value}
                        disabled={!draftDocument || scopedPlacements.length === 0}
                        onChange={(event) => {
                          const value = Number(event.currentTarget.value);
                          applyEffectAmount(control.field, control.ariaLabel, value);
                        }}
                      />
                    </label>
                    <output>{summary.mixed ? "Mixed" : `${summary.value}%`}</output>
                  </div>
                );
              })}
            </div>
            <p className="theme-editor__scope-note">
              Defaults are {DEFAULT_BUTTON_HIGHLIGHT_AMOUNT}%. The range reaches {BUTTON_HIGHLIGHT_AMOUNT_MAX}% so the lift can be deliberately extreme. These controls do not turn highlighting on or off or edit saved skins.
            </p>
          </section>

          <section className="theme-editor__card">
            <div className="theme-editor__section-heading">
              <div>
                <h2>Glow</h2>
                <p>Set the outer glow independently for hover and active Buttons.</p>
              </div>
            </div>
            <div className="theme-editor__effect-amount-grid">
              {GLOW_AMOUNT_CONTROLS.map((control) => {
                const summary = effectAmountSummaries[control.field];
                return (
                  <div className="theme-editor__effect-amount" key={control.field}>
                    <label>
                      <span>{control.label}</span>
                      <input
                        type="range"
                        aria-label={control.ariaLabel}
                        min={BUTTON_HIGHLIGHT_AMOUNT_MIN}
                        max={control.max}
                        step="1"
                        value={summary.value}
                        disabled={!draftDocument || scopedPlacements.length === 0}
                        onChange={(event) => {
                          const value = Number(event.currentTarget.value);
                          applyEffectAmount(control.field, control.ariaLabel, value);
                        }}
                      />
                    </label>
                    <output>{summary.mixed ? "Mixed" : `${summary.value}%`}</output>
                  </div>
                );
              })}
            </div>
            <p className="theme-editor__scope-note">
              Defaults are {DEFAULT_BUTTON_HIGHLIGHT_AMOUNT}% with a {BUTTON_GLOW_AMOUNT_MAX}% maximum. Glow is visual only and never expands the Button hit area.
            </p>
          </section>

          <section className="theme-editor__card">
            <div className="theme-editor__section-heading">
              <div>
                <h2>Assign a Saved Skin</h2>
                <p>This only changes which saved skin the Button uses. It never edits the saved skin file.</p>
              </div>
            </div>
            <div className="theme-editor__assignment-grid">
              <label>
                <span>Button occurrence</span>
                <select value={selectedPlacementId} onChange={(event) => setSelectedPlacementId(event.currentTarget.value)}>
                  {scopedPlacements.map((placement) => {
                    const button = draftDocument?.buttons[placement.buttonId];
                    const surface = draftDocument?.surfaces[placement.surfaceId];
                    return (
                      <option key={placement.id} value={placement.id}>
                        {button?.label ?? placement.id} · {surface?.name ?? placement.surfaceId}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label>
                <span>Saved skin</span>
                <select
                  value={selectedSavedSkinPath}
                  disabled={savedSkins.length === 0}
                  onChange={(event) => setSelectedSavedSkinPath(event.currentTarget.value)}
                >
                  {savedSkins.length === 0 ? <option value="">No saved skin files</option> : null}
                  {savedSkins.map((choice) => (
                    <option key={choice.path} value={choice.path}>{choice.skin.name}</option>
                  ))}
                </select>
              </label>
              <div className="theme-editor__assignment-current">
                <span>Current skin</span>
                <strong>{selectedSkinIdentity?.label ?? selectedSkin?.name ?? "No assigned skin"}</strong>
                <small>{selectedButton?.label ?? "Select a Button occurrence"}</small>
              </div>
              <button
                type="button"
                disabled={!selectedPlacement || !selectedSavedSkinPath}
                onClick={handleAssignSkin}
              >
                Assign Skin
              </button>
            </div>
            <label className="theme-editor__toggle theme-editor__assignment-scope">
              <input
                type="checkbox"
                checked={assignEveryButtonInScope}
                onChange={(event) => setAssignEveryButtonInScope(event.currentTarget.checked)}
              />
              <span>
                Apply this saved skin to all {scopedPlacements.length} Buttons in the current scope.
              </span>
            </label>
            <p className="theme-editor__note">
              Checkbox off: only the selected Button occurrence uses the saved skin. Checkbox on: every Button in this scope uses it, even if those Buttons currently use different skins. Buttons outside this scope do not change, and no saved skin file is edited.
            </p>
            <p className="theme-editor__note">
              Assignment starts with the saved skin's authored colors. Use Button Appearance after assigning only when you want to recolor it.
            </p>
          </section>
        </>
      ) : null}

      </div>}
      {target.kind === "program" && <ThemeContribution key={target.programName} programName={target.programName}
        active={contributionAvailable !== false && libraryMode === null}
        onAvailable={setContributionAvailable}
        onReady={(controller) => { contribution.current = controller; }}
        onLibraryAction={(action) => {
          if (action === "save") void handleSaveTheme();
          else if (action === "open") setLibraryMode("open");
          else void cycleTheme(action === "previous" ? -1 : 1);
        }} />}
      {target.kind === "program" && contributionAvailable === false &&
        <PoppedButtonColorsPage key={`popped-colors-${target.programName}`} programName={target.programName}
          active={libraryMode === null} onReady={(controller) => { poppedColors.current = controller; }} />}
      </div>
      <footer className="theme-editor__status" role="status">{status}</footer>
      {libraryMode && <ThemeLibraryDialog target={target} mode={libraryMode} onClose={() => setLibraryMode(null)}
        onReview={(loaded) => reviewThemeContribution(contribution.current, loaded)}
        onApply={(loaded) => applyLoadedTheme(loaded, libraryMode === "import")} />}
    </main>
  );
}
