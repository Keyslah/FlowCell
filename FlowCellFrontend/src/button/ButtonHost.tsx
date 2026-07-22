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
import { notifyButtonActivationEffect } from "./runtime/buttonActivationEffects";
import {
  getButtonActivationStateCount,
  resolveButtonAppearance
} from "./runtime/buttonActivationState";
import {
  advanceButtonActivationState,
  subscribeButtonActivationState
} from "./runtime/ButtonActivationStateBus";
import { isButtonWindowGeometryTransitionActive } from "./windows/buttonWindowGeometryTransition";

export interface ButtonHostProps {
  button: ButtonRecord;
  placement: ButtonPlacement;
  skin: ButtonSkin;
  mode?: ButtonEditorMode;
  selected?: boolean;
  selectionOnly?: boolean;
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
  onRequestInlineEditorFocus?: () => void | Promise<void>;
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

function eventTargetsInlineEditor(event: Event): boolean {
  return event.composedPath().some(
    (target) => target instanceof Element && target.hasAttribute("data-button-inline-editor")
  );
}

function selectInlineEditorContents(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function focusAndSelectInlineEditor(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  selectInlineEditorContents(element);
}

export function ButtonHost({
  button,
  placement,
  skin,
  mode = "run",
  selected = false,
  selectionOnly = false,
  constrained = true,
  fields,
  fieldValues,
  onFieldPatch,
  onFieldActivate,
  onRequestInlineEditorFocus,
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
  const [labelElement, setLabelElement] = useState<HTMLElement | SVGElement | null>(null);
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [held, setHeld] = useState(false);
  const [play, setPlay] = useState(false);
  const [release, setRelease] = useState(false);
  const [error, setError] = useState(false);
  const [activationStateIndex, setActivationStateIndex] = useState(0);
  const activationStateIndexRef = useRef(activationStateIndex);
  activationStateIndexRef.current = activationStateIndex;
  const activationStateTransitionRef = useRef(0);
  const activationStateCount = getButtonActivationStateCount(button.activationBehavior);
  const visualPressed = pressed || selected;
  const visualRelease = selected ? false : release;
  const rawVisualState: ButtonVisualState = {
    hovered,
    pressed: visualPressed,
    held,
    play,
    release: visualRelease,
    error
  };
  const resolvedAppearance = resolveButtonAppearance({
    buttonLabel: button.label,
    activationBehavior: button.activationBehavior,
    activeStateIndex: activationStateIndex,
    visualStateMap: placement.visualStateMap,
    appearance: {
      hovered,
      pressed,
      held,
      play,
      release,
      selected,
      disabled: button.disabled,
      error
    }
  });
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
  const inlineEditorElementRef = useRef<HTMLElement | null>(null);
  // Volatile inputs flow through refs so the pointer/keyboard listeners stay
  // attached across re-renders; detaching mid-hover fakes a hoverLeave and
  // strands the hover state.
  const modeRef = useRef(mode);
  const selectionOnlyRef = useRef(selectionOnly);
  const buttonRef = useRef(button);
  const onSelectRef = useRef(onSelect);
  const onDoubleActivateRef = useRef(onDoubleActivate);
  const onRequestContextMenuRef = useRef(onRequestContextMenu);
  const onRequestInlineEditorFocusRef = useRef(onRequestInlineEditorFocus);
  const onFieldPatchRef = useRef(onFieldPatch);
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
  onRequestInlineEditorFocusRef.current = onRequestInlineEditorFocus;
  onFieldPatchRef.current = onFieldPatch;
  onHoverStartRef.current = onHoverStart;
  onHoverEndRef.current = onHoverEnd;
  onHoverCancelRef.current = onHoverCancel;
  onPrepareVisualStateChangeRef.current = onPrepareVisualStateChange;
  onVisualStateChangeRef.current = onVisualStateChange;
  const visualStateRef = useRef<ButtonVisualState>(rawVisualState);
  visualStateRef.current = rawVisualState;
  const resolvePreparedVisualStateRef = useRef((
    state: ButtonVisualState,
    nextActivationStateIndex?: number
  ): ButtonVisualState => state);
  resolvePreparedVisualStateRef.current = (state, nextActivationStateIndex = activationStateIndex) => {
    const next = resolveButtonAppearance({
      buttonLabel: button.label,
      activationBehavior: button.activationBehavior,
      activeStateIndex: nextActivationStateIndex,
      visualStateMap: placement.visualStateMap,
      appearance: {
        hovered: state.hovered,
        pressed: pointerActiveRef.current,
        held: state.held,
        play: state.play,
        release: state.release,
        selected,
        disabled: button.disabled,
        error: state.error
      }
    });
    return {
      hovered: next.flags.hovered,
      pressed: next.flags.pressed,
      held: next.flags.held,
      play: next.flags.play,
      release: next.flags.release,
      error: next.flags.error
    };
  };
  const inlineEditFieldId = button.toolSetBehavior?.inlineEditField;
  const inlineEditField = fields?.find((field) => (
    field.id === inlineEditFieldId && (field.kind === "number" || field.kind === "text")
  ));
  const inlineEditValue = inlineEditField
    ? fieldValues?.[inlineEditField.id] ?? inlineEditField.defaultValue
    : undefined;
  const renderedLabel = inlineEditField
    ? String(inlineEditValue ?? "")
    : resolvedAppearance.label;

  useEffect(() => {
    if (activationStateCount <= 1) {
      setActivationStateIndex(0);
      return;
    }
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void subscribeButtonActivationState(
      button.id,
      activationStateCount,
      (index) => {
        if (disposed) return;
        const transition = ++activationStateTransitionRef.current;
        if (index === activationStateIndexRef.current) return;
        const commitIndex = () => {
          if (disposed || activationStateTransitionRef.current !== transition) return;
          activationStateIndexRef.current = index;
          setActivationStateIndex(index);
        };
        const prepare = onPrepareVisualStateChangeRef.current;
        if (!prepare) {
          commitIndex();
          return;
        }
        const preparedState = resolvePreparedVisualStateRef.current(
          visualStateRef.current,
          index
        );
        void Promise.resolve(prepare(preparedState))
          .catch((prepareError) => {
            console.error(
              `Button '${buttonRef.current.label}' could not prepare its next activation state.`,
              prepareError
            );
          })
          .finally(commitIndex);
      }
    ).then((nextUnsubscribe) => {
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });
    return () => {
      disposed = true;
      activationStateTransitionRef.current += 1;
      unsubscribe?.();
    };
  }, [activationStateCount, button.id]);

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

  selectionOnlyRef.current = selectionOnly;

  useEffect(() => {
    const element = labelElement;
    const field = inlineEditField;
    if (!element || !field || mode !== "run" || button.disabled) return;
    if (!(element instanceof HTMLElement)) {
      console.error(`Button '${button.label}' cannot inline-edit an SVG label node.`);
      return;
    }
    inlineEditorElementRef.current = element;
    const currentValue = inlineEditValue ?? field.defaultValue;
    const managedAttributes = [
      "aria-label",
      "aria-valuemax",
      "aria-valuemin",
      "aria-valuenow",
      "contenteditable",
      "data-button-inline-editor",
      "inputmode",
      "role",
      "spellcheck",
      "tabindex"
    ];
    const previousAttributes = new Map(
      managedAttributes.map((attribute) => [attribute, element.getAttribute(attribute)])
    );
    const managedStyles = ["cursor", "outline", "pointer-events", "user-select"];
    const previousStyles = new Map(
      managedStyles.map((property) => [property, element.style.getPropertyValue(property)])
    );
    element.setAttribute("data-button-inline-editor", "true");
    element.setAttribute("contenteditable", "true");
    element.setAttribute("role", field.kind === "number" ? "spinbutton" : "textbox");
    element.setAttribute("aria-label", field.label || "Value");
    element.setAttribute("tabindex", "0");
    element.setAttribute("spellcheck", "false");
    if (field.kind === "number") {
      element.setAttribute("inputmode", "decimal");
      if (field.minimum !== undefined) element.setAttribute("aria-valuemin", String(field.minimum));
      if (field.maximum !== undefined) element.setAttribute("aria-valuemax", String(field.maximum));
      element.setAttribute("aria-valuenow", String(currentValue));
    }
    Object.assign(element.style, {
      cursor: "text",
      outline: "none",
      pointerEvents: "auto",
      userSelect: "text"
    });

    const restore = () => {
      element.textContent = String(currentValue ?? "");
    };
    const commit = () => {
      const raw = element.textContent?.trim() ?? "";
      const nextValue = field.kind === "number" ? Number(raw) : raw;
      if (field.kind === "number" && (!raw || !Number.isFinite(nextValue))) {
        restore();
        return;
      }
      onFieldPatchRef.current?.(
        { [field.id]: nextValue },
        { ...(fieldValues ?? {}), [field.id]: nextValue }
      );
    };
    const handleFocus = () => {
      selectInlineEditorContents(element);
    };
    let skipNextBlurCommit = false;
    const handleKeyDown = (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      keyboardEvent.stopPropagation();
      if (keyboardEvent.key === "Enter") {
        keyboardEvent.preventDefault();
        element.blur();
      } else if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        skipNextBlurCommit = true;
        restore();
        element.blur();
      }
    };
    const handleBlur = () => {
      if (skipNextBlurCommit) {
        skipNextBlurCommit = false;
        return;
      }
      commit();
    };
    element.addEventListener("focus", handleFocus);
    element.addEventListener("keydown", handleKeyDown);
    element.addEventListener("blur", handleBlur);
    return () => {
      if (inlineEditorElementRef.current === element) {
        inlineEditorElementRef.current = null;
      }
      element.removeEventListener("focus", handleFocus);
      element.removeEventListener("keydown", handleKeyDown);
      element.removeEventListener("blur", handleBlur);
      for (const [attribute, previousValue] of previousAttributes) {
        if (previousValue === null) element.removeAttribute(attribute);
        else element.setAttribute(attribute, previousValue);
      }
      for (const [property, previousValue] of previousStyles) {
        if (!previousValue) element.style.removeProperty(property);
        else element.style.setProperty(property, previousValue);
      }
    };
  }, [button.disabled, fieldValues, inlineEditField, inlineEditValue, labelElement, mode]);

  const runEvent = useCallback(async (eventName: string, activationEvent?: PointerEvent | KeyboardEvent) => {
    if (mode === "edit" || button.disabled) return;
    try {
      if (selectionOnly) {
        if (eventName === "click" && onActivate && activationEvent) {
          await onActivate(button, activationEvent);
          onExecutionResult?.({ executed: false, fieldValues: fieldValues ?? {}, fieldPatch: {} });
        }
        return;
      }
      if (eventName === "click" && onActivate && activationEvent) {
        if (
          button.role === "panel-owner" ||
          button.role === "tool-set-owner" ||
          !button.executionTarget ||
          button.toolSetBehavior?.execute === false
        ) {
          notifyButtonActivationEffect(button);
        }
        await onActivate(button, activationEvent);
        onExecutionResult?.({ executed: false, fieldValues: fieldValues ?? {}, fieldPatch: {} });
        const pressPlan = resolveButtonPressEventPlan(button);
        const primaryEventName = pressPlan.runClickOnRelease ? "click" : "pressDown";
        if (eventName === primaryEventName && activationStateCount > 1) {
          await advanceButtonActivationState(button.id, activationStateCount);
        }
        return;
      }
      const result = await executeButtonRecord(button, eventName, {
        fields,
        fieldValues,
        onFieldActivate,
        onFieldPatch
      });
      onExecutionResult?.(result);
      const pressPlan = resolveButtonPressEventPlan(button);
      const primaryEventName = pressPlan.runClickOnRelease ? "click" : "pressDown";
      if (eventName === primaryEventName && activationStateCount > 1) {
        await advanceButtonActivationState(button.id, activationStateCount);
      }
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
  }, [mode, button, selectionOnly, onActivate, onExecutionResult, fields, fieldValues, onFieldActivate, onFieldPatch, activationStateCount]);
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
    coreElement.setAttribute("role", inlineEditField ? "group" : "button");
    coreElement.setAttribute(
      "aria-label",
      inlineEditField ? `${inlineEditField.label || "Value"}: ${renderedLabel}` : renderedLabel || "FlowCell Button"
    );
    coreElement.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    if (selected || button.activationBehavior?.mode === "toggle") {
      coreElement.setAttribute(
        "aria-pressed",
        selected || activationStateIndex > 0 ? "true" : "false"
      );
    } else {
      coreElement.removeAttribute("aria-pressed");
    }
    if (button.tooltip) coreElement.setAttribute("title", button.tooltip);
    else coreElement.removeAttribute("title");
    coreElement.setAttribute("tabindex", mode === "run" && !button.disabled && !inlineEditField ? "0" : "-1");
    coreElement.setAttribute("data-button-id", button.id);
    coreElement.setAttribute("data-button-core-interactive", "true");
    (coreElement as HTMLElement).style.cursor = mode === "edit"
      ? "move"
      : button.disabled
        ? "not-allowed"
        : inlineEditField
          ? "text"
          : "pointer";
  }, [activationStateIndex, coreElement, button, inlineEditField, mode, renderedLabel, selected]);

  useEffect(() => {
    if (!coreElement) return;
    const interactionElement = coreElement;
    const beginPress = (activationEvent: PointerEvent | KeyboardEvent) => {
      if (buttonRef.current.disabled) return;
      if (modeRef.current === "edit") {
        onSelectRef.current?.(activationEvent);
        return;
      }
      if (pointerActiveRef.current) return;
      const pressEventPlan = selectionOnlyRef.current
        ? {
            dispatchPressDown: false,
            dispatchPressUp: false,
            runClickOnRelease: true,
            synthesizeHoverSessionForKeyboard: false
          }
        : resolveButtonPressEventPlan(buttonRef.current);
      pressEventPlanRef.current = pressEventPlan;
      pointerActiveRef.current = true;
      setPressed(true);
      if (!selectionOnlyRef.current) startPlay();
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
      const nextState = resolvePreparedVisualStateRef.current({
        ...visualStateRef.current,
        hovered: true
      });
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
        const nextState = resolvePreparedVisualStateRef.current({
          ...visualStateRef.current,
          hovered: false
        });
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
      const inlineEditor = eventTargetsInlineEditor(event);
      const inlineEditorElement = inlineEditorElementRef.current;
      if (!inlineEditor) {
        event.preventDefault();
      }
      if (inlineEditorElement && modeRef.current === "run" && !buttonRef.current.disabled) {
        const focusEditor = () => {
          if (
            inlineEditorElementRef.current !== inlineEditorElement ||
            !inlineEditorElement.isConnected
          ) return;
          focusAndSelectInlineEditor(inlineEditorElement);
        };
        focusEditor();
        const requestInlineEditorFocus = onRequestInlineEditorFocusRef.current;
        if (requestInlineEditorFocus) {
          void (async () => {
            try {
              await requestInlineEditorFocus();
              focusEditor();
            } catch (focusError) {
              console.error(
                `Button '${buttonRef.current.label}' could not focus its inline editor window.`,
                focusError
              );
            }
          })();
        }
      }
      event.stopPropagation();
      if (!inlineEditor) interactionElement.setPointerCapture?.(pointerEvent.pointerId);
      beginPress(pointerEvent);
    };
    const handlePointerUp = (event: Event) => {
      if (!eventTargetsInlineEditor(event)) event.preventDefault();
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
          const nextState = resolvePreparedVisualStateRef.current({
            ...visualStateRef.current,
            hovered: false
          });
          void Promise.resolve(prepare(nextState)).catch((prepareError) => {
            console.error(`Button '${buttonRef.current.label}' could not restore its idle window.`, prepareError);
          });
        }
        void enqueueEvent("hoverLeave");
      }
      onHoverCancelRef.current?.(buttonRef.current, event as PointerEvent);
    };
    const handleDoubleClick = (event: Event) => {
      const handler = onDoubleActivateRef.current;
      if (!handler) return;
      void (async () => {
        try {
          await handler(buttonRef.current, event as MouseEvent);
          const stateCount = getButtonActivationStateCount(buttonRef.current.activationBehavior);
          if (selectionOnlyRef.current && stateCount > 1) {
            await advanceButtonActivationState(buttonRef.current.id, stateCount);
          }
        } catch (activationError) {
          console.error(`Button '${buttonRef.current.label}' could not complete its double activation.`, activationError);
        }
      })();
    };
    const handleContextMenu = (event: Event) => {
      const handler = onRequestContextMenuRef.current;
      if (!handler) return;
      event.preventDefault();
      event.stopPropagation();
      handler(buttonRef.current, event as MouseEvent);
    };
    const handleKeyDown = (event: Event) => {
      if (eventTargetsInlineEditor(event)) return;
      const keyboardEvent = event as KeyboardEvent;
      if ((keyboardEvent.key === "Enter" || keyboardEvent.key === " ") && !keyboardEvent.repeat) {
        keyboardEvent.preventDefault();
        beginPress(keyboardEvent);
      }
    };
    const handleKeyUp = (event: Event) => {
      if (eventTargetsInlineEditor(event)) return;
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
    onVisualStateChangeRef.current?.({
      hovered,
      pressed: visualPressed,
      held,
      play,
      release: visualRelease,
      error
    });
  }, [error, held, hovered, play, visualPressed, visualRelease]);

