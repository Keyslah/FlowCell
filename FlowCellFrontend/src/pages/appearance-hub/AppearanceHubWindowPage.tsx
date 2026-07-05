// Appearance Hub — an isolated skin-authoring bench for popout and fan
// buttons. Skins pasted here render only inside this window's preview stage;
// no live FlowCell button, skin store, or state file is read from or written
// to (the sole exception: the titlebar button that opens the existing motion
// settings window).

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
import { getCurrentWindow } from "@tauri-apps/api/window";

import mainBackground from "../../assets/backgrounds/main-background.jpeg";
import { openAppearanceWindow } from "../../lib/windowing";
import {
  buildScopeClassName,
  compileSkin,
  renderStructureHtml,
  splitSlotPaste
} from "./compileSkin";
import {
  createStarterSkin,
  readHubState,
  writeHubState,
  type HubSkin,
  type HubState,
  type HubPrefs,
  type HubStageBackground
} from "./hubStore";
import { FAN_CHILD_LABELS, PREVIEW_CONTEXTS } from "./previewHosts";
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
// Play latch: if data-play produced no animation within the grace window the
// latch clears (the skin has no play slot), and a hard cap guards against
// runaway/infinite play animations that never fire animationend.
const PLAY_GRACE_MS = 300;
const PLAY_MAX_MS = 15_000;

type InstanceMetrics = {
  coreWidth: number;
  coreHeight: number;
  wrapWidth: number;
  wrapHeight: number;
};

type MeasureHandler = (index: number, metrics: InstanceMetrics | null) => void;

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

