import type {
  ButtonActivationAnimationPresetId,
  ButtonPlacement,
  ButtonRecord,
  ButtonSkin,
  ButtonTextFitMode
} from "../types";
import { lockButtonRectAspect } from "../geometry/buttonGeometry";
import {
  BUTTON_ACTIVATION_ANIMATION_PRESETS,
  canButtonRunActivationAnimation
} from "../animations/buttonActivationAnimations";

export interface ButtonInspectorProps {
  button: ButtonRecord | null;
  placement: ButtonPlacement | null;
  skins: readonly ButtonSkin[];
  onButtonChange: (patch: Partial<ButtonRecord>, coalesceKey?: string) => void;
  onPlacementChange: (patch: Partial<ButtonPlacement>, coalesceKey?: string) => void;
  onActivationAnimationChange: (
    presetId: ButtonActivationAnimationPresetId | null
  ) => void;
  onConfigureActivationAnimation: () => void;
  activationAnimationEditorOpen: boolean;
  onSaveActivationAnimationBounds: () => void;
  onCloseActivationAnimationEditor: () => void;
}

const TEXT_FIT_OPTIONS: Array<{ value: ButtonTextFitMode; label: string }> = [
  { value: "shrink", label: "Shrink" },
  { value: "stack-whole-words", label: "Stack Whole Words" },
  { value: "shrink-and-stack", label: "Shrink and Stack" }
];

function NumberField({
  label,
  value,
  minimum,
  onChange
}: {
  label: string;
  value: number;
  minimum?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={minimum}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (!Number.isFinite(next)) return;
          onChange(minimum === undefined ? next : Math.max(minimum, next));
        }}
      />
    </label>
  );
}

export function ButtonInspector({
  button,
  placement,
  skins,
  onButtonChange,
  onPlacementChange,
  onActivationAnimationChange,
  onConfigureActivationAnimation,
  activationAnimationEditorOpen,
  onSaveActivationAnimationBounds,
  onCloseActivationAnimationEditor
}: ButtonInspectorProps) {
  if (!button || !placement) return <aside className="button-inspector"><p>Select a Button placement.</p></aside>;
  const canRunActivationAnimation = canButtonRunActivationAnimation(button);
  const changeWidth = (width: number) => {
    const size = placement.allowStretching
      ? { width }
      : lockButtonRectAspect(placement, width, placement.height, 1);
    onPlacementChange(size, `geometry:${placement.id}`);
  };
  const changeHeight = (height: number) => {
    const size = placement.allowStretching
      ? { height }
      : lockButtonRectAspect(placement, placement.width, height, 1);
    onPlacementChange(size, `geometry:${placement.id}`);
  };
  return (
    <aside className="button-inspector">
      <h2>Inspector</h2>
      <section>
        <h3>Button</h3>
        <label><span>Label</span><input value={button.label} onChange={(event) => onButtonChange({ label: event.currentTarget.value }, `label:${button.id}`)} /></label>
        <label><span>Tooltip</span><textarea value={button.tooltip} onChange={(event) => onButtonChange({ tooltip: event.currentTarget.value }, `tooltip:${button.id}`)} /></label>
        <label className="button-editor-check"><input type="checkbox" checked={button.disabled} onChange={(event) => onButtonChange({ disabled: event.currentTarget.checked })} /><span>Disabled</span></label>
      </section>
      <section>
        <h3>Geometry</h3>
        <div className="button-inspector-grid">
          <NumberField label="X" value={placement.x} onChange={(x) => onPlacementChange({ x }, `geometry:${placement.id}`)} />
          <NumberField label="Y" value={placement.y} onChange={(y) => onPlacementChange({ y }, `geometry:${placement.id}`)} />
          <NumberField label="Width" minimum={1} value={placement.width} onChange={changeWidth} />
          <NumberField label="Height" minimum={1} value={placement.height} onChange={changeHeight} />
        </div>
        <label className="button-editor-check"><input type="checkbox" checked={placement.matchHitboxToSkin} onChange={(event) => onPlacementChange({ matchHitboxToSkin: event.currentTarget.checked })} /><span>Match hitbox to skin</span></label>
        <label className="button-editor-check"><input type="checkbox" checked={placement.allowStretching} onChange={(event) => onPlacementChange({ allowStretching: event.currentTarget.checked })} /><span>Allow stretching</span></label>
      </section>
      <section>
        <h3>Skin</h3>
        <label><span>Assign Existing Skin</span><select value={placement.skinOverrideId ?? button.defaultSkinId} onChange={(event) => onPlacementChange({ skinOverrideId: event.currentTarget.value })}>{skins.map((skin) => <option key={skin.id} value={skin.id}>{skin.name}</option>)}</select></label>
      </section>
      <section>
        <h3>Animation</h3>
        <label>
          <span>On run</span>
          <select
            value={button.activationAnimation?.presetId ?? ""}
            onChange={(event) => {
              const presetId = event.currentTarget.value as ButtonActivationAnimationPresetId;
              onActivationAnimationChange(presetId || null);
            }}
          >
            <option value="">None</option>
            {BUTTON_ACTIVATION_ANIMATION_PRESETS.map((preset) => (
              <option
                key={preset.id}
                value={preset.id}
                disabled={!canRunActivationAnimation}
              >
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        {button.activationAnimation && (
          <div className="button-inspector__animation-actions">
            {activationAnimationEditorOpen ? (
              <>
                <button type="button" onClick={onSaveActivationAnimationBounds}>
                  Save position and size
                </button>
                <button type="button" onClick={onCloseActivationAnimationEditor}>
                  Close setup
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={!canRunActivationAnimation}
                onClick={onConfigureActivationAnimation}
              >
                Position and size
              </button>
            )}
          </div>
        )}
        {activationAnimationEditorOpen && (
          <p className="button-inspector__hint">
            This plus is the animation's largest size. Drag it to move; drag any
            invisible edge or corner to resize at its locked 283:295 shape, then save here.
          </p>
        )}
        {!canRunActivationAnimation && (
          <p className="button-inspector__hint">
            New animations are available on Buttons that dispatch an action. Choose None to remove a dormant assignment.
          </p>
        )}
      </section>
      <section>
        <h3>Text</h3>
        <label><span>Fit mode</span><select value={placement.textFitMode} onChange={(event) => onPlacementChange({ textFitMode: event.currentTarget.value as ButtonTextFitMode })}>{TEXT_FIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>
          <span>Font size</span>
          <input
            type="number"
            min={1}
            value={placement.textSizeOverride ?? ""}
            placeholder="Skin default"
            onChange={(event) => {
              const value = event.currentTarget.value;
              const parsed = Number(value);
              if (value !== "" && !Number.isFinite(parsed)) return;
              onPlacementChange(
                { textSizeOverride: value === "" ? null : Math.max(1, parsed) },
                `font-size:${placement.id}`
              );
            }}
          />
        </label>
        <NumberField label="Minimum size when shrinking" minimum={1} value={placement.minimumFontSize} onChange={(minimumFontSize) => onPlacementChange({ minimumFontSize })} />
        <label className="button-editor-check"><input type="checkbox" checked={placement.allowLabelResize} onChange={(event) => onPlacementChange({ allowLabelResize: event.currentTarget.checked })} /><span>Allow label changes to resize this placement</span></label>
      </section>
    </aside>
  );
}