  return (
    <span
      className="button-system-host"
      data-button-host-id={button.id}
      style={{ display: "inline-block", verticalAlign: "top", overflow: "visible", pointerEvents: "none" }}
    >
      <ButtonSkinRenderer
        skin={skin}
        label={renderedLabel}
        width={placement.width}
        height={placement.height}
        constrained={constrained}
        matchHitboxToSkin={placement.matchHitboxToSkin}
        allowStretching={placement.allowStretching}
        textFitMode={placement.textFitMode}
        textAlignment={placement.textAlignment}
        minimumFontSize={placement.minimumFontSize}
        textSizeOverride={placement.textSizeOverride ?? undefined}
        hovered={resolvedAppearance.flags.hovered}
        pressed={resolvedAppearance.flags.pressed}
        pointerPressed={pressed}
        held={resolvedAppearance.flags.held}
        play={resolvedAppearance.flags.play}
        release={resolvedAppearance.flags.release}
        disabled={resolvedAppearance.flags.disabled}
        error={resolvedAppearance.flags.error}
        samplingState={rawVisualState}
        transitionSamplingKey={`${activationStateIndex}:${resolvedAppearance.activeTrigger}:${resolvedAppearance.visualState}`}
        onCoreElementChange={setCoreElement}
        onLabelElementChange={setLabelElement}
        onShadowRootChange={setShadowRoot}
        onMeasurement={onMeasurement}
        onVisualMeasurement={onVisualMeasurement}
        onNaturalMeasurement={onNaturalMeasurement}
      />
    </span>
  );
}
