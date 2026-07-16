import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import type {
  ButtonCoreMeasurement,
  ButtonEditorMode,
  ButtonPlacement,
  ButtonRecord,
  ButtonSkin,
  ButtonToolField,
  ButtonVisualMeasurement,
  ButtonVisualState,
  JsonValue
} from "./types";
import { ButtonSkinRenderer } from "./skins/ButtonSkinRenderer";
import {
  executeButtonRecord,
  resolveButtonPressEventPlan,
  type ButtonExecutionResult
} from "./runtime/ButtonRuntimeAdapter";
import { isButtonWindowGeometryTransitionActive } from "./windows/buttonWindowGeometryTransition";

export interface ButtonHostProps {
  button: ButtonRecord;
  placement: ButtonPlacement;
  skin: ButtonSkin;
  mode?: ButtonEditorMode;
  selected?: boolean;
  constrained?: boolean;
  fields?: readonly ButtonToolField[];
  fieldValues?: Readonly<Record<string, JsonValue>>;
  onFieldPatch?: (
    patch: Readonly<Record<string, JsonValue>>,
    nextValues: Readonly<Record<string, JsonValue>>
  ) => void;
  onFieldActivate?: (
    field: ButtonToolField,
    currentValue: JsonValue
  ) => Promise<JsonValue | undefined>;
  onSelect?: (event: PointerEvent | KeyboardEvent) => void;
  onActivate?: (button: ButtonRecord, event: PointerEvent | KeyboardEvent) => void | Promise<void>;
  onDoubleActivate?: (button: ButtonRecord, event: MouseEvent) => void | Promise<void>;
  onRequestContextMenu?: (button: ButtonRecord, event: MouseEvent) => void;
  onHoverStart?: (button: ButtonRecord, event: PointerEvent) => void;
  onHoverEnd?: (button: ButtonRecord, event: PointerEvent) => void;
  onHoverCancel?: (button: ButtonRecord, event: PointerEvent) => void;
  onExecutionResult?: (result: ButtonExecutionResult) => void;
  onMeasurement?: (measurement: ButtonCoreMeasurement) => void;
  onVisualMeasurement?: (measurement: ButtonVisualMeasurement) => void;
  onPrepareVisualStateChange?: (state: ButtonVisualState) => void | Promise<void>;
  onVisualStateChange?: (state: ButtonVisualState) => void;
  onNaturalMeasurement?: (measurement: ButtonCoreMeasurement) => void;
}

const HOLD_MS = 400;
const RELEASE_MS = 140;
const ERROR_MS = 1800;
const PLAY_SAFETY_MS = 15_000;

