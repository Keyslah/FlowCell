// Appearance Hub v2 — button skin editor addressed to real buttons.
//
// Address model: program → panel → button → placement. Assignments live in
// the hub's own localStorage map (liveBridge.ts) and are rendered by the live
// surfaces (main page ButtonHost, script-group popouts, panel fans) through
// the existing imported-skin pipeline. The selector rail reads real
// program/panel/button lists read-only; nothing here writes FlowCellState.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import mainBackground from "../../assets/backgrounds/main-background.jpeg";
import {
  FanOutButtonCluster,
  type FanClusterEntry
} from "../../components/FanOutButtonCluster";
import { HostSkinButton } from "../../components/HostSkinButton";
import {
  listPanelFolders,
  listPanelScriptFiles,
  listProgramFolders,
  type PanelScriptFileRecord
} from "../../lib/programRails";
import {
  buildPanelScriptButtonId,
  readButtonLabelOverrides,
  resolveButtonLabelOverride
} from "../../lib/buttonLabelOverrides";
import { readPanelFanOptions } from "../../lib/panelFanSettings";
import { readScriptGroupPopoutType } from "../../lib/scriptGroupPopoutSettings";
import { DEFAULT_FLOW_IMPORTED_SKIN, DEFAULT_POPOUT_IMPORTED_SKIN } from "../../lib/theme";
import { openAppearanceWindow } from "../../lib/windowing";
import { ScriptGroupPopoutSurface } from "../script-group/ScriptGroupPopoutSurface";
import type { SkinPortResolution } from "./SkinPort";
import {
  compileSkin,
  createEmptySlots,
  renderStructureHtmlWithLines,
  splitSlotPaste,
  buildScopeClassName,
  type SlotContentMap
} from "./compileSkin";
import {
  DEFAULT_HUB_POPOUT_RULES,
  DEFAULT_HUB_TEXT_STYLE,
  HUB_PANEL_BUTTON_KEY,
  HUB_PLACEMENTS,
  buildHubAddressKey,
  compileHubAssignmentToImportedSkin,
  normalizeHubAssignment,
  normalizeHubPopoutRules,
  normalizeHubScale,
  normalizeHubTextStyle,
  readHubAssignments,
  subscribeHubSkins,
  writeHubAssignments,
  type HubAssignment,
  type HubAssignmentMap,
  type HubPlacement,
  type HubPopoutRules,
  type HubTextStyle
} from "./liveBridge";
import type { FlowCellButton, ImportedSkin, PanelFanOptions, StyleGroup } from "../../types";
import {
  KEYFRAMES_SLOT_ID,
  STATE_SLOT_HINTS,
  STATE_SLOT_IDS,
  STRUCTURE_SLOT_ID,
  type SlotId,
  type StateSlotId
} from "./slotSpec";
import "./appearanceHub.css";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const RESIZE_HANDLES: ReadonlyArray<{ direction: ResizeDirection; modifier: string }> = [
  { direction: "North", modifier: "north" },
  { direction: "South", modifier: "south" },
  { direction: "East", modifier: "east" },
  { direction: "West", modifier: "west" },
  { direction: "NorthEast", modifier: "north-east" },
  { direction: "NorthWest", modifier: "north-west" },
  { direction: "SouthEast", modifier: "south-east" },
  { direction: "SouthWest", modifier: "south-west" }
];

const PIN_CHOICES: readonly StateSlotId[] = STATE_SLOT_IDS.filter((slot) => slot !== "base");

const HELD_DELAY_MS = 400;
const RELEASE_FLASH_MS = 280;
const PLAY_GRACE_MS = 300;
const PLAY_MAX_MS = 15_000;
const ASSIGNMENT_WRITE_DEBOUNCE_MS = 400;

const HUB_UI_PREFS_KEY = "flowcell.appearanceHub.ui.v2";
const SKIN_FILE_FORMAT = "flowcell-button-skin-v1";
const SETUP_FILE_FORMAT = "flowcell-button-setup-v1";

const BASE_FONT_FAMILIES: readonly string[] = [
  "Segoe UI",
  "Arial",
  "Bahnschrift",
  "Calibri",
  "Cambria",
  "Candara",
  "Comic Sans MS",
  "Consolas",
  "Constantia",
  "Corbel",
  "Courier New",
  "Georgia",
  "Impact",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana"
];

type HubUiPrefs = {
  programName: string;
  panelName: string;
  buttonKey: string;
  placement: HubPlacement;
  background: "dark" | "light" | "main";
  showHitbox: boolean;
  pinnedStates: StateSlotId[];
  codeOpen: boolean;
  openSlots: Partial<Record<SlotId, boolean>>;
  lastSkinDir: string | null;
};

const DEFAULT_UI_PREFS: HubUiPrefs = {
  programName: "",
  panelName: "",
  buttonKey: HUB_PANEL_BUTTON_KEY,
  placement: "main",
  background: "dark",
  showHitbox: false,
  pinnedStates: [],
  codeOpen: true,
  openSlots: {},
  lastSkinDir: null
};

function readUiPrefs(): HubUiPrefs {
  try {
    const raw = window.localStorage.getItem(HUB_UI_PREFS_KEY);
    if (!raw) {
      return { ...DEFAULT_UI_PREFS };
    }
    const parsed = JSON.parse(raw) as Partial<HubUiPrefs>;
    return {
      ...DEFAULT_UI_PREFS,
      ...parsed,
      pinnedStates: Array.isArray(parsed.pinnedStates)
        ? parsed.pinnedStates.filter(
            (state): state is StateSlotId =>
              typeof state === "string" &&
              (STATE_SLOT_IDS as readonly string[]).includes(state) &&
              state !== "base"
          )
        : [],
      openSlots: parsed.openSlots && typeof parsed.openSlots === "object" ? parsed.openSlots : {}
    };
  } catch {
    return { ...DEFAULT_UI_PREFS };
  }
}

function writeUiPrefs(prefs: HubUiPrefs): void {
  try {
    window.localStorage.setItem(HUB_UI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Non-fatal.
  }
}

function placementsForButton(_buttonKey: string): readonly HubPlacement[] {
  return ["main", "popped-single", "popped-group", "fan"] as const;
}

type InstanceMetrics = {
  coreWidth: number;
  coreHeight: number;
  wrapWidth: number;
  wrapHeight: number;
};

function metricsEqual(a: InstanceMetrics | null, b: InstanceMetrics | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.coreWidth === b.coreWidth &&
    a.coreHeight === b.coreHeight &&
    a.wrapWidth === b.wrapWidth &&
    a.wrapHeight === b.wrapHeight
  );
}

