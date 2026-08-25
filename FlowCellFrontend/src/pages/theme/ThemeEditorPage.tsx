import { useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { makeSafeTauriUnlisten } from "../../lib/safeTauriUnlisten.js";
import {
  THEME_EDITOR_CONTEXT_EVENT,
  type ThemeEditorWindowContext
} from "../../lib/windowContext.js";
import { listPanelFolders, listProgramFolders } from "../../lib/programRails.js";
import { showOpenFileDialog } from "../../lib/tauri.js";
import { openButtonEditorWindow } from "../../button/windows/buttonWindows.js";
import {
  loadButtonStateDocument,
  saveButtonStateDocument
} from "../../button/state/ButtonStateRepository.js";
import { loadMainPageButtonBootstrap } from "../../button/state/mainPageButtonBootstrap.js";
import {
  publishButtonCommit,
  subscribeButtonCommits
} from "../../button/state/ButtonDraftBus.js";
import { cloneButtonDocument } from "../../button/state/buttonDefaults.js";
import {
  readButtonSkinHighlightOnActive,
  readButtonSkinHighlightOnHover,
  setButtonSkinHighlightOnActive,
  setButtonSkinHighlightOnHover
} from "../../button/skins/buttonSkinColors.js";
import type {
  ButtonPlacement,
  ButtonSkin,
  ButtonStateDocument
} from "../../button/types.js";
import {
  applyThemeFile,
  bakeThemeGradientForDeployedLayout,
  captureThemeFile,
  extractSkinColorRoots,
  listThemePlacements,
  setSkinColorRoot,
  type FlowCellThemeFile,
  type ThemeApplyResult,
  type ThemeGradientDefinition,
  type ThemeTarget
} from "../../theme/themeModel.js";
import {
  FLOWCELL_THEME_PAGE_REGISTRY,
  defaultThemePageAppearance,
  getFlowCellThemePageDefinition,
  isFlowCellThemePageId,
  type FlowCellThemePageId,
  type ThemePageAppearance,
  type ThemePageAssetDefinition,
  type ThemePageTokenDefinition
} from "../../theme/themePageRegistry.js";
import {
  authorizeThemePageAssets,
  readActiveThemePageAppearance,
  writeAuthorizedThemePageAppearance
} from "../../theme/themeRuntime.js";
import {
  readThemeEditorScopeState,
  writeThemeEditorScopeState,
  type ThemeEditorButtonParticipation
} from "../../theme/themeEditorState.js";
import {
  loadFlowCellThemeFile,
  saveFlowCellThemeFile
} from "../../theme/themeFile.js";
import "./themeEditorPage.css";

const FLOWCELL_TARGET_VALUE = "__flowcell__";
const ALL_PANELS_VALUE = "__all_panels__";
const THEME_DRAFT_SKIN_PREFIX = "flowcell-theme-draft-skin:";

type ButtonParticipation = ThemeEditorButtonParticipation;

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

const DEFAULT_GRADIENT: ThemeGradientDefinition = {
  role: "surface",
  topColor: "#8dcf9b",
  bottomColor: "#254936",
  spread: 100,
  scatter: 20,
  seed: 1
};

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

function draftSkinId(placementId: string): string {
  return `${THEME_DRAFT_SKIN_PREFIX}${encodeURIComponent(placementId)}`;
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

function ensurePlacementPrivateSkin(
  document: ButtonStateDocument,
  placementId: string
): ButtonSkin | null {
  const placement = document.placements[placementId];
  if (!placement) return null;
  const id = draftSkinId(placementId);
  if (placement.skinOverrideId === id && document.skins[id]) return document.skins[id];
  const source = activePlacementSkin(document, placement);
  if (!source) return null;
  const skin = structuredClone(source);
  skin.id = id;
  skin.name = `${source.name} - ${document.buttons[placement.buttonId]?.label ?? "Theme"}`;
  skin.compileCache = null;
  document.skins[id] = skin;
  placement.skinOverrideId = id;
  return skin;
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
  if (!requestedTarget || normalizeName(requestedTarget) === "flowcell") {
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
  return {
    kind: "program",
    programName: targetValue,
    panelName: panelValue === ALL_PANELS_VALUE ? null : panelValue
  };
}

function themeSuggestedName(target: ThemeTarget): string {
  if (target.kind === "flowcell") {
    return `FlowCell ${getFlowCellThemePageDefinition(target.page).label} Theme`;
  }
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

function isPickerColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

function formatApplyStatus(prefix: string, result: ThemeApplyResult): string {
  const messages = [`${prefix} ${result.appliedButtonCount} Button${result.appliedButtonCount === 1 ? "" : "s"}.`];
  if (result.missingButtonCount > 0) {
    messages.push(`${result.missingButtonCount} saved Button${result.missingButtonCount === 1 ? " was" : "s were"} not found.`);
  }
  if (result.skippedButtonCount > 0) {
    messages.push(`${result.skippedButtonCount} Button${result.skippedButtonCount === 1 ? " was" : "s were"} skipped.`);
  }
  result.issues.forEach((issue) => messages.push(`${issue.surfaceName}: ${issue.message}`));
  return messages.join(" ");
}

function mergeCanonicalIntoDraft(
  current: ButtonStateDocument | null,
  incoming: ButtonStateDocument,
  dirtyPlacementIds: ReadonlySet<string>
): ButtonStateDocument {
  if (!current || dirtyPlacementIds.size === 0) return cloneButtonDocument(incoming);
  const merged = cloneButtonDocument(incoming);
  for (const placementId of dirtyPlacementIds) {
    const draftPlacement = current.placements[placementId];
    const incomingPlacement = merged.placements[placementId];
    if (!draftPlacement || !incomingPlacement) continue;
    Object.assign(incomingPlacement, {
      width: draftPlacement.width,
      height: draftPlacement.height,
      skinOverrideId: draftPlacement.skinOverrideId,
      textFitMode: draftPlacement.textFitMode,
      textAlignment: draftPlacement.textAlignment,
      textOffsetX: draftPlacement.textOffsetX,
      textOffsetY: draftPlacement.textOffsetY,
      minimumFontSize: draftPlacement.minimumFontSize,
      textSizeOverride: draftPlacement.textSizeOverride,
      allowLabelResize: draftPlacement.allowLabelResize,
      matchHitboxToSkin: draftPlacement.matchHitboxToSkin,
      allowStretching: draftPlacement.allowStretching,
      highlightOnHover: draftPlacement.highlightOnHover
    });
    const skinId = draftPlacement.skinOverrideId;
    if (skinId?.startsWith(THEME_DRAFT_SKIN_PREFIX) && current.skins[skinId]) {
      merged.skins[skinId] = structuredClone(current.skins[skinId]);
    }
  }
  return merged;
}

function participationFromTheme(
  theme: FlowCellThemeFile,
  matchedPlacementIds: Readonly<Record<string, string>> = Object.fromEntries(
    theme.buttons.map((button) => [button.placementId, button.placementId])
  )
): Record<string, ButtonParticipation> {
  return Object.fromEntries(theme.buttons.flatMap((button) => {
    const placementId = matchedPlacementIds[button.placementId];
    return placementId ? [[
      placementId,
      {
        gradientEnabled: button.gradientEnabled,
        scatterEnabled: button.scatterEnabled
      }
    ]] : [];
  }));
}

export default function ThemeEditorPage({
  context
}: {
  context: ThemeEditorWindowContext;
}) {
  const initialTarget = context.target?.trim() || FLOWCELL_TARGET_VALUE;
  const [programNames, setProgramNames] = useState<string[]>([]);
  const [panelNames, setPanelNames] = useState<string[]>([]);
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
  const [draftDocument, setDraftDocument] = useState<ButtonStateDocument | null>(null);
  const [pageAppearances, setPageAppearances] = useState(readAllPageAppearances);
  const [buttonParticipation, setButtonParticipation] = useState<Record<string, ButtonParticipation>>({});
  const [gradient, setGradient] = useState<ThemeGradientDefinition>(DEFAULT_GRADIENT);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("Loading Theme Editor...");
  const dirtyPlacementIds = useRef(new Set<string>());
  const editorDirty = useRef(false);

  const target = useMemo(
    () => targetFromSelection(targetValue, pageValue, panelValue),
    [pageValue, panelValue, targetValue]
  );
  const selectedPageDefinition = getFlowCellThemePageDefinition(pageValue);
  const selectedPageAppearance = pageAppearances[pageValue] ?? defaultThemePageAppearance(pageValue);
  const selectedPageGroups = useMemo(() => pageControlGroups(pageValue), [pageValue]);
  const supportsButtons = target.kind === "program" ||
    selectedPageDefinition.buttonSurfaceKinds.length > 0 ||
    selectedPageDefinition.buttonSurfaceIds.length > 0 ||
    selectedPageDefinition.buttonSurfaceIdPrefixes.length > 0;

  useEffect(() => {
    let cancelled = false;
    void loadMainPageButtonBootstrap({ removeStaleOwners: false })
      .then(({ document, registeredPanels }) => {
        if (cancelled) return;
        const programs = registeredPanels.map((entry) => entry.programName);
        const resolved = resolvedEditorContext(context, programs);
        setProgramNames(programs);
        setTargetValue(resolved.targetValue);
        setPageValue(resolved.pageValue);
        setPanelValue(resolved.panelValue);
        setCanonicalDocument(document);
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
    // The URL context is resolved once; later requests arrive on the window event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          setDraftDocument((current) => mergeCanonicalIntoDraft(
            current,
            document,
            dirtyPlacementIds.current
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
      setDraftDocument((current) => mergeCanonicalIntoDraft(
        current,
        document,
        dirtyPlacementIds.current
      ));
      if (editorDirty.current) {
        setStatus("Canonical Buttons updated; unsaved Theme Editor appearance changes were preserved.");
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
      setPanelNames([]);
      setPanelValue(ALL_PANELS_VALUE);
      return;
    }
    let cancelled = false;
    void listPanelFolders(targetValue)
      .then((panels) => {
        if (cancelled) return;
        setPanelNames(panels);
        setPanelValue((current) =>
          current === ALL_PANELS_VALUE || panels.includes(current)
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
    setGradient(stored?.gradient ?? DEFAULT_GRADIENT);
    setButtonParticipation(stored?.buttonParticipation ?? {});
  }, [target]);

  const scopedPlacements = useMemo(
    () => draftDocument ? listThemePlacements(draftDocument, target) : [],
    [draftDocument, target]
  );

  const gradientRoles = useMemo(() => {
    if (!draftDocument) return [];
    const roles = new Set<string>();
    scopedPlacements.forEach((placement) => {
      const skin = activePlacementSkin(draftDocument, placement);
      if (skin) extractSkinColorRoots(skin).forEach((root) => roles.add(root.role));
    });
    return [...roles].sort();
  }, [draftDocument, scopedPlacements]);

  useEffect(() => {
    if (gradientRoles.length > 0 && !gradientRoles.includes(gradient.role)) {
      setGradient((current) => ({ ...current, role: gradientRoles[0] }));
    }
  }, [gradient.role, gradientRoles]);

  const markEditorDirty = () => {
    editorDirty.current = true;
  };

  const updateDraft = (
    mutate: (document: ButtonStateDocument) => void,
    placementIds: readonly string[] = []
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

  const updatePlacementColor = (placementId: string, role: string, color: string) => {
    updateDraft((document) => {
      const skin = ensurePlacementPrivateSkin(document, placementId);
      if (!skin) return;
      document.skins[skin.id] = setSkinColorRoot(skin, role, color);
    }, [placementId]);
  };

  const updatePlacementHighlight = (
    placementId: string,
    kind: "hover" | "active",
    enabled: boolean
  ) => {
    updateDraft((document) => {
      const skin = ensurePlacementPrivateSkin(document, placementId);
      if (!skin) return;
      const sections = kind === "hover"
        ? setButtonSkinHighlightOnHover(skin, enabled)
        : setButtonSkinHighlightOnActive(skin, enabled);
      document.skins[skin.id] = { ...skin, ...sections, compileCache: null };
    }, [placementId]);
  };

  const updateButtonParticipation = (
    placementId: string,
    patch: Partial<ButtonParticipation>
  ) => {
    markEditorDirty();
    setButtonParticipation((current) => ({
      ...current,
      [placementId]: {
        gradientEnabled: current[placementId]?.gradientEnabled ?? true,
        scatterEnabled: current[placementId]?.scatterEnabled ?? true,
        ...patch
      }
    }));
  };

  const applyGradient = (nextGradient = gradient) => {
    if (!draftDocument || !canonicalDocument || !nextGradient.role) return;
    try {
      const previewTheme = captureThemeFile({
        document: draftDocument,
        target,
        page: target.kind === "flowcell" ? selectedPageAppearance : null,
        gradient: nextGradient,
        buttonParticipation
      });
      const baked = bakeThemeGradientForDeployedLayout(canonicalDocument, previewTheme);
      const placementIds = Object.keys(baked.colorsBySavedPlacementId);
      if (placementIds.length === 0) {
        setStatus(`No deployable participating Buttons in this scope expose '${nextGradient.role}'.`);
        return;
      }
      updateDraft((document) => {
        placementIds.forEach((placementId) => {
          const skin = ensurePlacementPrivateSkin(document, placementId);
          const color = baked.colorsBySavedPlacementId[placementId];
          if (!skin || !color) return;
          document.skins[skin.id] = setSkinColorRoot(skin, nextGradient.role, color);
        });
      }, placementIds);
      setGradient(nextGradient);
      const skipped = baked.layout.skippedButtonCount > 0
        ? ` ${baked.layout.skippedButtonCount} Buttons were skipped because their final layout was invalid.`
        : "";
      setStatus(`Applied ${nextGradient.role} gradient to ${placementIds.length} Buttons using final deployed positions.${skipped}`);
    } catch (error) {
      setStatus(`Gradient could not be applied: ${errorMessage(error)}`);
    }
  };

  const captureCurrentTheme = (): FlowCellThemeFile => {
    if (!draftDocument) throw new Error("Canonical Button state is not loaded yet.");
    return captureThemeFile({
      document: draftDocument,
      target,
      page: target.kind === "flowcell" ? selectedPageAppearance : null,
      gradient,
      buttonParticipation
    });
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
    if (applied.appliedButtonCount > 0) {
      const expectedSaved = cloneButtonDocument(applied.document);
      expectedSaved.revision = latest.revision + 1;
      try {
        saved = await saveButtonStateDocument(applied.document, latest.revision);
      } catch (saveError) {
        const recovered = await loadButtonStateDocument().catch(() => null);
        if (!recovered || stableJson(recovered) !== stableJson(expectedSaved)) throw saveError;
        saved = recovered;
        warnings.push(`Buttons were saved, but native cleanup reported: ${errorMessage(saveError)}`);
      }
      try {
        await publishButtonCommit(saved);
      } catch (publishError) {
        warnings.push(`Buttons were saved, but live Button updates could not be published: ${errorMessage(publishError)}`);
      }
    }
    let storedPage: ThemePageAppearance | null = null;
    if (authorizedPage) {
      try {
        storedPage = await writeAuthorizedThemePageAppearance(authorizedPage);
      } catch (pageError) {
        warnings.push(`Buttons were accepted, but page appearance could not be stored: ${errorMessage(pageError)}`);
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
    setDraftDocument(cloneButtonDocument(saved));
    if (page) {
      setPageAppearances((current) => ({ ...current, [page.pageId]: page }));
    }
  };

  const handleApply = async () => {
    if (pending) return;
    setPending(true);
    try {
      const theme = captureCurrentTheme();
      const committed = await commitTheme(theme);
      const acceptedGradient = theme.gradient ?? DEFAULT_GRADIENT;
      const acceptedParticipation = participationFromTheme(
        theme,
        committed.applied.matchedPlacementIds
      );
      writeThemeEditorScopeState(theme.target, {
        gradient: acceptedGradient,
        buttonParticipation: acceptedParticipation
      });
      setGradient(acceptedGradient);
      setButtonParticipation(acceptedParticipation);
      acceptCommittedTheme(committed.saved, committed.page);
      setStatus(
        `${formatApplyStatus("Applied theme to", committed.applied)}${warningSuffix(committed.warnings)}`
      );
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
      const capturedTheme = captureCurrentTheme();
      const theme = capturedTheme.page
        ? {
            ...capturedTheme,
            page: await authorizeThemePageAssets(capturedTheme.page)
          }
        : capturedTheme;
      const path = await saveFlowCellThemeFile(theme, themeSuggestedName(target));
      if (path) setStatus(`Saved theme: ${path}`);
    } catch (error) {
      setStatus(`Theme could not be saved: ${errorMessage(error)}`);
    } finally {
      setPending(false);
    }
  };

  const handleLoadTheme = async () => {
    if (pending) return;
    setPending(true);
    try {
      const loaded = await loadFlowCellThemeFile();
      if (!loaded) return;
      const committed = await commitTheme(loaded.theme);
      const programs = await listProgramFolders();
      setProgramNames(programs);
      if (loaded.theme.target.kind === "flowcell") {
        setTargetValue(FLOWCELL_TARGET_VALUE);
        setPageValue(loaded.theme.target.page);
        setPanelValue(ALL_PANELS_VALUE);
      } else {
        const targetProgramName = loaded.theme.target.programName;
        const installedTarget = programs.find(
          (programName) => normalizeName(programName) === normalizeName(targetProgramName)
        );
        if (installedTarget) {
          setTargetValue(installedTarget);
          setPanelValue(loaded.theme.target.panelName ?? ALL_PANELS_VALUE);
        }
      }
      const loadedGradient = loaded.theme.gradient ?? DEFAULT_GRADIENT;
      const loadedParticipation = participationFromTheme(
        loaded.theme,
        committed.applied.matchedPlacementIds
      );
      writeThemeEditorScopeState(loaded.theme.target, {
        gradient: loadedGradient,
        buttonParticipation: loadedParticipation
      });
      setGradient(loadedGradient);
      setButtonParticipation(loadedParticipation);
      acceptCommittedTheme(committed.saved, committed.page);
      setStatus(
        `${loaded.path}: ${formatApplyStatus("applied", committed.applied)}${warningSuffix(committed.warnings)}`
      );
    } catch (error) {
      setStatus(`Theme could not be loaded: ${errorMessage(error)}`);
    } finally {
      setPending(false);
    }
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
    setButtonParticipation(stored?.buttonParticipation ?? {});
    setGradient(stored?.gradient ?? DEFAULT_GRADIENT);
    dirtyPlacementIds.current.clear();
    editorDirty.current = false;
    setStatus("Discarded unsaved Theme Editor changes.");
  };

  return (
    <main className="theme-editor">
      <header className="theme-editor__header">
        <div>
          <h1>Theme Editor</h1>
          <p>Appearance only. Button actions, scripts, bindings, and managed windows stay unchanged.</p>
        </div>
        <div className="theme-editor__header-actions">
          <button type="button" onClick={handleLoadTheme} disabled={pending}>Open Theme</button>
          <button type="button" onClick={handleSaveTheme} disabled={pending || !draftDocument}>Save Theme</button>
          <button type="button" onClick={handleApply} disabled={pending || !draftDocument}>Apply</button>
          <button type="button" onClick={resetDraftFromCanonical} disabled={pending || !draftDocument}>Discard</button>
          <button type="button" onClick={() => void getCurrentWindow().close()}>Close</button>
        </div>
      </header>

      <section className="theme-editor__scope theme-editor__card">
        <label>
          <span>Target</span>
          <select
            value={targetValue}
            onChange={(event) => {
              setTargetValue(event.target.value);
              setPanelValue(ALL_PANELS_VALUE);
            }}
          >
            <option value={FLOWCELL_TARGET_VALUE}>FlowCell</option>
            {programNames.map((programName) => (
              <option key={programName} value={programName}>{programName}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{targetValue === FLOWCELL_TARGET_VALUE ? "Page" : "Area"}</span>
          {targetValue === FLOWCELL_TARGET_VALUE ? (
            <select
              value={pageValue}
              onChange={(event) => {
                if (isFlowCellThemePageId(event.target.value)) setPageValue(event.target.value);
              }}
            >
              {FLOWCELL_THEME_PAGE_REGISTRY.map((page) => (
                <option key={page.id} value={page.id}>{page.label}</option>
              ))}
            </select>
          ) : (
            <select value={panelValue} onChange={(event) => setPanelValue(event.target.value)}>
              <option value={ALL_PANELS_VALUE}>All Panels</option>
              {panelNames.map((panelName) => (
                <option key={panelName} value={panelName}>{panelName}</option>
              ))}
            </select>
          )}
        </label>
      </section>

      {target.kind === "flowcell" ? (
        <section className="theme-editor__card">
          <div className="theme-editor__section-heading">
            <div>
              <h2>{selectedPageDefinition.label} Page</h2>
              <p>Registered page tokens stay separate from Layout files and managed-window state.</p>
            </div>
          </div>
          <div className="theme-editor__token-groups">
            {selectedPageGroups.map((group) => (
              <section className="theme-editor__token-group" key={group.name}>
                <h3>{group.name}</h3>
                <div className="theme-editor__grid">
                  {group.tokens.map((token) => {
                    const value = selectedPageAppearance.tokens[token.id] ?? token.defaultValue;
                    return (
                      <label key={token.id}>
                        <span>{token.label}</span>
                        <div className="theme-editor__color-control">
                          {isPickerColor(value) ? (
                            <input
                              type="color"
                              value={value}
                              onChange={(event) => updatePageAppearance((appearance) => {
                                appearance.tokens[token.id] = event.target.value;
                              })}
                            />
                          ) : null}
                          <input
                            type="text"
                            value={value}
                            onChange={(event) => updatePageAppearance((appearance) => {
                              appearance.tokens[token.id] = event.target.value;
                            })}
                          />
                        </div>
                      </label>
                    );
                  })}
                  {group.assets.map((asset) => {
                    const value = selectedPageAppearance.assets[asset.id] ?? { mode: "default", path: null };
                    return (
                      <div className="theme-editor__asset-row" key={asset.id}>
                        <label>
                          <span>{asset.label}</span>
                          <select
                            value={value.mode}
                            onChange={(event) => updatePageAppearance((appearance) => {
                              const mode = event.target.value as "default" | "none" | "custom";
                              appearance.assets[asset.id] = {
                                mode,
                                path: mode === "custom" ? value.path ?? "" : null
                              };
                            })}
                          >
                            <option value="default">Default</option>
                            <option value="none">None</option>
                            <option value="custom">Custom</option>
                          </select>
                        </label>
                        {value.mode === "custom" ? (
                          <>
                            <label>
                              <span>Image path</span>
                              <input
                                type="text"
                                value={value.path ?? ""}
                                onChange={(event) => updatePageAppearance((appearance) => {
                                  appearance.assets[asset.id] = {
                                    mode: "custom",
                                    path: event.target.value
                                  };
                                })}
                              />
                            </label>
                            <button type="button" onClick={() => void handleBrowsePageAsset(asset)}>Browse</button>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

      {supportsButtons ? (
        <>
          <section className="theme-editor__card">
            <div className="theme-editor__section-heading">
              <div>
                <h2>Button Gradient</h2>
                <p>Position follows top-to-bottom deployment. Scatter is deterministic until Reshuffle.</p>
              </div>
              <button
                type="button"
                disabled={!draftDocument || gradientRoles.length === 0}
                onClick={() => applyGradient()}
              >
                Apply Gradient
              </button>
            </div>
            <div className="theme-editor__gradient-grid">
              <label>
                <span>Semantic role</span>
                <select
                  value={gradient.role}
                  onChange={(event) => updateGradient((current) => ({ ...current, role: event.target.value }))}
                >
                  {gradientRoles.length === 0 ? <option value="">No editable roles</option> : null}
                  {gradientRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>
              <label>
                <span>Top</span>
                <input type="color" value={gradient.topColor} onChange={(event) => updateGradient((current) => ({ ...current, topColor: event.target.value }))} />
              </label>
              <label>
                <span>Bottom</span>
                <input type="color" value={gradient.bottomColor} onChange={(event) => updateGradient((current) => ({ ...current, bottomColor: event.target.value }))} />
              </label>
              <label>
                <span>Spread {gradient.spread}%</span>
                <input type="range" min="0" max="100" value={gradient.spread} onChange={(event) => updateGradient((current) => ({ ...current, spread: Number(event.target.value) }))} />
              </label>
              <label>
                <span>Scatter {gradient.scatter}%</span>
                <input type="range" min="0" max="100" value={gradient.scatter} onChange={(event) => updateGradient((current) => ({ ...current, scatter: Number(event.target.value) }))} />
              </label>
              <button
                type="button"
                onClick={() => {
                  const next = { ...gradient, seed: gradient.seed + 1 };
                  applyGradient(next);
                }}
                disabled={!draftDocument || gradientRoles.length === 0}
              >
                Reshuffle
              </button>
            </div>
          </section>

          <section className="theme-editor__card theme-editor__buttons-card">
            <div className="theme-editor__section-heading">
              <div>
                <h2>Buttons</h2>
                <p>{scopedPlacements.length} placement{scopedPlacements.length === 1 ? "" : "s"} in this scope.</p>
              </div>
            </div>
            <div className="theme-editor__button-list">
              {draftDocument && scopedPlacements.map((placement) => {
                const button = draftDocument.buttons[placement.buttonId];
                const surface = draftDocument.surfaces[placement.surfaceId];
                const skin = activePlacementSkin(draftDocument, placement);
                const colorRoots = skin ? extractSkinColorRoots(skin) : [];
                const identity = button?.sourceIdentity;
                const participation = buttonParticipation[placement.id] ?? {
                  gradientEnabled: true,
                  scatterEnabled: true
                };
                const skinHighlightOnHover = skin
                  ? readButtonSkinHighlightOnHover(skin) ?? placement.highlightOnHover
                  : placement.highlightOnHover;
                const skinHighlightOnActive = skin
                  ? readButtonSkinHighlightOnActive(skin) ?? false
                  : false;
                const candidateSkins = Object.values(draftDocument.skins)
                  .filter((candidate) =>
                    !candidate.id.startsWith(THEME_DRAFT_SKIN_PREFIX) || candidate.id === skin?.id
                  )
                  .sort((left, right) => left.name.localeCompare(right.name));
                return (
                  <article className="theme-editor__button-row" key={placement.id}>
                    <div className="theme-editor__button-title">
                      <div>
                        <strong>{button?.label ?? placement.buttonId}</strong>
                        <small>
                          {surface?.name ?? placement.surfaceId}
                          {identity ? ` - ${identity.displayProgramName} / ${identity.displayPanelName} / ${identity.displayFileName}` : ""}
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() => void openButtonEditorWindow({
                          programName: identity?.displayProgramName,
                          panelName: identity?.displayPanelName,
                          buttonId: placement.buttonId,
                          surfaceId: placement.surfaceId
                        })}
                      >
                        Edit in Button Editor
                      </button>
                    </div>

                    <div className="theme-editor__skin-source">
                      <span>Skin source</span>
                      <strong>{skin?.name ?? "No assigned skin"}</strong>
                      <small>The complete canonical skin source is embedded when this theme is saved.</small>
                    </div>

                    <div className="theme-editor__button-controls">
                      <label>
                        <span>Assigned skin</span>
                        <select
                          value={skin?.id ?? ""}
                          onChange={(event) => updateDraft((document) => {
                            const nextPlacement = document.placements[placement.id];
                            const nextButton = document.buttons[placement.buttonId];
                            if (!nextPlacement || !nextButton) return;
                            nextPlacement.skinOverrideId = event.target.value === nextButton.defaultSkinId
                              ? null
                              : event.target.value || null;
                          }, [placement.id])}
                        >
                          {candidateSkins.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Width</span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={Number(placement.width.toFixed(2))}
                          onChange={(event) => updateDraft((document) => {
                            const next = document.placements[placement.id];
                            const value = Number(event.target.value);
                            if (next && Number.isFinite(value) && value > 0) next.width = value;
                          }, [placement.id])}
                        />
                      </label>
                      <label>
                        <span>Height</span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={Number(placement.height.toFixed(2))}
                          onChange={(event) => updateDraft((document) => {
                            const next = document.placements[placement.id];
                            const value = Number(event.target.value);
                            if (next && Number.isFinite(value) && value > 0) next.height = value;
                          }, [placement.id])}
                        />
                      </label>
                      {colorRoots.map((root) => (
                        <label key={root.role}>
                          <span>{root.role}</span>
                          <div className="theme-editor__color-control">
                            {isPickerColor(root.value) ? (
                              <input
                                type="color"
                                value={root.value}
                                onChange={(event) => updatePlacementColor(placement.id, root.role, event.target.value)}
                              />
                            ) : null}
                            <input
                              type="text"
                              value={root.value}
                              onChange={(event) => updatePlacementColor(placement.id, root.role, event.target.value)}
                            />
                          </div>
                        </label>
                      ))}
                    </div>

                    <div className="theme-editor__toggle-row">
                      <label className="theme-editor__toggle">
                        <input
                          type="checkbox"
                          checked={participation.gradientEnabled}
                          onChange={(event) => updateButtonParticipation(placement.id, {
                            gradientEnabled: event.currentTarget.checked
                          })}
                        />
                        <span>Gradient</span>
                      </label>
                      <label className="theme-editor__toggle">
                        <input
                          type="checkbox"
                          checked={participation.scatterEnabled}
                          disabled={!participation.gradientEnabled}
                          onChange={(event) => updateButtonParticipation(placement.id, {
                            scatterEnabled: event.currentTarget.checked
                          })}
                        />
                        <span>Scatter</span>
                      </label>
                      <label className="theme-editor__toggle">
                        <input
                          type="checkbox"
                          checked={skinHighlightOnHover}
                          onChange={(event) => updatePlacementHighlight(
                            placement.id,
                            "hover",
                            event.currentTarget.checked
                          )}
                        />
                        <span>Highlight on hover</span>
                      </label>
                      <label className="theme-editor__toggle">
                        <input
                          type="checkbox"
                          checked={skinHighlightOnActive}
                          onChange={(event) => updatePlacementHighlight(
                            placement.id,
                            "active",
                            event.currentTarget.checked
                          )}
                        />
                        <span>Highlight when active</span>
                      </label>
                    </div>

                    <details className="theme-editor__button-details">
                      <summary>More appearance controls</summary>
                      <div className="theme-editor__button-controls">
                        <label>
                          <span>Text fit</span>
                          <select
                            value={placement.textFitMode}
                            onChange={(event) => updateDraft((document) => {
                              const next = document.placements[placement.id];
                              if (next) next.textFitMode = event.target.value as ButtonPlacement["textFitMode"];
                            }, [placement.id])}
                          >
                            <option value="shrink">Shrink</option>
                            <option value="stack-whole-words">Stack whole words</option>
                            <option value="shrink-and-stack">Shrink and stack</option>
                          </select>
                        </label>
                        <label>
                          <span>Text alignment</span>
                          <select
                            value={placement.textAlignment}
                            onChange={(event) => updateDraft((document) => {
                              const next = document.placements[placement.id];
                              if (next) next.textAlignment = event.target.value as ButtonPlacement["textAlignment"];
                            }, [placement.id])}
                          >
                            <option value="skin">Skin</option>
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                          </select>
                        </label>
                        <label>
                          <span>Text offset X</span>
                          <input
                            type="number"
                            step="1"
                            value={placement.textOffsetX}
                            onChange={(event) => updateDraft((document) => {
                              const next = document.placements[placement.id];
                              const value = Number(event.target.value);
                              if (next && Number.isFinite(value)) next.textOffsetX = value;
                            }, [placement.id])}
                          />
                        </label>
                        <label>
                          <span>Text offset Y</span>
                          <input
                            type="number"
                            step="1"
                            value={placement.textOffsetY}
                            onChange={(event) => updateDraft((document) => {
                              const next = document.placements[placement.id];
                              const value = Number(event.target.value);
                              if (next && Number.isFinite(value)) next.textOffsetY = value;
                            }, [placement.id])}
                          />
                        </label>
                        <label>
                          <span>Minimum font size</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={placement.minimumFontSize}
                            onChange={(event) => updateDraft((document) => {
                              const next = document.placements[placement.id];
                              const value = Number(event.target.value);
                              if (next && Number.isFinite(value) && value > 0) next.minimumFontSize = value;
                            }, [placement.id])}
                          />
                        </label>
                        <label>
                          <span>Text size override</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={placement.textSizeOverride ?? ""}
                            placeholder="Skin default"
                            onChange={(event) => updateDraft((document) => {
                              const next = document.placements[placement.id];
                              const raw = event.target.value.trim();
                              const value = Number(raw);
                              if (next && (!raw || Number.isFinite(value) && value > 0)) {
                                next.textSizeOverride = raw ? value : null;
                              }
                            }, [placement.id])}
                          />
                        </label>
                      </div>
                      <div className="theme-editor__toggle-row">
                        <label className="theme-editor__toggle">
                          <input
                            type="checkbox"
                            checked={placement.allowLabelResize}
                            onChange={(event) => updateDraft((document) => {
                              const next = document.placements[placement.id];
                              if (next) next.allowLabelResize = event.currentTarget.checked;
                            }, [placement.id])}
                          />
                          <span>Allow label resize</span>
                        </label>
                        <label className="theme-editor__toggle">
                          <input
                            type="checkbox"
                            checked={placement.matchHitboxToSkin}
                            onChange={(event) => updateDraft((document) => {
                              const next = document.placements[placement.id];
                              if (next) next.matchHitboxToSkin = event.currentTarget.checked;
                            }, [placement.id])}
                          />
                          <span>Match hitbox to skin</span>
                        </label>
                        <label className="theme-editor__toggle">
                          <input
                            type="checkbox"
                            checked={placement.allowStretching}
                            onChange={(event) => updateDraft((document) => {
                              const next = document.placements[placement.id];
                              if (next) next.allowStretching = event.currentTarget.checked;
                            }, [placement.id])}
                          />
                          <span>Allow stretching</span>
                        </label>
                      </div>
                    </details>
                  </article>
                );
              })}
              {draftDocument && scopedPlacements.length === 0 ? (
                <p className="theme-editor__empty">No canonical Button placements are available for this scope.</p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      <footer className="theme-editor__status" role="status">{status}</footer>
    </main>
  );
}
