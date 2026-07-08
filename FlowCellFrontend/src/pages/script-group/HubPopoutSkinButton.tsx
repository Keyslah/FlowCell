// HubPopoutSkinButton — the popout skin lane.
//
// Hub-authored skins in script-group popouts render through THIS component and
// nothing else. It is deliberately separate from the shared imported-skin
// engine (HostSkinButton / ImportedButtonSkinRoot): no shadow DOM, no sizing
// modes, no style groups, no event bridge. It copies the hub bench's proven
// mechanics — the same compiled state CSS gated by data-attributes on a plain
// wrapper, the same play latch — and owns its sizing directly:
//
//   cell mode ("Uniform grid cell", the default): the wrapper IS the template
//   cell; every element from the content root down to the data-core is pinned
//   to 100% with inline !important styles (inline always beats skin CSS), and
//   the label is fitted by font-shrink and/or word-wrap per the textFit rule.
//
//   natural mode ("Skin size"): the skin renders at its own size × the user
//   scale, centered on the cell, never forced to fit.
//
// Its only contact with the appearance system is SkinPort (compile helpers +
// the stored assignment type).
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  STRUCTURE_SLOT_ID,
  buildScopeClassName,
  compileSkin,
  renderStructureHtmlWithLines,
  type HubAssignment
} from "../appearance-hub/SkinPort";
import "./scriptGroupPopoutWindowPage.css";

const HELD_DELAY_MS = 400;
const RELEASE_FLASH_MS = 280;
const PLAY_GRACE_MS = 300;
const PLAY_MAX_MS = 15_000;
const PLAY_SETTLE_MS = 180;
// Canonical units (the popout surface scales visually via CSS transform).
const MIN_FIT_FONT_PX = 6;
const FIT_GUARD_STEPS = 60;

export type HubPopoutSkinCell = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type HubPopoutSkinButtonProps = {
  // Unique, stable per button — becomes the CSS scope token.
  instanceKey: string;
  assignment: HubAssignment;
  fallbackLabel: string;
  fileName: string;
  tooltip?: string;
  cell: HubPopoutSkinCell;
  onActivate: (fileName: string) => void;
  onHoverStart?: (fileName: string) => void;
  onHoverEnd?: (fileName: string) => void;
};

// Pin an element to fill its parent. Inline styles with the "important"
// priority outrank ANY stylesheet rule, including the skin's own inline
// style attribute values — this is what makes cell sizing untouchable.
function pinToFill(element: HTMLElement, isCore: boolean) {
  element.style.setProperty("width", "100%", "important");
  element.style.setProperty("height", "100%", "important");
  element.style.setProperty("box-sizing", "border-box", "important");
  element.style.setProperty("min-width", "0", "important");
  element.style.setProperty("min-height", "0", "important");
  element.style.setProperty("margin", "0", "important");
  if (!isCore) {
    // Decorative wrappers give up their padding so the core reaches the cell
    // edges; the core keeps its own padding (part of the button's look).
    element.style.setProperty("padding", "0", "important");
  } else {
    element.style.setProperty("overflow", "hidden", "important");
  }
}

function coreOverflows(core: HTMLElement): boolean {
  return (
    core.scrollWidth > core.clientWidth + 0.5 ||
    core.scrollHeight > core.clientHeight + 0.5
  );
}