// One rendered skin instance. The wrapper is host-owned: it carries the scope
// class plus the live/pinned state attributes the compiled CSS keys off.
function SkinInstance({
  scopeClass,
  html,
  pinned,
  index,
  onMeasure
}: {
  scopeClass: string;
  html: string;
  pinned: readonly StateSlotId[];
  index: number;
  onMeasure?: MeasureHandler;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const heldTimerRef = useRef<number | null>(null);
  const releaseTimerRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [held, setHeld] = useState(false);
  const [releaseFlash, setReleaseFlash] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Each play remounts the skin DOM (key bump) at start AND end of the round.
  // Finished animations therefore never linger in the DOM, so later style
  // recalcs (hover/press attribute flips) have nothing to re-trigger.
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
    if (playGraceTimerRef.current !== null) {
      window.clearTimeout(playGraceTimerRef.current);
      playGraceTimerRef.current = null;
    }
    if (playCapTimerRef.current !== null) {
      window.clearTimeout(playCapTimerRef.current);
      playCapTimerRef.current = null;
    }
    if (playSettleTimerRef.current !== null) {
      window.clearTimeout(playSettleTimerRef.current);
      playSettleTimerRef.current = null;
    }
    setPlaying(false);
    setPlayEpoch((epoch) => epoch + 1);
  }, []);

  // Fallback for any start/end count imbalance (e.g. a restart swallowed an
  // end event): shortly after each animationend, if nothing inside the
  // instance is still running, the round is over regardless of the counter.
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
        ? document
            .getAnimations()
            .some((animation) => {
              const target = animation.effect && "target" in animation.effect ? animation.effect.target : null;
              return target instanceof Node && wrapper.contains(target) && animation.playState === "running";
            })
        : false;
      if (!stillRunning) {
        stopPlay();
      }
    }, 180);
  }, [stopPlay]);

  // One play per click; the latch survives pointer leave and release so a
  // started one-shot always finishes before it can trigger again.
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
      if (heldTimerRef.current !== null) {
        window.clearTimeout(heldTimerRef.current);
      }
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
      }
      if (playGraceTimerRef.current !== null) {
        window.clearTimeout(playGraceTimerRef.current);
      }
      if (playCapTimerRef.current !== null) {
        window.clearTimeout(playCapTimerRef.current);
      }
      if (playSettleTimerRef.current !== null) {
        window.clearTimeout(playSettleTimerRef.current);
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
      onMeasure(index, null);
      return;
    }
    const report = () => {
      onMeasure(index, {
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
  }, [html, index, onMeasure, playEpoch]);

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

  // Memoized element: re-renders of this wrapper (hover/press/release attr
  // flips) hand React the IDENTICAL child element so it bails out without
  // touching the skin DOM. Without this, React 19 re-applies
  // dangerouslySetInnerHTML on every render (fresh {__html} wrapper object),
  // recreating the children and restarting every CSS animation from zero —
  // the "glitch start / runs again on hover-leave" bug.
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

// Popout: a single button — the bench label, nothing else. The measured core
// (= the hitbox) is shown beneath it.
function PopoutPreview({
  scopeClass,
  htmlByLabel,
  label,
  pinned
}: {
  scopeClass: string;
  htmlByLabel: (label: string) => string;
  label: string;
  pinned: readonly StateSlotId[];
}) {
  const [metrics, setMetrics] = useState<InstanceMetrics | null>(null);

  const handleMeasure = useCallback<MeasureHandler>((_index, next) => {
    setMetrics((current) => (metricsEqual(current, next) ? current : next));
  }, []);

  return (
    <div className="ahub-rowhost">
      <div className="ahub-rowhost__frame">
        <SkinInstance
          scopeClass={scopeClass}
          html={htmlByLabel(label)}
          pinned={pinned}
          index={0}
          onMeasure={handleMeasure}
        />
      </div>
      <div className="ahub-rowhost__stats">
        core{" "}
        <b>{metrics ? `${Math.round(metrics.coreWidth)}×${Math.round(metrics.coreHeight)}` : "—"}</b>
        {" · footprint "}
        <b>{metrics ? `${Math.round(metrics.wrapWidth)}×${Math.round(metrics.wrapHeight)}` : "—"}</b>
      </div>
    </div>
  );
}

// Fan: owner pill plus child pills in the same skin. The collapsed native
// window in the real app equals the owner footprint; the note shows the
// measured owner core so that consequence stays visible while editing.
function FanPreview({
  scopeClass,
  htmlByLabel,
  ownerLabel,
  pinned,
  expanded
}: {
  scopeClass: string;
  htmlByLabel: (label: string) => string;
  ownerLabel: string;
  pinned: readonly StateSlotId[];
  expanded: boolean;
}) {
  const [ownerMetrics, setOwnerMetrics] = useState<InstanceMetrics | null>(null);

  const handleMeasure = useCallback<MeasureHandler>((_index, next) => {
    setOwnerMetrics((current) => (metricsEqual(current, next) ? current : next));
  }, []);

  return (
    <div className="ahub-fanhost">
      <div className="ahub-fanhost__owner">
        <SkinInstance
          scopeClass={scopeClass}
          html={htmlByLabel(ownerLabel)}
          pinned={pinned}
          index={0}
          onMeasure={handleMeasure}
        />
      </div>
      <div className="ahub-fanhost__collapsed-note">
        collapsed window = owner core{" "}
        <b>
          {ownerMetrics
            ? `${Math.round(ownerMetrics.coreWidth)}×${Math.round(ownerMetrics.coreHeight)}`
            : "—"}
        </b>
        {" · footprint "}
        <b>
          {ownerMetrics
            ? `${Math.round(ownerMetrics.wrapWidth)}×${Math.round(ownerMetrics.wrapHeight)}`
            : "—"}
        </b>
      </div>
      {expanded ? (
        <div className="ahub-fanhost__children">
          {FAN_CHILD_LABELS.map((label, index) => (
            <SkinInstance
              key={label}
              scopeClass={scopeClass}
              html={htmlByLabel(label)}
              pinned={pinned}
              index={index + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AppearanceHubWindowPage() {
  const [hubState, setHubState] = useState<HubState>(() => readHubState());
  const [pasteText, setPasteText] = useState("");
  const [pasteReport, setPasteReport] = useState<string | null>(null);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);

  useEffect(() => {
    writeHubState(hubState);
  }, [hubState]);

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

  const selectedSkin = useMemo<HubSkin>(() => {
    return (
      hubState.skins.find((skin) => skin.id === hubState.selectedSkinId) ?? hubState.skins[0]
    );
  }, [hubState.skins, hubState.selectedSkinId]);

  const compiled = useMemo(
    () => compileSkin(selectedSkin.id, selectedSkin.slots, selectedSkin.text.fontSizePx),
    [selectedSkin.id, selectedSkin.slots, selectedSkin.text.fontSizePx]
  );

  const scopeClass = useMemo(() => buildScopeClassName(selectedSkin.id), [selectedSkin.id]);

  const htmlByLabel = useCallback(
    (label: string) =>
      renderStructureHtml(selectedSkin.slots[STRUCTURE_SLOT_ID], label, selectedSkin.text.stacked),
    [selectedSkin.slots, selectedSkin.text.stacked]
  );

  const updateSelectedSkin = (patch: (skin: HubSkin) => HubSkin) => {
    setHubState((current) => ({
      ...current,
      skins: current.skins.map((skin) =>
        skin.id === selectedSkin.id ? { ...patch(skin), updatedAt: new Date().toISOString() } : skin
      )
    }));
  };

  const updateSlot = (slotId: SlotId, value: string) => {
    updateSelectedSkin((skin) => ({ ...skin, slots: { ...skin.slots, [slotId]: value } }));
  };

  const updatePrefs = (patch: Partial<HubPrefs>) => {
    setHubState((current) => ({ ...current, prefs: { ...current.prefs, ...patch } }));
  };

  const handleNewSkin = () => {
    const skin = { ...createStarterSkin(), name: `Skin ${hubState.skins.length + 1}` };
    setHubState((current) => ({
      ...current,
      skins: [...current.skins, skin],
      selectedSkinId: skin.id
    }));
  };

  const handleDeleteSkin = () => {
    if (!window.confirm(`Delete "${selectedSkin.name}" from the hub? This only affects the bench.`)) {
      return;
    }
    setHubState((current) => {
      const remaining = current.skins.filter((skin) => skin.id !== selectedSkin.id);
      const skins = remaining.length > 0 ? remaining : [createStarterSkin()];
      return { ...current, skins, selectedSkinId: skins[0].id };
    });
  };

  const handleApplyPaste = () => {
    const { slots, unknownSections } = splitSlotPaste(pasteText);
    const appliedSlots = Object.keys(slots) as SlotId[];
    if (appliedSlots.length === 0) {
      setPasteReport("No `=== slot ===` sections found — nothing applied.");
      return;
    }
    updateSelectedSkin((skin) => ({ ...skin, slots: { ...skin.slots, ...slots } }));
    const parts = [`Applied: ${appliedSlots.join(", ")}.`];
    if (unknownSections.length > 0) {
      parts.push(`Ignored unknown sections: ${unknownSections.join(", ")}.`);
    }
    setPasteReport(parts.join(" "));
  };

  const togglePin = (state: StateSlotId) => {
    updatePrefs({
      pinnedStates: hubState.prefs.pinnedStates.includes(state)
        ? hubState.prefs.pinnedStates.filter((entry) => entry !== state)
        : [...hubState.prefs.pinnedStates, state]
    });
  };

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

  const prefs = hubState.prefs;
  const stageBackgroundClass: Record<HubStageBackground, string> = {
    main: "ahub-stage--bg-main",
    dark: "ahub-stage--bg-dark",
    light: "ahub-stage--bg-light"
  };
  const stageStyle: CSSProperties =
    prefs.background === "main" ? { backgroundImage: `url(${mainBackground})` } : {};

  const structureErrors = compiled.slotErrors[STRUCTURE_SLOT_ID] ?? [];
  const keyframesErrors = compiled.slotErrors[KEYFRAMES_SLOT_ID] ?? [];

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
          <span className="ahub-titlebar__scope">skin bench · v7</span>
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
        <div className="ahub-editor">
          <section className="ahub-sec">
            <div className="ahub-sec__head">
              <h2 className="ahub-sec__title">Skin</h2>
              <span className="ahub-sec__hint">bench-only, never applied live</span>
            </div>
            <div className="ahub-row">
              <select
                className="ahub-select"
                value={selectedSkin.id}
                onChange={(event) =>
                  setHubState((current) => ({ ...current, selectedSkinId: event.target.value }))
                }
              >
                {hubState.skins.map((skin) => (
                  <option key={skin.id} value={skin.id}>
                    {skin.name}
                  </option>
                ))}
              </select>
              <button type="button" className="ahub-btn" onClick={handleNewSkin}>
                New
              </button>
              <button type="button" className="ahub-btn ahub-btn--danger" onClick={handleDeleteSkin}>
                Delete
              </button>
            </div>
            <div className="ahub-row">
              <span className="ahub-label">Name</span>
              <input
                className="ahub-input"
                type="text"
                value={selectedSkin.name}
                onChange={(event) => updateSelectedSkin((skin) => ({ ...skin, name: event.target.value }))}
              />
            </div>
          </section>

          <section className="ahub-sec">
            <div className="ahub-sec__head">
              <h2 className="ahub-sec__title">Paste skin</h2>
              <span className="ahub-sec__hint">=== slot === sections</span>
            </div>
            <textarea
              className="ahub-code ahub-code--paste"
              value={pasteText}
              onChange={(event) => {
                setPasteText(event.target.value);
                setPasteReport(null);
              }}
              placeholder={"=== structure ===\n<div data-core>{{label}}</div>\n=== hover ===\n--fx-edge: #fff;"}
              spellCheck={false}
            />
            <div className="ahub-row">
              <button type="button" className="ahub-btn" onClick={handleApplyPaste}>
                Apply paste to slots
              </button>
              {pasteReport ? <span className="ahub-sec__hint">{pasteReport}</span> : null}
            </div>
          </section>

          <section className="ahub-sec">
            <div className="ahub-sec__head">
              <h2 className="ahub-sec__title">Structure</h2>
              <span className="ahub-sec__hint">{"{{label}} + one data-core"}</span>
            </div>
            <textarea
              className={`ahub-code ahub-code--structure${structureErrors.length > 0 ? " ahub-code--invalid" : ""}`}
              value={selectedSkin.slots[STRUCTURE_SLOT_ID]}
              onChange={(event) => updateSlot(STRUCTURE_SLOT_ID, event.target.value)}
              spellCheck={false}
            />
            {structureErrors.map((error) => (
              <p key={error} className="ahub-err">
                {error}
              </p>
            ))}
          </section>

          <section className="ahub-sec">
            <div className="ahub-sec__head">
              <h2 className="ahub-sec__title">Keyframes</h2>
              <span className="ahub-sec__hint">@keyframes only — gate via animation vars</span>
            </div>
            <textarea
              className={`ahub-code${keyframesErrors.length > 0 ? " ahub-code--invalid" : ""}`}
              value={selectedSkin.slots[KEYFRAMES_SLOT_ID]}
              onChange={(event) => updateSlot(KEYFRAMES_SLOT_ID, event.target.value)}
              placeholder={"@keyframes my-spin {\n  0% { transform: rotate(0deg); }\n  100% { transform: rotate(360deg); }\n}"}
              spellCheck={false}
            />
            {keyframesErrors.map((error) => (
              <p key={error} className="ahub-err">
                {error}
              </p>
            ))}
          </section>

          <section className="ahub-sec">
            <div className="ahub-sec__head">
              <h2 className="ahub-sec__title">Text bench</h2>
              <span className="ahub-sec__hint">label first — size and hitbox follow</span>
            </div>
            <div className="ahub-row">
              <span className="ahub-label">Label</span>
              <input
                className="ahub-input"
                type="text"
                value={selectedSkin.text.label}
                onChange={(event) =>
                  updateSelectedSkin((skin) => ({
                    ...skin,
                    text: { ...skin.text, label: event.target.value }
                  }))
                }
              />
            </div>
            <div className="ahub-row">
              <label className="ahub-check">
                <input
                  type="checkbox"
                  checked={selectedSkin.text.stacked}
                  onChange={(event) =>
                    updateSelectedSkin((skin) => ({
                      ...skin,
                      text: { ...skin.text, stacked: event.target.checked }
                    }))
                  }
                />
                Stack words
              </label>
              <label className="ahub-check">
                <input
                  type="checkbox"
                  checked={selectedSkin.text.fontSizePx !== null}
                  onChange={(event) =>
                    updateSelectedSkin((skin) => ({
                      ...skin,
                      text: { ...skin.text, fontSizePx: event.target.checked ? 13 : null }
                    }))
                  }
                />
                Override text size
              </label>
            </div>
            {selectedSkin.text.fontSizePx !== null ? (
              <div className="ahub-row">
                <input
                  className="ahub-range"
                  type="range"
                  min={8}
                  max={40}
                  step={1}
                  value={selectedSkin.text.fontSizePx}
                  onChange={(event) =>
                    updateSelectedSkin((skin) => ({
                      ...skin,
                      text: { ...skin.text, fontSizePx: Number(event.target.value) }
                    }))
                  }
                />
                <span className="ahub-label">{selectedSkin.text.fontSizePx}px</span>
              </div>
            ) : null}
          </section>

          <section className="ahub-sec">
            <div className="ahub-sec__head">
              <h2 className="ahub-sec__title">States</h2>
              <span className="ahub-sec__hint">declarations only — no selectors</span>
            </div>
            {STATE_SLOT_IDS.map((slotId) => {
              const errors = compiled.slotErrors[slotId] ?? [];
              return (
                <div key={slotId} className="ahub-slot">
                  <div className="ahub-slot__head">
                    <span className="ahub-slot__name">{slotId}</span>
                    <span className="ahub-slot__hint">{STATE_SLOT_HINTS[slotId]}</span>
                  </div>
                  <textarea
                    className={`ahub-code${errors.length > 0 ? " ahub-code--invalid" : ""}`}
                    value={selectedSkin.slots[slotId]}
                    onChange={(event) => updateSlot(slotId, event.target.value)}
                    spellCheck={false}
                  />
                  {errors.map((error) => (
                    <p key={error} className="ahub-err">
                      {error}
                    </p>
                  ))}
                </div>
              );
            })}
          </section>
        </div>

        <div className="ahub-preview">
          <div className="ahub-toolrow">
            {PREVIEW_CONTEXTS.map((context) => (
              <button
                key={context.id}
                type="button"
                className={`ahub-chip${prefs.context === context.id ? " ahub-chip--on" : ""}`}
                title={context.description}
                onClick={() => updatePrefs({ context: context.id })}
              >
                {context.label}
              </button>
            ))}
            <span className="ahub-toolrow__spacer" />
            {(["dark", "light", "main"] as const).map((background) => (
              <button
                key={background}
                type="button"
                className={`ahub-chip${prefs.background === background ? " ahub-chip--on" : ""}`}
                onClick={() => updatePrefs({ background })}
              >
                {background}
              </button>
            ))}
            <label className="ahub-check">
              <input
                type="checkbox"
                checked={prefs.showHitbox}
                onChange={(event) => updatePrefs({ showHitbox: event.target.checked })}
              />
              Hitbox
            </label>
          </div>

          <div className="ahub-toolrow">
            <span className="ahub-label">Pin state</span>
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
          </div>

          {prefs.context === "fan" ? (
            <div className="ahub-toolrow">
              <label className="ahub-check">
                <input
                  type="checkbox"
                  checked={prefs.fanExpanded}
                  onChange={(event) => updatePrefs({ fanExpanded: event.target.checked })}
                />
                Expanded fan
              </label>
            </div>
          ) : null}

          <div
            className={[
              "ahub-stage",
              stageBackgroundClass[prefs.background],
              prefs.showHitbox ? "ahub-stage--hitbox" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            style={stageStyle}
          >
            <style>{compiled.css}</style>
            {compiled.structureValid ? (
              prefs.context === "popout" ? (
                <PopoutPreview
                  scopeClass={scopeClass}
                  htmlByLabel={htmlByLabel}
                  label={selectedSkin.text.label}
                  pinned={prefs.pinnedStates}
                />
              ) : (
                <FanPreview
                  scopeClass={scopeClass}
                  htmlByLabel={htmlByLabel}
                  ownerLabel={selectedSkin.text.label}
                  pinned={prefs.pinnedStates}
                  expanded={prefs.fanExpanded}
                />
              )
            ) : (
              <p className="ahub-stage-empty">
                Fix the structure slot to see the preview —<br />
                it needs {"{{label}}"} and exactly one data-core element.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