export function ButtonHost({
  button,
  placement,
  skin,
  mode = "run",
  selected = false,
  constrained = true,
  fields,
  fieldValues,
  onFieldPatch,
  onFieldActivate,
  onSelect,
  onActivate,
  onDoubleActivate,
  onRequestContextMenu,
  onHoverStart,
  onHoverEnd,
  onHoverCancel,
  onExecutionResult,
  onMeasurement,
  onVisualMeasurement,
  onPrepareVisualStateChange,
  onVisualStateChange,
  onNaturalMeasurement
}: ButtonHostProps) {
  const [coreElement, setCoreElement] = useState<HTMLElement | SVGElement | null>(null);
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [held, setHeld] = useState(false);
  const [play, setPlay] = useState(false);
  const [release, setRelease] = useState(false);
  const [error, setError] = useState(false);
  const pointerActiveRef = useRef(false);
  const hoverActiveRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const releaseTimerRef = useRef<number | null>(null);
  const errorTimerRef = useRef<number | null>(null);
  const playTimerRef = useRef<number | null>(null);
  const playActiveRef = useRef(false);
  const animationCountRef = useRef(0);
  const animationStartedRef = useRef(false);
  const pressEventPlanRef = useRef<ReturnType<typeof resolveButtonPressEventPlan> | null>(null);
  const eventQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingHoverLeaveRef = useRef(false);
  const syntheticHoverSessionRef = useRef(false);
  // Volatile inputs flow through refs so the pointer/keyboard listeners stay
  // attached across re-renders; detaching mid-hover fakes a hoverLeave and
  // strands the hover state.
  const modeRef = useRef(mode);
  const buttonRef = useRef(button);
  const onSelectRef = useRef(onSelect);
  const onDoubleActivateRef = useRef(onDoubleActivate);
  const onRequestContextMenuRef = useRef(onRequestContextMenu);
  const onHoverStartRef = useRef(onHoverStart);
  const onHoverEndRef = useRef(onHoverEnd);
  const onHoverCancelRef = useRef(onHoverCancel);
  const onPrepareVisualStateChangeRef = useRef(onPrepareVisualStateChange);
  const onVisualStateChangeRef = useRef(onVisualStateChange);
  const hoverTransitionRef = useRef(0);
  modeRef.current = mode;
  buttonRef.current = button;
  onSelectRef.current = onSelect;
  onDoubleActivateRef.current = onDoubleActivate;
  onRequestContextMenuRef.current = onRequestContextMenu;
  onHoverStartRef.current = onHoverStart;
  onHoverEndRef.current = onHoverEnd;
  onHoverCancelRef.current = onHoverCancel;
  onPrepareVisualStateChangeRef.current = onPrepareVisualStateChange;
  onVisualStateChangeRef.current = onVisualStateChange;
  const visualStateRef = useRef<ButtonVisualState>({ hovered, pressed, held, play, release, error });
  visualStateRef.current = { hovered, pressed, held, play, release, error };

  const clearTimer = (timer: { current: number | null }) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const startPlay = useCallback(() => {
    clearTimer(playTimerRef);
    animationCountRef.current = 0;
    animationStartedRef.current = false;
    playActiveRef.current = true;
    setPlay(true);
    playTimerRef.current = window.setTimeout(() => {
      playActiveRef.current = false;
      setPlay(false);
    }, PLAY_SAFETY_MS);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!animationStartedRef.current) {
        playActiveRef.current = false;
        clearTimer(playTimerRef);
        setPlay(false);
      }
    }));
  }, []);

  const runEvent = useCallback(async (eventName: string, activationEvent?: PointerEvent | KeyboardEvent) => {
    if (mode === "edit" || button.disabled) return;
    try {
      if (eventName === "click" && onActivate && activationEvent) {
        await onActivate(button, activationEvent);
        onExecutionResult?.({ executed: false, fieldValues: fieldValues ?? {}, fieldPatch: {} });
        return;
      }
      const result = await executeButtonRecord(button, eventName, {
        fields,
        fieldValues,
        onFieldActivate,
        onFieldPatch
      });
      onExecutionResult?.(result);
    } catch (executionError) {
      console.error(`Button '${button.label}' failed.`, executionError);
      setError(true);
      clearTimer(errorTimerRef);
      errorTimerRef.current = window.setTimeout(() => setError(false), ERROR_MS);
      onExecutionResult?.({
        executed: false,
        message: executionError instanceof Error ? executionError.message : String(executionError),
        fieldValues: fieldValues ?? {},
        fieldPatch: {}
      });
    }
  }, [mode, button, onActivate, onExecutionResult, fields, fieldValues, onFieldActivate, onFieldPatch]);
  const runEventRef = useRef(runEvent);
  runEventRef.current = runEvent;
  const enqueueEvent = useCallback((
    eventName: string,
    activationEvent?: PointerEvent | KeyboardEvent
  ) => {
    const invoke = () => runEventRef.current(eventName, activationEvent);
    const queued = eventQueueRef.current.then(invoke, invoke);
    eventQueueRef.current = queued;
    return queued;
  }, []);

  useEffect(() => {
    if (!coreElement) return;
    coreElement.setAttribute("role", "button");
    coreElement.setAttribute("aria-label", button.label || "FlowCell Button");
    coreElement.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    if (button.tooltip) coreElement.setAttribute("title", button.tooltip);
    else coreElement.removeAttribute("title");
    coreElement.setAttribute("tabindex", mode === "run" && !button.disabled ? "0" : "-1");
    coreElement.setAttribute("data-button-id", button.id);
    coreElement.setAttribute("data-button-core-interactive", "true");
    (coreElement as HTMLElement).style.cursor = mode === "edit" ? "move" : button.disabled ? "not-allowed" : "pointer";
  }, [coreElement, button, mode]);

  useEffect(() => {
    if (!coreElement) return;
    const root = coreElement.getRootNode();
    const interactionElement = root instanceof ShadowRoot
      ? root.host
      : coreElement;
    const beginPress = (activationEvent: PointerEvent | KeyboardEvent) => {
      if (buttonRef.current.disabled) return;
      if (modeRef.current === "edit") {
        onSelectRef.current?.(activationEvent);
        return;
      }
      if (pointerActiveRef.current) return;
      const pressEventPlan = resolveButtonPressEventPlan(buttonRef.current);
      pressEventPlanRef.current = pressEventPlan;
      pointerActiveRef.current = true;
      setPressed(true);
      startPlay();
      clearTimer(holdTimerRef);
      holdTimerRef.current = window.setTimeout(() => setHeld(true), HOLD_MS);
      const synthesizeHoverSession = (
        activationEvent instanceof KeyboardEvent &&
        !hoverActiveRef.current &&
        pressEventPlan.synthesizeHoverSessionForKeyboard
      );
      syntheticHoverSessionRef.current = synthesizeHoverSession;
      if (synthesizeHoverSession) {
        void enqueueEvent("hoverEnter", activationEvent);
      }
      if (pressEventPlan.dispatchPressDown) {
        void enqueueEvent("pressDown", activationEvent);
      }
    };
    const finishPress = (activationEvent: PointerEvent | KeyboardEvent) => {
      if (!pointerActiveRef.current || modeRef.current === "edit") return;
      const pressEventPlan = pressEventPlanRef.current ?? resolveButtonPressEventPlan(buttonRef.current);
      pressEventPlanRef.current = null;
      pointerActiveRef.current = false;
      clearTimer(holdTimerRef);
      setPressed(false);
      setHeld(false);
      setRelease(true);
      clearTimer(releaseTimerRef);
      releaseTimerRef.current = window.setTimeout(() => setRelease(false), RELEASE_MS);
      if (pressEventPlan.runClickOnRelease) {
        void enqueueEvent("click", activationEvent);
      }
      if (pressEventPlan.dispatchPressUp) {
        void enqueueEvent("pressUp", activationEvent);
      }
      if (syntheticHoverSessionRef.current || pendingHoverLeaveRef.current) {
        syntheticHoverSessionRef.current = false;
        pendingHoverLeaveRef.current = false;
        void enqueueEvent("hoverLeave", activationEvent);
      }
    };
    const cancelPress = (activationEvent?: PointerEvent | KeyboardEvent) => {
      const wasActive = pointerActiveRef.current;
      const pressEventPlan = pressEventPlanRef.current;
      pressEventPlanRef.current = null;
      pointerActiveRef.current = false;
      clearTimer(holdTimerRef);
      setPressed(false);
      setHeld(false);
      if (wasActive && pressEventPlan?.dispatchPressUp) {
        void enqueueEvent("pressUp", activationEvent);
      }
      if (syntheticHoverSessionRef.current || pendingHoverLeaveRef.current) {
        syntheticHoverSessionRef.current = false;
        pendingHoverLeaveRef.current = false;
        void enqueueEvent("hoverLeave", activationEvent);
      }
    };
    const handlePointerEnter = (event: Event) => {
      if (hoverActiveRef.current) return;
      const resumesActiveHoverSession = (
        pointerActiveRef.current &&
        (pendingHoverLeaveRef.current || syntheticHoverSessionRef.current)
      );
      pendingHoverLeaveRef.current = false;
      if (resumesActiveHoverSession) syntheticHoverSessionRef.current = false;
      hoverActiveRef.current = true;
      onHoverStartRef.current?.(buttonRef.current, event as PointerEvent);
      if (!resumesActiveHoverSession) {
        void enqueueEvent("hoverEnter");
      }
      const prepare = onPrepareVisualStateChangeRef.current;
      if (!prepare) {
        setHovered(true);
        return;
      }
      const transition = ++hoverTransitionRef.current;
      const nextState = { ...visualStateRef.current, hovered: true };
      // Transparent native windows must grow before an authored hover glow can
      // paint. Otherwise the first active frame is clipped and a top/left edge
      // can oscillate while the OS frame catches up.
      void (async () => {
        try {
          await prepare(nextState);
        } catch (prepareError) {
          console.error(`Button '${buttonRef.current.label}' could not prepare its hover window.`, prepareError);
        }
        if (hoverActiveRef.current && hoverTransitionRef.current === transition) {
          setHovered(true);
        }
      })();
    };
    const handlePointerLeave = (event: Event) => {
      if (isButtonWindowGeometryTransitionActive()) return;
      if (!hoverActiveRef.current) return;
      hoverActiveRef.current = false;
      hoverTransitionRef.current += 1;
      setHovered(false);
      const prepare = onPrepareVisualStateChangeRef.current;
      if (prepare) {
        const nextState = { ...visualStateRef.current, hovered: false };
        void Promise.resolve(prepare(nextState)).catch((prepareError) => {
          console.error(`Button '${buttonRef.current.label}' could not restore its idle window.`, prepareError);
        });
      }
      onHoverEndRef.current?.(buttonRef.current, event as PointerEvent);
      const shouldDeferHoverLeave = (
        pointerActiveRef.current &&
        Boolean(pressEventPlanRef.current?.dispatchPressUp)
      );
      if (shouldDeferHoverLeave) pendingHoverLeaveRef.current = true;
      else void enqueueEvent("hoverLeave");
    };
    const handlePointerDown = (event: Event) => {
      const pointerEvent = event as PointerEvent;
      if (pointerEvent.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      coreElement.focus?.({ preventScroll: true });
      interactionElement.setPointerCapture?.(pointerEvent.pointerId);
      beginPress(pointerEvent);
    };
    const handlePointerUp = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      finishPress(event as PointerEvent);
    };
    const handlePointerCancel = (event: Event) => {
      cancelPress(event as PointerEvent);
      if (hoverActiveRef.current) {
        hoverActiveRef.current = false;
        hoverTransitionRef.current += 1;
        setHovered(false);
        const prepare = onPrepareVisualStateChangeRef.current;
        if (prepare) {
          const nextState = { ...visualStateRef.current, hovered: false };
          void Promise.resolve(prepare(nextState)).catch((prepareError) => {
            console.error(`Button '${buttonRef.current.label}' could not restore its idle window.`, prepareError);
          });
        }
        void enqueueEvent("hoverLeave");
      }
      onHoverCancelRef.current?.(buttonRef.current, event as PointerEvent);
    };
    const handleDoubleClick = (event: Event) => {
      void onDoubleActivateRef.current?.(buttonRef.current, event as MouseEvent);
    };
    const handleContextMenu = (event: Event) => {
      const handler = onRequestContextMenuRef.current;
      if (!handler) return;
      event.preventDefault();
      event.stopPropagation();
      handler(buttonRef.current, event as MouseEvent);
    };
    const handleKeyDown = (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if ((keyboardEvent.key === "Enter" || keyboardEvent.key === " ") && !keyboardEvent.repeat) {
        keyboardEvent.preventDefault();
        beginPress(keyboardEvent);
      }
    };
    const handleKeyUp = (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        finishPress(keyboardEvent);
      }
    };
    const handleBlur = () => {
      cancelPress();
    };
    interactionElement.addEventListener("pointerenter", handlePointerEnter);
    interactionElement.addEventListener("pointerleave", handlePointerLeave);
    interactionElement.addEventListener("pointerdown", handlePointerDown);
    interactionElement.addEventListener("pointerup", handlePointerUp);
    interactionElement.addEventListener("pointercancel", handlePointerCancel);
    interactionElement.addEventListener("dblclick", handleDoubleClick);
    interactionElement.addEventListener("contextmenu", handleContextMenu);
    interactionElement.addEventListener("keydown", handleKeyDown);
    interactionElement.addEventListener("keyup", handleKeyUp);
    interactionElement.addEventListener("blur", handleBlur);
    return () => {
      interactionElement.removeEventListener("pointerenter", handlePointerEnter);
      interactionElement.removeEventListener("pointerleave", handlePointerLeave);
      interactionElement.removeEventListener("pointerdown", handlePointerDown);
      interactionElement.removeEventListener("pointerup", handlePointerUp);
      interactionElement.removeEventListener("pointercancel", handlePointerCancel);
      interactionElement.removeEventListener("dblclick", handleDoubleClick);
      interactionElement.removeEventListener("contextmenu", handleContextMenu);
      interactionElement.removeEventListener("keydown", handleKeyDown);
      interactionElement.removeEventListener("keyup", handleKeyUp);
      interactionElement.removeEventListener("blur", handleBlur);
      cancelPress();
      hoverTransitionRef.current += 1;
      if (hoverActiveRef.current) {
        hoverActiveRef.current = false;
        setHovered(false);
        void enqueueEvent("hoverLeave");
      }
    };
  }, [coreElement, enqueueEvent, startPlay]);

  useEffect(() => {
    if (!shadowRoot) return;
    const handleAnimationStart = (event: Event) => {
      if (!playActiveRef.current || !(event.target instanceof Element) || !event.target.matches("[data-anim]")) return;
      animationStartedRef.current = true;
      animationCountRef.current += 1;
    };
    const handleAnimationFinish = (event: Event) => {
      if (!playActiveRef.current || !(event.target instanceof Element) || !event.target.matches("[data-anim]")) return;
      animationCountRef.current = Math.max(0, animationCountRef.current - 1);
      if (animationStartedRef.current && animationCountRef.current === 0) {
        playActiveRef.current = false;
        clearTimer(playTimerRef);
        setPlay(false);
      }
    };
    shadowRoot.addEventListener("animationstart", handleAnimationStart);
    shadowRoot.addEventListener("animationend", handleAnimationFinish);
    shadowRoot.addEventListener("animationcancel", handleAnimationFinish);
    return () => {
      shadowRoot.removeEventListener("animationstart", handleAnimationStart);
      shadowRoot.removeEventListener("animationend", handleAnimationFinish);
      shadowRoot.removeEventListener("animationcancel", handleAnimationFinish);
    };
  }, [shadowRoot]);

  useEffect(() => () => {
    clearTimer(holdTimerRef);
    clearTimer(releaseTimerRef);
    clearTimer(errorTimerRef);
    clearTimer(playTimerRef);
  }, []);

  useEffect(() => {
    onVisualStateChangeRef.current?.({ hovered, pressed, held, play, release, error });
  }, [error, held, hovered, play, pressed, release]);

  return (
    <span
      className={`button-system-host${selected ? " button-system-host--selected" : ""}`}
      data-button-host-id={button.id}
      style={{ display: "inline-block", verticalAlign: "top", overflow: "visible", pointerEvents: "none" }}
    >
      <ButtonSkinRenderer
        skin={skin}
        label={button.label}
        width={placement.width}
        height={placement.height}
        constrained={constrained}
        matchHitboxToSkin={placement.matchHitboxToSkin}
        allowStretching={placement.allowStretching}
        textFitMode={placement.textFitMode}
        minimumFontSize={placement.minimumFontSize}
        textSizeOverride={placement.textSizeOverride ?? undefined}
        hovered={hovered}
        pressed={pressed}
        held={held}
        play={play}
        release={release}
        disabled={button.disabled}
        error={error}
        onCoreElementChange={setCoreElement}
        onShadowRootChange={setShadowRoot}
        onMeasurement={onMeasurement}
        onVisualMeasurement={onVisualMeasurement}
        onNaturalMeasurement={onNaturalMeasurement}
      />
    </span>
  );
}
