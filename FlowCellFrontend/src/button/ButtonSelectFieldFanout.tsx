import {
  useEffect,
  useRef,
  useState
} from "react";
import type {
  ButtonPlacement,
  ButtonSelectToolField,
  ButtonSkin,
  ButtonToolFieldOption,
  ButtonVisualState
} from "./types";
import { ButtonSkinRenderer } from "./skins/ButtonSkinRenderer";

interface ButtonSelectFieldFanoutProps {
  field: ButtonSelectToolField;
  placement: ButtonPlacement;
  skin: ButtonSkin;
  listboxId: string;
  selectedValue: ButtonSelectToolField["defaultValue"];
  activeIndex: number;
  disabled: boolean;
  constrained: boolean;
  onChoose: (index: number) => void;
  onOptionHover: (index: number) => void;
  onHoverHandoffStart: () => void;
  onHoverHandoffEnd: () => void;
}

interface ButtonSelectFieldOptionProps {
  option: ButtonToolFieldOption;
  optionDomId: string;
  index: number;
  selected: boolean;
  active: boolean;
  disabled: boolean;
  constrained: boolean;
  placement: ButtonPlacement;
  skin: ButtonSkin;
  onChoose: (index: number) => void;
  onOptionHover: (index: number) => void;
  onHoverHandoffStart: () => void;
  onHoverHandoffEnd: () => void;
}

function ButtonSelectFieldOption({
  option,
  optionDomId,
  index,
  selected,
  active,
  disabled,
  constrained,
  placement,
  skin,
  onChoose,
  onOptionHover,
  onHoverHandoffStart,
  onHoverHandoffEnd
}: ButtonSelectFieldOptionProps) {
  const [coreElement, setCoreElement] = useState<HTMLElement | SVGElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const pointerActiveRef = useRef(false);
  const visualHovered = hovered || active;
  const rawVisualState: ButtonVisualState = {
    hovered: visualHovered,
    pressed,
    held: false,
    play: false,
    release: false,
    error: false
  };

  useEffect(() => {
    if (!coreElement) return;
    const element = coreElement;
    element.id = optionDomId;
    element.setAttribute("role", "option");
    element.setAttribute("aria-label", option.label);
    element.setAttribute("aria-selected", selected ? "true" : "false");
    element.setAttribute("aria-disabled", disabled ? "true" : "false");
    element.setAttribute("tabindex", "-1");
    element.setAttribute("data-button-core-interactive", "true");
    element.setAttribute("data-button-select-option-id", option.id);
    (element as HTMLElement).style.cursor = disabled ? "not-allowed" : "pointer";

    const handlePointerEnter = () => {
      if (disabled) return;
      onHoverHandoffEnd();
      onOptionHover(index);
      setHovered(true);
    };
    const handlePointerLeave = () => {
      pointerActiveRef.current = false;
      setHovered(false);
      setPressed(false);
      onHoverHandoffStart();
    };
    const handlePointerDown = (event: Event) => {
      const pointerEvent = event as PointerEvent;
      if (disabled || pointerEvent.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      pointerActiveRef.current = true;
      setPressed(true);
    };
    const handlePointerUp = (event: Event) => {
      const pointerEvent = event as PointerEvent;
      if (pointerEvent.button !== 0 || !pointerActiveRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      pointerActiveRef.current = false;
      setPressed(false);
      onChoose(index);
    };
    const handlePointerCancel = (event: Event) => {
      event.stopPropagation();
      pointerActiveRef.current = false;
      setPressed(false);
    };

    element.addEventListener("pointerenter", handlePointerEnter);
    element.addEventListener("pointerleave", handlePointerLeave);
    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointerup", handlePointerUp);
    element.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      element.removeEventListener("pointerenter", handlePointerEnter);
      element.removeEventListener("pointerleave", handlePointerLeave);
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("pointerup", handlePointerUp);
      element.removeEventListener("pointercancel", handlePointerCancel);
      pointerActiveRef.current = false;
    };
  }, [
    coreElement,
    disabled,
    index,
    onChoose,
    onHoverHandoffEnd,
    onHoverHandoffStart,
    onOptionHover,
    option.id,
    option.label,
    optionDomId,
    selected
  ]);

  return (
    <span
      data-button-select-option-host={option.id}
      data-button-select-option-active={active ? "true" : "false"}
      style={{
        display: "block",
        position: "relative",
        width: placement.width,
        height: placement.height,
        overflow: "visible",
        pointerEvents: "none"
      }}
    >
      <ButtonSkinRenderer
        skin={skin}
        label={option.label}
        width={placement.width}
        height={placement.height}
        constrained={constrained}
        matchHitboxToSkin={placement.matchHitboxToSkin}
        allowStretching={placement.allowStretching}
        textFitMode={placement.textFitMode}
        textAlignment={placement.textAlignment}
        textOffsetX={placement.textOffsetX}
        textOffsetY={placement.textOffsetY}
        minimumFontSize={placement.minimumFontSize}
        textSizeOverride={placement.textSizeOverride ?? undefined}
        hovered={visualHovered}
        pressed={pressed}
        pointerPressed={pressed}
        held={false}
        play={false}
        release={false}
        disabled={disabled}
        error={false}
        highlightOnHover={placement.highlightOnHover}
        activeHighlight={selected}
        rawHovered={hovered}
        samplingState={rawVisualState}
        transitionSamplingKey={`${selected ? 1 : 0}:${active ? 1 : 0}`}
        onCoreElementChange={setCoreElement}
      />
    </span>
  );
}

export function ButtonSelectFieldFanout({
  field,
  placement,
  skin,
  listboxId,
  selectedValue,
  activeIndex,
  disabled,
  constrained,
  onChoose,
  onOptionHover,
  onHoverHandoffStart,
  onHoverHandoffEnd
}: ButtonSelectFieldFanoutProps) {
  const gap = 4;
  const columnCount = Math.max(1, Math.min(4, field.options.length));
  return (
    <span
      id={listboxId}
      role="listbox"
      aria-label={field.label || "Options"}
      aria-orientation="vertical"
      aria-hidden="true"
      data-button-select-listbox={field.id}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columnCount}, ${placement.width}px)`,
        gap,
        position: "absolute",
        left: 0,
        top: placement.height + gap,
        width: columnCount * placement.width + (columnCount - 1) * gap,
        zIndex: 1,
        overflow: "visible",
        pointerEvents: "none"
      }}
    >
      {field.options.map((option, index) => (
        <ButtonSelectFieldOption
          key={option.id}
          option={option}
          optionDomId={`${listboxId}-option-${index}`}
          index={index}
          selected={Object.is(option.value, selectedValue)}
          active={index === activeIndex}
          disabled={disabled}
          constrained={constrained}
          placement={placement}
          skin={skin}
          onChoose={onChoose}
          onOptionHover={onOptionHover}
          onHoverHandoffStart={onHoverHandoffStart}
          onHoverHandoffEnd={onHoverHandoffEnd}
        />
      ))}
    </span>
  );
}