export function HubPopoutSkinButton({
  instanceKey,
  assignment,
  fallbackLabel,
  fileName,
  tooltip,
  cell,
  onActivate,
  onHoverStart,
  onHoverEnd
}: HubPopoutSkinButtonProps) {
  const instRef = useRef<HTMLDivElement | null>(null);
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

  const label = assignment.text.labelOverride ?? fallbackLabel;
  const sizing = assignment.popout.sizing;
  const textFit = assignment.popout.textFit;

  const html = useMemo(
    () =>
      renderStructureHtmlWithLines(
        assignment.slots[STRUCTURE_SLOT_ID],
        label,
        assignment.text.lines
      ),
    [assignment.slots, label, assignment.text.lines]
  );
  const scopeClass = useMemo(() => buildScopeClassName(instanceKey), [instanceKey]);
  const compiled = useMemo(
    () =>
      compileSkin(
        instanceKey,
        assignment.slots,
        assignment.text.fontSizePx,
        assignment.text.fontFamily,
        ".fc-popskin"
      ),
    [instanceKey, assignment.slots, assignment.text.fontSizePx, assignment.text.fontFamily]
  );

  // ---- play latch (bench mechanics: epoch remount so a round runs once) ----

  const stopPlay = () => {
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
  };

  const schedulePlaySettleCheck = () => {
    if (playSettleTimerRef.current !== null) {
      window.clearTimeout(playSettleTimerRef.current);
    }
    playSettleTimerRef.current = window.setTimeout(() => {
      playSettleTimerRef.current = null;
      if (!playingRef.current) {
        return;
      }
      const inst = instRef.current;
      const stillRunning = inst
        ? document.getAnimations().some((animation) => {
            const target =
              animation.effect && "target" in animation.effect ? animation.effect.target : null;
            return (
              target instanceof Node && inst.contains(target) && animation.playState === "running"
            );
          })
        : false;
      if (!stillRunning) {
        stopPlay();
      }
    }, PLAY_SETTLE_MS);
  };

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

  // ---- sizing + text fit (the popout owns the size, period) ----

  useLayoutEffect(() => {
    const inst = instRef.current;
    const content = inst?.firstElementChild as HTMLElement | null;
    const core = inst?.querySelector<HTMLElement>("[data-core]") ?? null;
    if (!inst || !content || !core) {
      return;
    }

    // Restore an element's ORIGINAL inline style before re-fitting. The skin
    // author's look lives in the style attribute (font, nowrap, padding…);
    // mutating and then removeProperty()-ing would delete the author's own
    // values, so the first touch stashes the attribute and every re-fit
    // starts from that pristine state.
    const restoreBaseStyle = (element: HTMLElement) => {
      const saved = element.dataset.fcBaseStyle;
      if (saved === undefined) {
        element.dataset.fcBaseStyle = element.getAttribute("style") ?? "";
        return;
      }
      if (saved) {
        element.setAttribute("style", saved);
      } else {
        element.removeAttribute("style");
      }
    };

    const applyFit = () => {
      // Reset everything this fit ever touched back to the author's state.
      const chain: HTMLElement[] = [];
      let node: HTMLElement | null = core;
      while (node && node !== inst) {
        chain.push(node);
        node = node.parentElement;
      }
      for (const element of chain) {
        restoreBaseStyle(element);
      }

      if (sizing !== "cell") {
        return;
      }

      // Pin the whole chain from the injected content root down to the core.
      for (const element of chain) {
        pinToFill(element, element === core);
      }

      // Fit the label inside the now cell-sized core.
      const allowStack = textFit !== "shrink";
      const allowShrink = textFit !== "stack";
      if (allowStack && coreOverflows(core) && label.trim().split(/\s+/).length >= 2) {
        core.style.setProperty("white-space", "normal", "important");
        core.style.setProperty("line-height", "1.05", "important");
      }
      if (allowShrink) {
        let size = Number.parseFloat(window.getComputedStyle(core).fontSize) || 13;
        let guard = 0;
        while (coreOverflows(core) && size > MIN_FIT_FONT_PX && guard < FIT_GUARD_STEPS) {
          size = Math.max(MIN_FIT_FONT_PX, size - 0.5);
          core.style.setProperty("font-size", `${size}px`, "important");
          guard += 1;
        }
      }
    };

    applyFit();
    // Late font loads change text metrics; refit once fonts settle.
    let cancelled = false;
    void document.fonts?.ready?.then(() => {
      if (!cancelled) {
        applyFit();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [html, playEpoch, sizing, textFit, label, cell.width, cell.height, compiled.css]);

  // ---- interactions (direct listeners — no bridge) ----

  const clearHeldTimer = () => {
    if (heldTimerRef.current !== null) {
      window.clearTimeout(heldTimerRef.current);
      heldTimerRef.current = null;
    }
  };

  const handlePointerEnter = () => {
    setHovered(true);
    onHoverStart?.(fileName);
  };

  const handlePointerLeave = () => {
    clearHeldTimer();
    setHovered(false);
    setPressed(false);
    setHeld(false);
    onHoverEnd?.(fileName);
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

  // Epoch-keyed remount: React 19 re-applies dangerouslySetInnerHTML on every
  // re-render (restarting animations); memoizing the element prevents that,
  // and bumping the key at play start/end makes each round run exactly once.
  const skinContent = useMemo(
    () => <div key={playEpoch} className="fc-popskin__content" dangerouslySetInnerHTML={{ __html: html }} />,
    [html, playEpoch]
  );

  return (
    <div
      className="script-group-popout__button--hub fc-popskin"
      role="button"
      aria-label={label}
      data-script-file-name={fileName}
      data-flow-tooltip={tooltip?.trim() || label}
      style={{
        position: "absolute",
        left: `${cell.x}px`,
        top: `${cell.y}px`,
        width: `${cell.width}px`,
        height: `${cell.height}px`
      }}
    >
      <style>{compiled.css}</style>
      <div
        ref={instRef}
        className={`fc-popskin__inst ${scopeClass}`}
        data-hovered={hovered ? "true" : "false"}
        data-pressed={pressed ? "true" : "false"}
        data-held={held ? "true" : "false"}
        data-play={playing ? "true" : "false"}
        data-disabled="false"
        data-error="false"
        data-action-phase={releaseFlash ? "release" : "idle"}
        style={
          sizing === "natural"
            ? { transform: `scale(${assignment.scale})`, transformOrigin: "center center" }
            : undefined
        }
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerLeave}
        onClick={() => onActivate(fileName)}
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
    </div>
  );
}
