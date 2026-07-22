import { useEffect, useState } from "react";
import type {
  ButtonActivationAnimationPresetId,
  ButtonRecord
} from "../types";
import {
  BUTTON_ACTIVATION_ANIMATION_PRESETS,
  canButtonRunActivationAnimation
} from "../animations/buttonActivationAnimations";

export interface ButtonAnimationPickerPageProps {
  button: ButtonRecord | null;
  busy?: boolean;
  setupOpen: boolean;
  onClose: () => void;
  onApply: (presetId: ButtonActivationAnimationPresetId | null) => void | Promise<void>;
  onPositionAndSize: () => void;
  onSavePositionAndSize: () => void;
  onCloseSetup: () => void;
}

export function ButtonAnimationPickerPage({
  button,
  busy = false,
  setupOpen,
  onClose,
  onApply,
  onPositionAndSize,
  onSavePositionAndSize,
  onCloseSetup
}: ButtonAnimationPickerPageProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<ButtonActivationAnimationPresetId | "">(
    button?.activationAnimation?.presetId ?? ""
  );

  useEffect(() => {
    setSelectedPresetId(button?.activationAnimation?.presetId ?? "");
  }, [button?.id, button?.activationAnimation?.presetId]);

  const canApplyPreset = Boolean(
    button && (!selectedPresetId || canButtonRunActivationAnimation(button))
  );

  return (
    <section className="button-animation-picker-page">
      <div className="button-animation-picker-page__panel">
        <div className="button-animation-picker-page__header">
          <h2>Animation</h2>
          <button
            type="button"
            className="button-animation-picker-page__close"
            title="Close Animation"
            aria-label="Close Animation"
            disabled={busy}
            onClick={onClose}
          >
            &#xD7;
          </button>
        </div>
        {button ? (
          <>
            <label>
              <span>Animation</span>
              <select
                value={selectedPresetId}
                disabled={busy}
                onChange={(event) => {
                  setSelectedPresetId(event.currentTarget.value as ButtonActivationAnimationPresetId | "");
                }}
              >
                <option value="">No animation</option>
                {BUTTON_ACTIVATION_ANIMATION_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
            </label>
            <button
              className="button-animation-picker-page__apply"
              type="button"
              disabled={busy || !canApplyPreset}
              onClick={() => void onApply(selectedPresetId || null)}
            >
              Apply
            </button>
            {button.activationAnimation ? (
              <div className="button-animation-picker-page__setup-actions">
                {setupOpen ? (
                  <>
                    <button type="button" disabled={busy} onClick={onSavePositionAndSize}>
                      Save position and size
                    </button>
                    <button type="button" disabled={busy} onClick={onCloseSetup}>
                      Close setup
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !canButtonRunActivationAnimation(button)}
                    onClick={onPositionAndSize}
                  >
                    Position and size
                  </button>
                )}
              </div>
            ) : null}
            {setupOpen ? (
              <p className="button-animation-picker-page__hint">
                This plus is the animation's largest size. Drag it to move; drag any
                invisible edge or corner to resize at its locked 283:295 shape, then save here.
              </p>
            ) : null}
            {!canButtonRunActivationAnimation(button) ? (
              <p className="button-animation-picker-page__hint">
                New animations are available on Buttons that dispatch an action. Choose No animation to remove a dormant assignment.
              </p>
            ) : null}
          </>
        ) : (
          <p>Select a Button placement.</p>
        )}
      </div>
    </section>
  );
}