// One rendered bench instance (same latch/remount mechanics validated in v1;
// the memoized element is load-bearing — see the React 19 innerHTML note).
function SkinInstance({
  scopeClass,
  html,
  pinned,
  onMeasure
}: {
  scopeClass: string;
  html: string;
  pinned: readonly StateSlotId[];
  onMeasure?: (metrics: InstanceMetrics | null) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const heldTimerRef = useRef<number | null>(null);
  const releaseTimerRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [held, setHeld] = useState(false);
  const [releaseFlash, setReleaseFlash] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playEpoch, setPlayEpoch] = useState(0);
  const playingRef = useRef(false);
  const playAnimationCountRef = useRef(0);
  const playSawAnimationRef = useRef(false);
  const playGraceTimerRef = useRef<number | null>(null);
  const playCapTimerRef = useRef<number | null>(null);
  const playSettleTimerRef = useRef<number | null>(null);

  const stopPlay = useCallback(() => {
    playingRef.current = false;
    playAnimationCountRef.current = 0;
    playSawAnimationRef.current = false;
    for (const timerRef of [playGraceTimerRef, playCapTimerRef, playSettleTimerRef]) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    setPlaying(false);
    setPlayEpoch((epoch) => epoch + 1);
  }, []);

  const schedulePlaySettleCheck = useCallback(() => {
    if (playSettleTimerRef.current !== null) {
      window.clearTimeout(playSettleTimerRef.current);
    }
    playSettleTimerRef.current = window.setTimeout(() => {
      playSettleTimerRef.current = null;
      if (!playingRef.current) {
        return;
      }
      const wrapper = wrapperRef.current;
      const stillRunning = wrapper
        ? document.getAnimations().some((animation) => {
            const target =
              animation.effect && "target" in animation.effect ? animation.effect.target : null;
            return (
              target instanceof Node && wrapper.contains(target) && animation.playState === "running"
            );
          })
        : false;
      if (!stillRunning) {
        stopPlay();
      }
    }, 180);
  }, [stopPlay]);

  const startPlay = () => {
    if (playingRef.current) {
      return;
    }
    playingRef.current = true;
    playAnimationCountRef.current = 0;
    playSawAnimationRef.current = false;
    setPlaying(true);
    setPlayEpoch((epoch) => epoch + 1);
    playGraceTimerRef.current = window.setTimeout(() => {
      if (!playSawAnimationRef.current) {
        stopPlay();
      }
    }, PLAY_GRACE_MS);
    playCapTimerRef.current = window.setTimeout(stopPlay, PLAY_MAX_MS);
  };

  useEffect(() => {
    return () => {
      for (const timerRef of [
        heldTimerRef,
        releaseTimerRef,
        playGraceTimerRef,
        playCapTimerRef,
        playSettleTimerRef
      ]) {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!onMeasure) {
      return;
    }
    const wrapper = wrapperRef.current;
    const core = wrapper?.querySelector<HTMLElement>("[data-core]") ?? null;
    if (!wrapper || !core) {
      onMeasure(null);
      return;
    }
    const report = () => {
      onMeasure({
        coreWidth: core.offsetWidth,
        coreHeight: core.offsetHeight,
        wrapWidth: wrapper.offsetWidth,
        wrapHeight: wrapper.offsetHeight
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(core);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [html, onMeasure, playEpoch]);

  const clearHeldTimer = () => {
    if (heldTimerRef.current !== null) {
      window.clearTimeout(heldTimerRef.current);
      heldTimerRef.current = null;
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    setPressed(true);
    startPlay();
    clearHeldTimer();
    heldTimerRef.current = window.setTimeout(() => setHeld(true), HELD_DELAY_MS);
  };

  const handlePointerUp = () => {
    clearHeldTimer();
    if (pressed || held) {
      setReleaseFlash(true);
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
      }
      releaseTimerRef.current = window.setTimeout(() => setReleaseFlash(false), RELEASE_FLASH_MS);
    }
    setPressed(false);
    setHeld(false);
  };

  const handlePointerLeave = () => {
    clearHeldTimer();
    setHovered(false);
    setPressed(false);
    setHeld(false);
  };

  const skinContent = useMemo(
    () => <div key={playEpoch} dangerouslySetInnerHTML={{ __html: html }} />,
    [html, playEpoch]
  );

  const isHovered = hovered || pinned.includes("hover");
  const isPressed = pressed || pinned.includes("pressed");
  const isHeld = held || pinned.includes("held");
  const isPlaying = playing || pinned.includes("play");
  const isDisabled = pinned.includes("disabled");
  const isError = pinned.includes("error");
  const actionPhase = pinned.includes("release") || releaseFlash ? "release" : "idle";

  return (
    <div
      ref={wrapperRef}
      className={`ahub-inst ${scopeClass}`}
      data-hovered={isHovered ? "true" : "false"}
      data-pressed={isPressed ? "true" : "false"}
      data-held={isHeld ? "true" : "false"}
      data-play={isPlaying ? "true" : "false"}
      data-disabled={isDisabled ? "true" : "false"}
      data-error={isError ? "true" : "false"}
      data-action-phase={actionPhase}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerLeave}
      onAnimationStart={() => {
        if (!playingRef.current) {
          return;
        }
        playSawAnimationRef.current = true;
        playAnimationCountRef.current += 1;
      }}
      onAnimationEnd={() => {
        if (!playingRef.current) {
          return;
        }
        playAnimationCountRef.current -= 1;
        if (playSawAnimationRef.current && playAnimationCountRef.current <= 0) {
          stopPlay();
          return;
        }
        schedulePlaySettleCheck();
      }}
    >
      {skinContent}
    </div>
  );
}

const PANEL_FAN_OWNER_BUTTON_ID = "hub-preview-panel-fan-owner";
const PANEL_FAN_OWNER_TOOLTIP = "Select the panel fan owner for editing.";

// Appended to the selected address's compiled skin CSS when "Show hitbox" is
// on. Same selector convention as buildLiveTextCss so the pipeline scopes it
// into the shadow root; the dashed teal outline lands on the interactive core
// (the actual hitbox) and scales with it.
const HITBOX_OVERLAY_CSS =
  ".button-skin [data-flow-interactive] { outline: 1px dashed rgba(95, 230, 205, 0.95); outline-offset: 0; }";

// Marks the button as imported-skin driven so HostSkinButton renders our
// compiled skin (skinId defaults to the stock "glass-card" otherwise).
const IMPORTED_SKIN_STYLE_GROUP: StyleGroup = {
  id: "hub-live-preview",
  index: 0,
  name: "Hub live preview",
  skinId: "imported-skin",
  accent: "#9cf667"
};

function isToolsetRecord(record: PanelScriptFileRecord): boolean {
  return Array.isArray(record.children) && record.children.length > 0;
}

function panelScriptLabel(record: PanelScriptFileRecord): string {
  return record.label?.trim() || record.fileName.replace(/\.[^.]+$/, "");
}

function stockSkinForPlacement(placement: HubPlacement): ImportedSkin {
  return placement === "main" ? DEFAULT_FLOW_IMPORTED_SKIN : DEFAULT_POPOUT_IMPORTED_SKIN;
}

function fixedFootprintForSkin(skin: ImportedSkin): { width: number; height: number } | undefined {
  return typeof skin.fixedWidth === "number" && typeof skin.fixedHeight === "number"
    ? { width: skin.fixedWidth, height: skin.fixedHeight }
    : undefined;
}

function buildPreviewPanelFanOwnerButton(label: string): FlowCellButton {
  return {
    Id: PANEL_FAN_OWNER_BUTTON_ID,
    Kind: "panel_fan_owner",
    command_id: "flowcell.run_builtin",
    Label: label,
    Target: "panel_fan_owner",
    Tooltip: PANEL_FAN_OWNER_TOOLTIP
  };
}

function buildPreviewPanelScriptButton(
  record: PanelScriptFileRecord,
  label: string
): FlowCellButton {
  return {
    Id: record.fileName,
    Kind: "panel_script",
    command_id: "flowcell.run_script",
    Label: label,
    Target: record.fileName,
    Tooltip: record.tooltip?.trim() || label,
    ExecutionTarget: record.executionTarget
  };
}

// Preview-only render of a button skin: no selection chrome, no side effects —
// the picker strip below the stage is the only selector. Clicks are inert
// (press/play states still run, like the real button minus the script).
function PreviewAddressButton({ label, skin }: { label: string; skin: ImportedSkin }) {
  return (
    <HostSkinButton
      className="ahub-live__button"
      label={label}
      styleGroup={IMPORTED_SKIN_STYLE_GROUP}
      importedSkin={skin}
      hostMode="neutral"
      footprintOverride={fixedFootprintForSkin(skin)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    />
  );
}

function LiveAddressPlacementPreview({
  surface,
  assignments,
  currentButtonKey,
  currentPlacement,
  liveSkin,
  selectedLabelOverride,
  panelLabel,
  previewLabel,
  programName,
  panelName,
  scriptRecords,
  fanOptions
}: {
  surface: HubPlacement;
  assignments: HubAssignmentMap;
  currentButtonKey: string;
  currentPlacement: HubPlacement;
  liveSkin: ImportedSkin | null;
  selectedLabelOverride: string | undefined;
  panelLabel: string;
  previewLabel: string;
  programName: string;
  panelName: string;
  scriptRecords: PanelScriptFileRecord[];
  fanOptions: PanelFanOptions;
}) {
  const [fanExpanded, setFanExpanded] = useState(false);
  const [fanChildrenVisible, setFanChildrenVisible] = useState(false);
  const [fanPinnedOpen, setFanPinnedOpen] = useState(false);
  const regularRecords = useMemo(
    () => scriptRecords.filter((record) => !isToolsetRecord(record)),
    [scriptRecords]
  );
  const selectedRecord =
    regularRecords.find((record) => record.fileName === currentButtonKey) ?? null;

  useEffect(() => {
    setFanExpanded(false);
    setFanChildrenVisible(false);
    setFanPinnedOpen(false);
  }, [panelName, programName, surface]);

  const isSelectedAddress = (buttonKey: string, placement: HubPlacement): boolean =>
    currentButtonKey === buttonKey && currentPlacement === placement;

  const addressKeyFor = (buttonKey: string, placement: HubPlacement): string | null =>
    programName && panelName ? buildHubAddressKey(programName, panelName, buttonKey, placement) : null;

  const resolveAddressSkin = (
    buttonKey: string,
    placement: HubPlacement
  ): ImportedSkin | undefined => {
    if (isSelectedAddress(buttonKey, placement)) {
      return liveSkin ?? undefined;
    }
    const nextAddressKey = addressKeyFor(buttonKey, placement);
    const nextAssignment = nextAddressKey ? assignments[nextAddressKey] : null;
    if (!nextAddressKey || !nextAssignment) {
      return undefined;
    }
    return compileHubAssignmentToImportedSkin(nextAddressKey, nextAssignment) ?? undefined;
  };

  const resolveRequiredAddressSkin = (
    buttonKey: string,
    placement: HubPlacement
  ): ImportedSkin => resolveAddressSkin(buttonKey, placement) ?? stockSkinForPlacement(placement);

  const resolveAddressLabel = (
    buttonKey: string,
    placement: HubPlacement,
    fallback: string
  ): string => {
    if (isSelectedAddress(buttonKey, placement)) {
      return previewLabel;
    }
    const nextAddressKey = addressKeyFor(buttonKey, placement);
    const labelOverride = nextAddressKey
      ? assignments[nextAddressKey]?.text.labelOverride
      : undefined;
    return labelOverride !== null && labelOverride !== undefined ? labelOverride : fallback;
  };

  const renderAddressButton = (
    buttonKey: string,
    placement: HubPlacement,
    fallbackLabel: string
  ) => (
    <PreviewAddressButton
      key={`${placement}:${buttonKey}`}
      label={resolveAddressLabel(buttonKey, placement, fallbackLabel)}
      skin={resolveRequiredAddressSkin(buttonKey, placement)}
    />
  );

  // Popped previews render the REAL popout surface (same component as the
  // live window). Base labels mirror the real path (lib label overrides);
  // hub label overrides ride in through the skin resolver, with the selected
  // address rendering the live draft.
  const libLabelOverrides = readButtonLabelOverrides();
  const baseScriptLabel = (record: PanelScriptFileRecord): string =>
    resolveButtonLabelOverride(
      buildPanelScriptButtonId(programName, panelName, record.fileName),
      panelScriptLabel(record),
      libLabelOverrides
    );

  const buildPoppedSkinResolver =
    (placement: HubPlacement) =>
    (fileName: string): SkinPortResolution | null => {
      if (isSelectedAddress(fileName, placement)) {
        return liveSkin
          ? { importedSkin: liveSkin, labelOverride: selectedLabelOverride }
          : null;
      }
      const skin = resolveAddressSkin(fileName, placement);
      if (!skin) {
        return null;
      }
      const key = addressKeyFor(fileName, placement);
      const labelOverride = key
        ? (assignments[key]?.text.labelOverride ?? undefined)
        : undefined;
      return { importedSkin: skin, labelOverride };
    };

  if (surface === "fan") {
    const ownerLabel = resolveAddressLabel(HUB_PANEL_BUTTON_KEY, "fan", panelLabel);
    const childEntries: FanClusterEntry[] = regularRecords.map((record) => {
      const childLabel = resolveAddressLabel(record.fileName, "fan", panelScriptLabel(record));
      return {
        programId: 0,
        panelId: panelName,
        panelName,
        button: buildPreviewPanelScriptButton(record, childLabel),
        childSlotId: record.fileName,
        events: record.events
      };
    });
    const requestFanOpen = () => {
      setFanExpanded(true);
      setFanChildrenVisible(true);
    };
    const requestFanClose = () => {
      setFanExpanded(false);
      setFanChildrenVisible(false);
      setFanPinnedOpen(false);
    };

    return (
      <div className="ahub-live ahub-live--fan">
        <FanOutButtonCluster
          ownerButton={buildPreviewPanelFanOwnerButton(ownerLabel)}
          layout={fanOptions.layout}
          placement={fanOptions.placement}
          variant="panel-fan"
          pinnedOpen={fanPinnedOpen}
          geometryExpanded={fanExpanded}
          windowExpanded={fanExpanded}
          childrenVisible={fanChildrenVisible}
          onExpandRequest={requestFanOpen}
          onCollapseRequest={requestFanClose}
          childButtons={childEntries}
          ownerStyleGroupOverride={IMPORTED_SKIN_STYLE_GROUP}
          ownerImportedSkinOverride={DEFAULT_POPOUT_IMPORTED_SKIN}
          styleGroupOverride={IMPORTED_SKIN_STYLE_GROUP}
          importedSkinOverride={DEFAULT_POPOUT_IMPORTED_SKIN}
          hubSkinResolver={(button) => {
            const buttonKey =
              button.Kind === "panel_fan_owner"
                ? HUB_PANEL_BUTTON_KEY
                : (button.Target || button.Id || "").trim();
            return buttonKey ? resolveAddressSkin(buttonKey, "fan") : undefined;
          }}
          onOwnerClick={() => {
            // Same as the real fan: owner click pins open / unpins. No
            // address selection here — the picker strip is the selector.
            if (fanPinnedOpen) {
              requestFanClose();
              return;
            }
            setFanPinnedOpen(true);
            requestFanOpen();
          }}
          onChildClick={() => {
            // Real fan child click runs the script; the preview runs nothing.
          }}
        />
      </div>
    );
  }

  if (surface === "popped-single" || surface === "popped-group") {
    // The literal popout: same surface component as the real window, same
    // template geometry, same record order (selection never reorders), no
    // selection chrome. Clicks run nothing.
    const poppedRecords =
      surface === "popped-group"
        ? regularRecords
        : selectedRecord
          ? [selectedRecord]
          : regularRecords.slice(0, 1);
    const popoutType =
      surface === "popped-single" ? "single" : readScriptGroupPopoutType(programName, panelName);
    return (
      <div className="ahub-live ahub-live--pop">
        <ScriptGroupPopoutSurface
          programName={programName}
          panelName={panelName}
          popoutType={popoutType}
          scripts={poppedRecords.map((record) => ({
            fileName: record.fileName,
            label: baseScriptLabel(record),
            tooltip: record.tooltip?.trim() || undefined
          }))}
          skinResolver={buildPoppedSkinResolver(surface)}
          onActivate={() => {
            // Preview only: the real window runs the script here.
          }}
        />
      </div>
    );
  }

  return (
    <div className="ahub-live ahub-live--single">
      {currentButtonKey === HUB_PANEL_BUTTON_KEY
        ? renderAddressButton(HUB_PANEL_BUTTON_KEY, "main", panelLabel)
        : renderAddressButton(
            currentButtonKey,
            "main",
            selectedRecord?.label?.trim() ||
              currentButtonKey.replace(/\.[^.]+$/, "") ||
              "Button"
          )}
    </div>
  );
}

export default function AppearanceHubWindowPage() {
  const [prefs, setPrefs] = useState<HubUiPrefs>(() => readUiPrefs());
  const [previewSurface, setPreviewSurface] = useState<HubPlacement>("main");
  const [assignments, setAssignments] = useState<HubAssignmentMap>(() => readHubAssignments());
  const [programs, setPrograms] = useState<string[]>([]);
  const [panels, setPanels] = useState<string[]>([]);
  const [scriptRecords, setScriptRecords] = useState<PanelScriptFileRecord[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [fontFamilies, setFontFamilies] = useState<string[]>(() => [...BASE_FONT_FAMILIES]);
  const [draftText, setDraftText] = useState<HubTextStyle>({ ...DEFAULT_HUB_TEXT_STYLE });
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [previewMetrics, setPreviewMetrics] = useState<InstanceMetrics | null>(null);
  const writeTimerRef = useRef<number | null>(null);
  const pendingAssignmentsRef = useRef<HubAssignmentMap | null>(null);

  useEffect(() => {
    writeUiPrefs(prefs);
  }, [prefs]);

  // Refresh when another window (or this one) changes assignments.
  useEffect(
    () =>
      subscribeHubSkins(() => {
        if (!pendingAssignmentsRef.current) {
          setAssignments(readHubAssignments());
        }
      }),
    []
  );

  // Debounced assignment writes: the map updates in memory immediately (so
  // the bench is live) and lands in storage + other windows shortly after.
  const commitAssignments = useCallback((next: HubAssignmentMap) => {
    setAssignments(next);
    pendingAssignmentsRef.current = next;
    if (writeTimerRef.current !== null) {
      window.clearTimeout(writeTimerRef.current);
    }
    writeTimerRef.current = window.setTimeout(() => {
      writeTimerRef.current = null;
      const pending = pendingAssignmentsRef.current;
      pendingAssignmentsRef.current = null;
      if (pending) {
        writeHubAssignments(pending);
      }
    }, ASSIGNMENT_WRITE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (writeTimerRef.current !== null) {
        window.clearTimeout(writeTimerRef.current);
      }
      const pending = pendingAssignmentsRef.current;
      pendingAssignmentsRef.current = null;
      if (pending) {
        writeHubAssignments(pending);
      }
    };
  }, []);

  // Frameless window: hold Space then drag to move it.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) {
        return;
      }
      event.preventDefault();
      if (!event.repeat) {
        setSpaceDragActive(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      setSpaceDragActive(false);
      setSpaceDragging(false);
    };
    const handleBlur = () => {
      setSpaceDragActive(false);
      setSpaceDragging(false);
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // ---- selector rail data ----

  useEffect(() => {
    let cancelled = false;
    listProgramFolders()
      .then((names) => {
        if (cancelled) {
          return;
        }
        setPrograms(names);
        setPrefs((current) =>
          current.programName && names.includes(current.programName)
            ? current
            : { ...current, programName: names[0] ?? "" }
        );
      })
      .catch(() => setStatusMessage("Could not list programs."));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!prefs.programName) {
      setPanels([]);
      return;
    }
    let cancelled = false;
    listPanelFolders(prefs.programName)
      .then((names) => {
        if (cancelled) {
          return;
        }
        setPanels(names);
        setPrefs((current) =>
          current.panelName && names.includes(current.panelName)
            ? current
            : { ...current, panelName: names[0] ?? "" }
        );
      })
      .catch(() => setStatusMessage(`Could not list panels for ${prefs.programName}.`));
    return () => {
      cancelled = true;
    };
  }, [prefs.programName]);

  useEffect(() => {
    if (!prefs.programName || !prefs.panelName) {
      setScriptRecords([]);
      return;
    }
    let cancelled = false;
    listPanelScriptFiles(prefs.programName, prefs.panelName)
      .then((records) => {
        if (cancelled) {
          return;
        }
        setScriptRecords(records);
        setPrefs((current) => {
          const validKeys = new Set<string>([
            HUB_PANEL_BUTTON_KEY,
            ...records.map((record) => record.fileName)
          ]);
          if (validKeys.has(current.buttonKey)) {
            return current;
          }
          return { ...current, buttonKey: HUB_PANEL_BUTTON_KEY };
        });
      })
      .catch(() => setStatusMessage(`Could not list buttons for ${prefs.panelName}.`));
    return () => {
      cancelled = true;
    };
  }, [prefs.programName, prefs.panelName]);

  const availablePlacements = placementsForButton(prefs.buttonKey);
  const placement: HubPlacement = availablePlacements.includes(prefs.placement)
    ? prefs.placement
    : availablePlacements[0];

  const addressKey = useMemo(
    () =>
      prefs.programName && prefs.panelName
        ? buildHubAddressKey(prefs.programName, prefs.panelName, prefs.buttonKey, placement)
        : null,
    [prefs.programName, prefs.panelName, prefs.buttonKey, placement]
  );

  const assignment: HubAssignment | null = addressKey ? (assignments[addressKey] ?? null) : null;
  const slots: SlotContentMap = assignment?.slots ?? createEmptySlots();

  // Text drafts are per-address and only land on Apply.
  useEffect(() => {
    setDraftText(assignment ? { ...assignment.text } : { ...DEFAULT_HUB_TEXT_STYLE });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey, assignment?.updatedAt]);

  const selectedRecord = scriptRecords.find((record) => record.fileName === prefs.buttonKey) ?? null;
  const realButtonLabel =
    prefs.buttonKey === HUB_PANEL_BUTTON_KEY
      ? prefs.panelName || "Panel"
      : selectedRecord?.label?.trim() || prefs.buttonKey.replace(/\.[^.]+$/, "");
  const previewLabel = draftText.labelOverride ?? realButtonLabel;
  const panelLabel = prefs.panelName || "Panel";
  const fanPreviewOptions = useMemo<PanelFanOptions>(
    () =>
      prefs.programName && prefs.panelName
        ? readPanelFanOptions(prefs.programName, prefs.panelName)
        : { layout: "grid", placement: "bottom-left" },
    [prefs.programName, prefs.panelName]
  );

  const updateAssignmentSlots = (slotId: SlotId, value: string) => {
    if (!addressKey) {
      return;
    }
    const nextSlots: SlotContentMap = { ...slots, [slotId]: value };
    const next: HubAssignmentMap = {
      ...assignments,
      [addressKey]: {
        slots: nextSlots,
        text: assignment?.text ?? { ...DEFAULT_HUB_TEXT_STYLE },
        scale: assignment?.scale ?? 1,
        natural: assignment?.natural ?? null,
        popout: assignment?.popout ?? { ...DEFAULT_HUB_POPOUT_RULES },
        updatedAt: new Date().toISOString()
      }
    };
    commitAssignments(next);
  };

  const updateAssignmentScale = (scale: number) => {
    if (!addressKey || !assignment) {
      return;
    }
    commitAssignments({
      ...assignments,
      [addressKey]: { ...assignment, scale, updatedAt: new Date().toISOString() }
    });
  };

  const updateAssignmentRules = (rules: Partial<HubPopoutRules>) => {
    if (!addressKey || !assignment) {
      return;
    }
    commitAssignments({
      ...assignments,
      [addressKey]: {
        ...assignment,
        popout: { ...assignment.popout, ...rules },
        updatedAt: new Date().toISOString()
      }
    });
  };

  const applyTextDraft = () => {
    if (!addressKey) {
      return;
    }
    const next: HubAssignmentMap = {
      ...assignments,
      [addressKey]: {
        slots,
        text: normalizeHubTextStyle(draftText),
        scale: assignment?.scale ?? 1,
        natural: assignment?.natural ?? null,
        popout: assignment?.popout ?? { ...DEFAULT_HUB_POPOUT_RULES },
        updatedAt: new Date().toISOString()
      }
    };
    commitAssignments(next);
    setStatusMessage("Text applied.");
  };

  const textDraftDirty = useMemo(() => {
    const applied = assignment?.text ?? DEFAULT_HUB_TEXT_STYLE;
    const draft = normalizeHubTextStyle(draftText);
    return (
      applied.fontFamily !== draft.fontFamily ||
      applied.fontSizePx !== draft.fontSizePx ||
      applied.lines !== draft.lines ||
      (applied.labelOverride ?? null) !== (draft.labelOverride ?? null)
    );
  }, [assignment?.text, draftText]);

  const handleApplyPaste = () => {
    if (!addressKey) {
      return;
    }
    const { slots: pasted, unknownSections } = splitSlotPaste(pasteText);
    const pastedIds = Object.keys(pasted) as SlotId[];
    if (pastedIds.length === 0) {
      setStatusMessage("No `=== slot ===` sections found — nothing applied.");
      return;
    }
    const nextSlots: SlotContentMap = { ...slots, ...pasted };
    commitAssignments({
      ...assignments,
      [addressKey]: {
        slots: nextSlots,
        text: assignment?.text ?? { ...DEFAULT_HUB_TEXT_STYLE },
        scale: assignment?.scale ?? 1,
        natural: assignment?.natural ?? null,
        popout: assignment?.popout ?? { ...DEFAULT_HUB_POPOUT_RULES },
        updatedAt: new Date().toISOString()
      }
    });
    const parts = [`Applied ${pastedIds.join(", ")} to ${realButtonLabel} · ${placement}.`];
    if (unknownSections.length > 0) {
      parts.push(`Ignored: ${unknownSections.join(", ")}.`);
    }
    setStatusMessage(parts.join(" "));
  };

  const handleRemoveSkin = () => {
    if (!addressKey || !assignment) {
      return;
    }
    if (!window.confirm(`Remove the skin from ${realButtonLabel} (${placement})?`)) {
      return;
    }
    const next = { ...assignments };
    delete next[addressKey];
    commitAssignments(next);
    setStatusMessage("Skin removed — button is back to its stock look.");
  };

  const handleApplyToPanel = () => {
    if (!addressKey || !assignment || !prefs.programName || !prefs.panelName) {
      return;
    }
    const targetKeys: string[] = [];
    if (placementsForButton(HUB_PANEL_BUTTON_KEY).includes(placement)) {
      targetKeys.push(HUB_PANEL_BUTTON_KEY);
    }
    for (const record of scriptRecords) {
      const isToolset = Array.isArray(record.children) && record.children.length > 0;
      if (!isToolset) {
        targetKeys.push(record.fileName);
      }
    }
    if (
      !window.confirm(
        `Apply this skin to ${targetKeys.length} button(s) in "${prefs.panelName}" at placement "${placement}"?`
      )
    ) {
      return;
    }
    const next = { ...assignments };
    const stamp = new Date().toISOString();
    for (const key of targetKeys) {
      next[buildHubAddressKey(prefs.programName, prefs.panelName, key, placement)] = {
        slots: { ...assignment.slots },
        text: { ...assignment.text },
        scale: assignment.scale,
        natural: assignment.natural,
        popout: { ...assignment.popout },
        updatedAt: stamp
      };
    }
    commitAssignments(next);
    setStatusMessage(`Applied to ${targetKeys.length} buttons in ${prefs.panelName}.`);
  };

  const handleSaveSkin = async () => {
    if (!assignment) {
      setStatusMessage("Nothing to save — this button has no skin yet.");
      return;
    }
    try {
      const suggested = `${realButtonLabel.replace(/[^a-z0-9 _-]+/gi, "").trim() || "button"}.fcskin.json`;
      const path = await invoke<string | null>("show_save_hub_skin_dialog", {
        suggestedName: suggested,
        initialDirectory: prefs.lastSkinDir,
        parentLabel: "flowcell-appearance-hub"
      });
      if (!path) {
        return;
      }
      await invoke<string>("save_hub_skin_file", {
        path,
        value: {
          format: SKIN_FILE_FORMAT,
          savedAt: new Date().toISOString(),
          slots: assignment.slots,
          text: assignment.text,
          scale: assignment.scale,
          natural: assignment.natural,
          popout: assignment.popout
        }
      });
      const directory = path.replace(/[\\/][^\\/]*$/, "");
      setPrefs((current) => ({ ...current, lastSkinDir: directory }));
      setStatusMessage(`Saved skin to ${path}`);
    } catch (error) {
      setStatusMessage(`Save failed: ${String(error)}`);
    }
  };

  const handleLoadSkin = async () => {
    if (!addressKey) {
      return;
    }
    try {
      const path = await invoke<string | null>("show_open_hub_skin_dialog", {
        initialDirectory: prefs.lastSkinDir,
        parentLabel: "flowcell-appearance-hub"
      });
      if (!path) {
        return;
      }
      const value = await invoke<Record<string, unknown>>("load_hub_skin_file", { path });
      const loadedSlots = createEmptySlots();
      const rawSlots = value.slots as Record<string, unknown> | undefined;
      if (rawSlots && typeof rawSlots === "object") {
        loadedSlots[STRUCTURE_SLOT_ID] =
          typeof rawSlots[STRUCTURE_SLOT_ID] === "string" ? (rawSlots[STRUCTURE_SLOT_ID] as string) : "";
        loadedSlots[KEYFRAMES_SLOT_ID] =
          typeof rawSlots[KEYFRAMES_SLOT_ID] === "string" ? (rawSlots[KEYFRAMES_SLOT_ID] as string) : "";
        for (const slotId of STATE_SLOT_IDS) {
          loadedSlots[slotId] = typeof rawSlots[slotId] === "string" ? (rawSlots[slotId] as string) : "";
        }
      }
      if (!loadedSlots[STRUCTURE_SLOT_ID].trim()) {
        setStatusMessage("That file has no structure slot — not a button skin file?");
        return;
      }
      const text = normalizeHubTextStyle(value.text as Partial<HubTextStyle> | undefined);
      commitAssignments({
        ...assignments,
        [addressKey]: {
          slots: loadedSlots,
          text,
          scale: normalizeHubScale(value.scale),
          // Natural size is re-measured by the bench for this button's real
          // label rather than trusted from the file.
          natural: null,
          popout: normalizeHubPopoutRules(value.popout),
          updatedAt: new Date().toISOString()
        }
      });
      setDraftText({ ...text });
      const directory = path.replace(/[\\/][^\\/]*$/, "");
      setPrefs((current) => ({ ...current, lastSkinDir: directory }));
      setStatusMessage(`Loaded skin onto ${realButtonLabel} · ${placement}.`);
    } catch (error) {
      setStatusMessage(`Load failed: ${String(error)}`);
    }
  };

  // ---- button setups: every assignment of the selected panel in one file ----

  const collectPanelAddressEntries = (): Array<{
    buttonKey: string;
    placement: HubPlacement;
    assignment: HubAssignment;
  }> => {
    if (!prefs.programName || !prefs.panelName) {
      return [];
    }
    const buttonKeys = [
      HUB_PANEL_BUTTON_KEY,
      ...scriptRecords.filter((record) => !isToolsetRecord(record)).map((record) => record.fileName)
    ];
    const entries: Array<{ buttonKey: string; placement: HubPlacement; assignment: HubAssignment }> = [];
    for (const buttonKey of buttonKeys) {
      for (const entryPlacement of placementsForButton(buttonKey)) {
        const key = buildHubAddressKey(prefs.programName, prefs.panelName, buttonKey, entryPlacement);
        const entryAssignment = assignments[key];
        if (entryAssignment) {
          entries.push({ buttonKey, placement: entryPlacement, assignment: entryAssignment });
        }
      }
    }
    return entries;
  };

  const handleSaveSetup = async () => {
    const entries = collectPanelAddressEntries();
    if (entries.length === 0) {
      setStatusMessage("Nothing to save — no skins on this panel yet.");
      return;
    }
    try {
      const suggested = `${(prefs.panelName || "panel").replace(/[^a-z0-9 _-]+/gi, "").trim() || "panel"}.fcsetup.json`;
      const path = await invoke<string | null>("show_save_hub_skin_dialog", {
        suggestedName: suggested,
        initialDirectory: prefs.lastSkinDir,
        parentLabel: "flowcell-appearance-hub"
      });
      if (!path) {
        return;
      }
      await invoke<string>("save_hub_skin_file", {
        path,
        value: {
          format: SETUP_FILE_FORMAT,
          savedAt: new Date().toISOString(),
          programName: prefs.programName,
          panelName: prefs.panelName,
          entries
        }
      });
      const directory = path.replace(/[\\/][^\\/]*$/, "");
      setPrefs((current) => ({ ...current, lastSkinDir: directory }));
      setStatusMessage(`Saved setup (${entries.length} assignment(s)) to ${path}`);
    } catch (error) {
      setStatusMessage(`Setup save failed: ${String(error)}`);
    }
  };

  const handleLoadSetup = async () => {
    if (!prefs.programName || !prefs.panelName) {
      return;
    }
    try {
      const path = await invoke<string | null>("show_open_hub_skin_dialog", {
        initialDirectory: prefs.lastSkinDir,
        parentLabel: "flowcell-appearance-hub"
      });
      if (!path) {
        return;
      }
      const value = await invoke<Record<string, unknown>>("load_hub_skin_file", { path });
      const rawEntries = Array.isArray(value.entries) ? value.entries : null;
      if (!rawEntries) {
        setStatusMessage("That file has no setup entries — not a button setup file?");
        return;
      }
      const loaded: Array<{ buttonKey: string; placement: HubPlacement; assignment: HubAssignment }> = [];
      for (const raw of rawEntries) {
        if (!raw || typeof raw !== "object") {
          continue;
        }
        const entry = raw as { buttonKey?: unknown; placement?: unknown; assignment?: unknown };
        const buttonKey = typeof entry.buttonKey === "string" ? entry.buttonKey : "";
        const entryPlacement = HUB_PLACEMENTS.find(
          (candidate) => candidate.id === entry.placement
        )?.id;
        const entryAssignment = normalizeHubAssignment(entry.assignment);
        if (!buttonKey || !entryPlacement || !entryAssignment) {
          continue;
        }
        loaded.push({ buttonKey, placement: entryPlacement, assignment: entryAssignment });
      }
      if (loaded.length === 0) {
        setStatusMessage("No usable entries in that setup file.");
        return;
      }
      if (
        !window.confirm(
          `Load ${loaded.length} assignment(s) onto "${prefs.panelName}"? Existing skins on this panel are replaced.`
        )
      ) {
        return;
      }
      const next = { ...assignments };
      for (const entry of collectPanelAddressEntries()) {
        delete next[
          buildHubAddressKey(prefs.programName, prefs.panelName, entry.buttonKey, entry.placement)
        ];
      }
      for (const entry of loaded) {
        next[
          buildHubAddressKey(prefs.programName, prefs.panelName, entry.buttonKey, entry.placement)
        ] = entry.assignment;
      }
      commitAssignments(next);
      const directory = path.replace(/[\\/][^\\/]*$/, "");
      setPrefs((current) => ({ ...current, lastSkinDir: directory }));
      setStatusMessage(`Loaded setup: ${loaded.length} assignment(s) onto ${prefs.panelName}.`);
    } catch (error) {
      setStatusMessage(`Setup load failed: ${String(error)}`);
    }
  };

  const handleLoadSystemFonts = async () => {
    try {
      const query = (
        window as Window & {
          queryLocalFonts?: () => Promise<Array<{ family: string }>>;
        }
      ).queryLocalFonts;
      if (!query) {
        setStatusMessage("System font listing is not available here — the base list stays.");
        return;
      }
      const fonts = await query();
      const families = Array.from(new Set(fonts.map((font) => font.family))).sort();
      if (families.length > 0) {
        setFontFamilies(families);
        setStatusMessage(`Loaded ${families.length} system fonts.`);
      }
    } catch {
      setStatusMessage("Could not read system fonts (permission denied?).");
    }
  };

  // ---- preview ----

  // Bench CSS/HTML compile from the DRAFT text style: the visible placement
  // preview renders the draft live (liveSkin below), so the measuring bench
  // must render the same draft or the measured footprint — and with it the
  // preview's box, selected ring, and hitbox — lags the Text sliders until
  // Apply and the button looks distorted against its own box.
  const compiled = useMemo(
    () =>
      compileSkin(addressKey ?? "empty", slots, draftText.fontSizePx, draftText.fontFamily),
    [addressKey, slots, draftText.fontSizePx, draftText.fontFamily]
  );
  const scopeClass = useMemo(() => buildScopeClassName(addressKey ?? "empty"), [addressKey]);
  const previewHtml = useMemo(
    () =>
      renderStructureHtmlWithLines(slots[STRUCTURE_SLOT_ID], previewLabel, draftText.lines),
    [slots, previewLabel, draftText.lines]
  );
  const hasSkin = Boolean(assignment) && compiled.structureValid;

  // Compile the current draft into the same ImportedSkin the live surfaces
  // consume, so the placement preview renders through the real pipeline. The
  // natural core size comes from the bench measurement (below) so footprints
  // match; before the first measurement it falls back to the stored natural.
  const liveSkin = useMemo<ImportedSkin | null>(() => {
    if (!addressKey || !hasSkin) {
      return null;
    }
    const natural = previewMetrics
      ? {
          width: Math.round(previewMetrics.coreWidth),
          height: Math.round(previewMetrics.coreHeight)
        }
      : (assignment?.natural ?? null);
    const compiledSkin = compileHubAssignmentToImportedSkin(addressKey, {
      slots,
      text: normalizeHubTextStyle(draftText),
      scale: normalizeHubScale(assignment?.scale ?? 1),
      natural,
      popout: assignment?.popout ?? { ...DEFAULT_HUB_POPOUT_RULES },
      updatedAt: assignment?.updatedAt ?? new Date().toISOString()
    });
    if (!compiledSkin || !prefs.showHitbox) {
      return compiledSkin;
    }
    // "Show hitbox": ride the real imported-skin pipeline into the shadow
    // root so the outline sits on the rendered interactive core itself — the
    // outlined rect IS the clickable hitbox, scaled exactly as rendered.
    return { ...compiledSkin, css: `${compiledSkin.css}\n${HITBOX_OVERLAY_CSS}` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    addressKey,
    hasSkin,
    slots,
    draftText,
    assignment?.scale,
    assignment?.updatedAt,
    assignment?.natural,
    assignment?.popout,
    previewMetrics,
    prefs.showHitbox
  ]);

  const handlePreviewMeasure = useCallback((metrics: InstanceMetrics | null) => {
    setPreviewMetrics((current) => (metricsEqual(current, metrics) ? current : metrics));
  }, []);

  // The bench is the measuring instrument: record the skin's natural core
  // size (scale 1, real label) into the assignment so the live compile can
  // derive footprints from natural × scale. Converges because the write is
  // skipped once the stored value matches the measurement.
  useEffect(() => {
    if (!addressKey || !assignment || !previewMetrics || !compiled.structureValid) {
      return;
    }
    // The bench renders the DRAFT text so the preview tracks the sliders
    // live; persist natural only once the draft matches the stored text,
    // otherwise a draft-sized natural would corrupt live-surface footprints
    // for a text style that was never applied.
    if (textDraftDirty) {
      return;
    }
    const width = Math.round(previewMetrics.coreWidth);
    const height = Math.round(previewMetrics.coreHeight);
    if (width <= 0 || height <= 0) {
      return;
    }
    if (assignment.natural?.width === width && assignment.natural?.height === height) {
      return;
    }
    commitAssignments({
      ...assignments,
      [addressKey]: { ...assignment, natural: { width, height } }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey, assignment, previewMetrics, compiled.structureValid, textDraftDirty]);

  const stageBackgroundClass: Record<HubUiPrefs["background"], string> = {
    main: "ahub-stage--bg-main",
    dark: "ahub-stage--bg-dark",
    light: "ahub-stage--bg-light"
  };
  const stageStyle: CSSProperties =
    prefs.background === "main" ? { backgroundImage: `url(${mainBackground})` } : {};

  const currentLookSkin =
    placement === "main" ? DEFAULT_FLOW_IMPORTED_SKIN : DEFAULT_POPOUT_IMPORTED_SKIN;

  const structureErrors = compiled.slotErrors[STRUCTURE_SLOT_ID] ?? [];
  const keyframesErrors = compiled.slotErrors[KEYFRAMES_SLOT_ID] ?? [];

  const hasCodeAt = (buttonKey: string, forPlacement: HubPlacement): boolean => {
    if (!prefs.programName || !prefs.panelName) {
      return false;
    }
    return Boolean(
      assignments[buildHubAddressKey(prefs.programName, prefs.panelName, buttonKey, forPlacement)]
    );
  };

  const buttonHasAnyCode = (buttonKey: string): boolean =>
    placementsForButton(buttonKey).some((forPlacement) => hasCodeAt(buttonKey, forPlacement));

  const startResizeDrag =
    (direction: ResizeDirection) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void getCurrentWindow().startResizeDragging(direction);
    };

  const handleShellPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    void getCurrentWindow().setFocus().catch(() => {});
    if (!spaceDragActive) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".ahub-resize-handle")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow()
      .startDragging()
      .catch(() => setSpaceDragging(false));
  };

  const togglePin = (state: StateSlotId) => {
    setPrefs((current) => ({
      ...current,
      pinnedStates: current.pinnedStates.includes(state)
        ? current.pinnedStates.filter((entry) => entry !== state)
        : [...current.pinnedStates, state]
    }));
  };

  const toggleSlotOpen = (slotId: SlotId, open: boolean) => {
    setPrefs((current) => ({
      ...current,
      openSlots: { ...current.openSlots, [slotId]: open }
    }));
  };

  const slotEditor = (slotId: SlotId, title: string, hint: string, extraClass = "") => {
    const errors = compiled.slotErrors[slotId] ?? [];
    const filled = Boolean(slots[slotId].trim());
    return (
      <details
        key={slotId}
        className="ahub-fold"
        open={prefs.openSlots[slotId] ?? false}
        onToggle={(event) => toggleSlotOpen(slotId, (event.target as HTMLDetailsElement).open)}
      >
        <summary className="ahub-fold__head">
          <span className={`ahub-fold__dot${filled ? " ahub-fold__dot--on" : ""}${errors.length > 0 ? " ahub-fold__dot--error" : ""}`} />
          <span className="ahub-fold__name">{title}</span>
          <span className="ahub-fold__hint">{errors.length > 0 ? errors[0] : hint}</span>
        </summary>
        <textarea
          className={`ahub-code ${extraClass}${errors.length > 0 ? " ahub-code--invalid" : ""}`}
          value={slots[slotId]}
          onChange={(event) => updateAssignmentSlots(slotId, event.target.value)}
          spellCheck={false}
        />
        {errors.map((error) => (
          <p key={error} className="ahub-err">
            {error}
          </p>
        ))}
      </details>
    );
  };

  const codeFilledCount = [STRUCTURE_SLOT_ID, KEYFRAMES_SLOT_ID, ...STATE_SLOT_IDS].filter(
    (slotId) => slots[slotId as SlotId].trim().length > 0
  ).length;
  const codeErrorCount = Object.values(compiled.slotErrors).reduce(
    (total, errors) => total + (errors?.length ?? 0),
    0
  );

  return (
    <div
      className={[
        "ahub",
        spaceDragActive ? "ahub--space-drag" : "",
        spaceDragging ? "ahub--dragging" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDownCapture={handleShellPointerDown}
      onPointerUp={() => setSpaceDragging(false)}
      onPointerCancel={() => setSpaceDragging(false)}
    >
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle.modifier}
          className={`ahub-resize-handle ahub-resize-handle--${handle.modifier}`}
          onPointerDown={startResizeDrag(handle.direction)}
        />
      ))}

      <header className="ahub-titlebar">
        <div className="ahub-titlebar__brand">
          <span className="ahub-titlebar__pip" aria-hidden="true" />
          <span className="ahub-titlebar__name">Appearance</span>
          <span className="ahub-titlebar__scope">skin bench · v12 · socket</span>
        </div>
        <div className="ahub-titlebar__actions">
          <button
            type="button"
            className="ahub-btn ahub-btn--quiet"
            title="Open the rail motion settings window"
            onClick={() => void openAppearanceWindow().catch(() => {})}
          >
            Motion settings
          </button>
          <button
            type="button"
            className="ahub-titlebar__close"
            title="Close the Appearance window"
            aria-label="Close"
            onClick={() => void getCurrentWindow().close().catch(() => {})}
          >
            ×
          </button>
        </div>
      </header>

      <div className="ahub-body">
        {/* ---- selector rail ---- */}
        <div className="ahub-rail">
          <div className="ahub-rail__field">
            <span className="ahub-label">Program</span>
            <select
              className="ahub-select"
              value={prefs.programName}
              onChange={(event) => setPrefs((current) => ({ ...current, programName: event.target.value }))}
            >
              {programs.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="ahub-rail__field">
            <span className="ahub-label">Panel</span>
            <select
              className="ahub-select"
              value={prefs.panelName}
              onChange={(event) => setPrefs((current) => ({ ...current, panelName: event.target.value }))}
            >
              {panels.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="ahub-rail__field">
            <span className="ahub-label">Button</span>
            <select
              className="ahub-select"
              value={prefs.buttonKey}
              onChange={(event) => setPrefs((current) => ({ ...current, buttonKey: event.target.value }))}
            >
              <option value={HUB_PANEL_BUTTON_KEY}>
                {`${buttonHasAnyCode(HUB_PANEL_BUTTON_KEY) ? "● " : ""}Panel button (${prefs.panelName || "—"})`}
              </option>
              {scriptRecords.map((record) => {
                const isToolset = Array.isArray(record.children) && record.children.length > 0;
                return (
                  <option key={record.fileName} value={record.fileName} disabled={isToolset}>
                    {`${buttonHasAnyCode(record.fileName) ? "● " : ""}${record.label || record.fileName}${isToolset ? " (toolset — later)" : ""}`}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="ahub-rail__field">
            <span className="ahub-label">Placement</span>
            <select
              className="ahub-select"
              value={placement}
              onChange={(event) => {
                const nextPlacement = event.target.value as HubPlacement;
                setPrefs((current) => ({ ...current, placement: nextPlacement }));
                setPreviewSurface(nextPlacement);
              }}
            >
              {availablePlacements.map((entry) => {
                const meta = HUB_PLACEMENTS.find((candidate) => candidate.id === entry);
                return (
                  <option key={entry} value={entry}>
                    {`${hasCodeAt(prefs.buttonKey, entry) ? "● " : ""}${meta?.label ?? entry}`}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="ahub-rail__actions">
            <button type="button" className="ahub-btn" onClick={() => void handleSaveSkin()}>
              Save skin…
            </button>
            <button type="button" className="ahub-btn" onClick={() => void handleLoadSkin()}>
              Load skin…
            </button>
            <button
              type="button"
              className="ahub-btn"
              disabled={!assignment}
              title="Copy this skin to every button in the panel at this placement"
              onClick={handleApplyToPanel}
            >
              Apply to panel
            </button>
            <button
              type="button"
              className="ahub-btn ahub-btn--danger"
              disabled={!assignment}
              onClick={handleRemoveSkin}
            >
              Remove skin
            </button>
            <button
              type="button"
              className="ahub-btn"
              title="Save every skin assignment of this panel (all buttons, all placements) to one setup file"
              onClick={() => void handleSaveSetup()}
            >
              Save setup…
            </button>
            <button
              type="button"
              className="ahub-btn"
              title="Load a setup file onto this panel, replacing its current skin assignments"
              onClick={() => void handleLoadSetup()}
            >
              Load setup…
            </button>
          </div>
          {statusMessage ? <p className="ahub-rail__status">{statusMessage}</p> : null}
        </div>

        {/* ---- editor column ---- */}
        <div className="ahub-editor">
          <section className="ahub-sec">
            <div className="ahub-sec__head">
              <h2 className="ahub-sec__title">Paste skin</h2>
              <span className="ahub-sec__hint">
                {realButtonLabel} · {HUB_PLACEMENTS.find((entry) => entry.id === placement)?.label}
              </span>
            </div>
            <textarea
              className="ahub-code ahub-code--paste"
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={"=== structure ===\n<div data-core>{{label}}</div>\n=== play ===\n--anim-x: my-spin 1s linear 1;"}
              spellCheck={false}
            />
            <div className="ahub-row">
              <button type="button" className="ahub-btn" onClick={handleApplyPaste}>
                Apply paste to this button
              </button>
            </div>
          </section>

          <section className="ahub-sec">
            <div className="ahub-sec__head">
              <h2 className="ahub-sec__title">Text</h2>
              <span className="ahub-sec__hint">preview updates live; Apply stores it</span>
            </div>
            <div className="ahub-row">
              <span className="ahub-label">Font</span>
              <select
                className="ahub-select"
                value={draftText.fontFamily ?? ""}
                onChange={(event) =>
                  setDraftText((current) => ({
                    ...current,
                    fontFamily: event.target.value || null
                  }))
                }
              >
                <option value="">Skin default</option>
                {fontFamilies.map((family) => (
                  <option key={family} value={family} style={{ fontFamily: family }}>
                    {family}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ahub-btn ahub-btn--quiet"
                title="List every installed font"
                onClick={() => void handleLoadSystemFonts()}
              >
                All fonts
              </button>
            </div>
            <div className="ahub-row">
              <span className="ahub-label">Lines</span>
              {[1, 2].map((lines) => (
                <button
                  key={lines}
                  type="button"
                  className={`ahub-chip${draftText.lines === lines ? " ahub-chip--on" : ""}`}
                  onClick={() => setDraftText((current) => ({ ...current, lines: lines as 1 | 2 }))}
                >
                  {lines === 1 ? "One row" : "Two rows"}
                </button>
              ))}
              <label className="ahub-check" style={{ marginLeft: "auto" }}>
                <input
                  type="checkbox"
                  checked={draftText.fontSizePx !== null}
                  onChange={(event) =>
                    setDraftText((current) => ({
                      ...current,
                      fontSizePx: event.target.checked ? 13 : null
                    }))
                  }
                />
                Size
              </label>
            </div>
            {draftText.fontSizePx !== null ? (
              <div className="ahub-row">
                <input
                  className="ahub-range"
                  type="range"
                  min={8}
                  max={40}
                  step={1}
                  value={draftText.fontSizePx}
                  onChange={(event) =>
                    setDraftText((current) => ({ ...current, fontSizePx: Number(event.target.value) }))
                  }
                />
                <span className="ahub-label">{draftText.fontSizePx}px</span>
              </div>
            ) : null}
            <div className="ahub-row">
              <span className="ahub-label">Label</span>
              <input
                className="ahub-input"
                type="text"
                placeholder="No text"
                value={draftText.labelOverride ?? realButtonLabel}
                onChange={(event) =>
                  setDraftText((current) => ({
                    ...current,
                    labelOverride: event.target.value
                  }))
                }
              />
              <button
                type="button"
                className="ahub-btn ahub-btn--quiet"
                title="Use the button's normal label"
                onClick={() =>
                  setDraftText((current) => ({
                    ...current,
                    labelOverride: null
                  }))
                }
              >
                Use name
              </button>
              <button
                type="button"
                className={`ahub-btn${textDraftDirty ? "" : " ahub-btn--quiet"}`}
                disabled={!textDraftDirty || !assignment}
                title={assignment ? "Apply text settings to this button" : "Add skin code first"}
                onClick={applyTextDraft}
              >
                Apply text
              </button>
            </div>
          </section>

          {placement === "popped-group" || placement === "popped-single" ? (
            <section className="ahub-sec">
              <div className="ahub-sec__head">
                <h2 className="ahub-sec__title">Popout rules</h2>
                <span className="ahub-sec__hint">
                  {placement === "popped-group"
                    ? "grid cell: every button identical, text fits per button"
                    : "cell: fill the standard popped pill, text fits"}
                </span>
              </div>
              <div className="ahub-row">
                <span className="ahub-label">Size</span>
                <button
                  type="button"
                  className={`ahub-chip${(assignment?.popout.sizing ?? "natural") === "natural" ? " ahub-chip--on" : ""}`}
                  disabled={!assignment}
                  title="The skin renders at its own natural size × Scale"
                  onClick={() => updateAssignmentRules({ sizing: "natural" })}
                >
                  Skin size
                </button>
                <button
                  type="button"
                  className={`ahub-chip${assignment?.popout.sizing === "cell" ? " ahub-chip--on" : ""}`}
                  disabled={!assignment}
                  title="The skin fills the popout's uniform grid cell — all buttons the same size"
                  onClick={() => updateAssignmentRules({ sizing: "cell" })}
                >
                  Uniform grid cell
                </button>
              </div>
              {assignment?.popout.sizing === "cell" ? (
                <div className="ahub-row">
                  <span className="ahub-label">Text fit</span>
                  {(
                    [
                      { id: "shrink", label: "Shrink text" },
                      { id: "stack", label: "Stack words" },
                      { id: "shrink-stack", label: "Shrink + stack" }
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`ahub-chip${assignment.popout.textFit === option.id ? " ahub-chip--on" : ""}`}
                      onClick={() => updateAssignmentRules({ textFit: option.id })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="ahub-sec">
            <div className="ahub-sec__head">
              <h2 className="ahub-sec__title">Scale</h2>
              <span className="ahub-sec__hint">uniform — skin keeps its shape</span>
            </div>
            <div className="ahub-row">
              <input
                className="ahub-range"
                type="range"
                min={0.2}
                max={4}
                step={0.05}
                disabled={!assignment}
                value={assignment?.scale ?? 1}
                onChange={(event) => updateAssignmentScale(normalizeHubScale(Number(event.target.value)))}
              />
              <span className="ahub-label">{(assignment?.scale ?? 1).toFixed(2)}×</span>
              <button
                type="button"
                className="ahub-btn ahub-btn--quiet"
                disabled={!assignment || (assignment?.scale ?? 1) === 1}
                onClick={() => updateAssignmentScale(1)}
              >
                Reset
              </button>
            </div>
          </section>

          <details
            className="ahub-fold ahub-fold--master"
            open={prefs.codeOpen}
            onToggle={(event) =>
              setPrefs((current) => ({
                ...current,
                codeOpen: (event.target as HTMLDetailsElement).open
              }))
            }
          >
            <summary className="ahub-fold__head">
              <span className="ahub-fold__name">Code</span>
              <span className="ahub-fold__hint">
                {codeFilledCount} filled{codeErrorCount > 0 ? ` · ${codeErrorCount} errors` : ""}
              </span>
            </summary>
            <div className="ahub-fold__body">
              {slotEditor(STRUCTURE_SLOT_ID, "structure", "{{label}} + one data-core", "ahub-code--structure")}
              {slotEditor(KEYFRAMES_SLOT_ID, "keyframes", "@keyframes only")}
              {STATE_SLOT_IDS.map((slotId) => slotEditor(slotId, slotId, STATE_SLOT_HINTS[slotId]))}
            </div>
          </details>
        </div>

        {/* ---- preview column ---- */}
        <div className="ahub-preview">
          <div
            className={["ahub-stage", stageBackgroundClass[prefs.background]]
              .filter(Boolean)
              .join(" ")}
            style={stageStyle}
          >
            <style>{compiled.css}</style>
            {Boolean(previewSurface) ? (
              <div className="ahub-stage__center">
                {!hasSkin ? <span className="ahub-stage__badge">current look · no bench code</span> : null}
                <LiveAddressPlacementPreview
                  surface={previewSurface}
                  assignments={assignments}
                  currentButtonKey={prefs.buttonKey}
                  currentPlacement={placement}
                  liveSkin={liveSkin}
                  selectedLabelOverride={draftText.labelOverride ?? undefined}
                  panelLabel={panelLabel}
                  previewLabel={previewLabel}
                  programName={prefs.programName}
                  panelName={prefs.panelName}
                  scriptRecords={scriptRecords}
                  fanOptions={fanPreviewOptions}
                />
                {/* Hidden measuring instrument: the bench render still measures
                    the skin's natural core size (feeds footprints above). */}
                <div className="ahub-measure" aria-hidden="true">
                  <SkinInstance
                    scopeClass={scopeClass}
                    html={previewHtml}
                    pinned={prefs.pinnedStates}
                    onMeasure={handlePreviewMeasure}
                  />
                </div>
                <div className="ahub-rowhost__stats">
                  core{" "}
                  <b>
                    {previewMetrics
                      ? `${Math.round(previewMetrics.coreWidth)}×${Math.round(previewMetrics.coreHeight)}`
                      : "—"}
                  </b>
                </div>
              </div>
            ) : (
              <div className="ahub-stage__center">
                <span className="ahub-stage__badge">current look · no bench code</span>
                <HostSkinButton
                  label={previewLabel}
                  importedSkin={currentLookSkin}
                  hostMode="neutral"
                  style={{ width: 189, height: 58 }}
                />
                {structureErrors.length > 0 && assignment ? (
                  <p className="ahub-stage-empty">{structureErrors[0]}</p>
                ) : null}
              </div>
            )}
          </div>

          {/* Button picker: THE selector. The preview above stays untouched —
              no rings, no reordering — pick the button to edit down here. */}
          <div className="ahub-toolrow ahub-picker">
            <span className="ahub-label">Button</span>
            <button
              type="button"
              className={`ahub-chip${prefs.buttonKey === HUB_PANEL_BUTTON_KEY ? " ahub-chip--on" : ""}`}
              onClick={() =>
                setPrefs((current) => ({ ...current, buttonKey: HUB_PANEL_BUTTON_KEY }))
              }
            >
              {`${buttonHasAnyCode(HUB_PANEL_BUTTON_KEY) ? "● " : ""}Panel button`}
            </button>
            {scriptRecords
              .filter((record) => !isToolsetRecord(record))
              .map((record) => (
                <button
                  key={record.fileName}
                  type="button"
                  className={`ahub-chip${prefs.buttonKey === record.fileName ? " ahub-chip--on" : ""}`}
                  onClick={() =>
                    setPrefs((current) => ({ ...current, buttonKey: record.fileName }))
                  }
                >
                  {`${buttonHasAnyCode(record.fileName) ? "● " : ""}${panelScriptLabel(record)}`}
                </button>
              ))}
          </div>

          <div className="ahub-toolrow">
            <span className="ahub-label">Preview as</span>
            {HUB_PLACEMENTS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`ahub-chip${previewSurface === entry.id ? " ahub-chip--on" : ""}`}
                onClick={() => setPreviewSurface(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="ahub-toolrow">
            <span className="ahub-label">Pin</span>
            {PIN_CHOICES.map((state) => (
              <button
                key={state}
                type="button"
                className={`ahub-chip${prefs.pinnedStates.includes(state) ? " ahub-chip--on" : ""}`}
                title={STATE_SLOT_HINTS[state]}
                onClick={() => togglePin(state)}
              >
                {state}
              </button>
            ))}
            <span className="ahub-toolrow__spacer" />
            {(["dark", "light", "main"] as const).map((background) => (
              <button
                key={background}
                type="button"
                className={`ahub-chip${prefs.background === background ? " ahub-chip--on" : ""}`}
                onClick={() => setPrefs((current) => ({ ...current, background }))}
              >
                {background}
              </button>
            ))}
            <label className="ahub-check">
              <input
                type="checkbox"
                checked={prefs.showHitbox}
                onChange={(event) =>
                  setPrefs((current) => ({ ...current, showHitbox: event.target.checked }))
                }
              />
              Hitbox
            </label>
            {keyframesErrors.length > 0 ? (
              <span className="ahub-warn-text">{keyframesErrors[0]}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
