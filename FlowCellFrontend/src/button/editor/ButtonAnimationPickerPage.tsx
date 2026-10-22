import { useEffect, useState } from "react";
import type {
  ButtonActivationAnimationPresetId,
  ButtonAnimationFrequency,
  ButtonRecord
} from "../types";
import {
  BUTTON_ACTIVATION_ANIMATION_PRESETS,
  canButtonRunActivationAnimation,
  getButtonActivationAnimationPreset,
  getButtonAnimationFrequency,
  isButtonAnimationFrequency
} from "../animations/buttonActivationAnimations";

export interface ButtonAnimationPickerPageProps {
  button: ButtonRecord | null;
  busy?: boolean;
  setupOpen: boolean;
  onClose: () => void;
  onApply: (
    presetId: ButtonActivationAnimationPresetId | null,
    opacity: number,
    frequency: ButtonAnimationFrequency
  ) => void | Promise<void>;
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
  const [transparency, setTransparency] = useState(
    Math.round((1 - (button?.activationAnimation?.opacity ?? 1)) * 100)
  );
  const savedFrequency = button?.activationAnimation
    ? getButtonAnimationFrequency(button.activationAnimation)
    : { mode: "every-press" } as const;
  const savedFrequencyKey = JSON.stringify(savedFrequency);
  const [frequency, setFrequency] = useState<ButtonAnimationFrequency>(savedFrequency);

  useEffect(() => {
    setSelectedPresetId(button?.activationAnimation?.presetId ?? "");
  }, [button?.id, button?.activationAnimation?.presetId]);

  useEffect(() => {
    setTransparency(Math.round((1 - (button?.activationAnimation?.opacity ?? 1)) * 100));
  }, [button?.id, button?.activationAnimation?.opacity]);

  useEffect(() => {
    setFrequency(JSON.parse(savedFrequencyKey) as ButtonAnimationFrequency);
  }, [button?.id, savedFrequencyKey]);

  const validFrequency = isButtonAnimationFrequency(frequency);
  const canApplyPreset = Boolean(
    button && (!selectedPresetId || (canButtonRunActivationAnimation(button) && validFrequency))
  );
  const appliedPreset = button?.activationAnimation
    ? getButtonActivationAnimationPreset(button.activationAnimation.presetId)
    : null;

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
                  const presetId = event.currentTarget.value as ButtonActivationAnimationPresetId | "";
                  setSelectedPresetId(presetId);
                  if (presetId) {
                    setFrequency(getButtonAnimationFrequency(
                      button.activationAnimation?.presetId === presetId
                        ? button.activationAnimation
                        : { presetId }
                    ));
                  }
                }}
              >
                <option value="">No animation</option>
                {BUTTON_ACTIVATION_ANIMATION_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
            </label>
            {selectedPresetId ? (
              <>
                <label>
                  <span>Frequency</span>
                  <select
                    aria-label="Animation frequency"
                    value={frequency.mode}
                    disabled={busy}
                    onChange={(event) => {
                      const mode = event.currentTarget.value as ButtonAnimationFrequency["mode"];
                      const presses = frequency.mode === "every-n-presses"
                        ? frequency.presses
                        : frequency.mode === "random-presses" ? frequency.minimum : 1;
                      setFrequency(mode === "every-press"
                        ? { mode }
                        : mode === "every-n-presses"
                          ? { mode, presses }
                          : { mode, minimum: presses, maximum: presses });
                    }}
                  >
                    <option value="every-press">Every press</option>
                    <option value="every-n-presses">Every N presses</option>
                    <option value="random-presses">Random interval</option>
                  </select>
                </label>
                {frequency.mode === "every-n-presses" ? (
                  <label>
                    <span>Play every N presses</span>
                    <input
                      type="number"
                      aria-label="Play every N presses"
                      min={1}
                      max={10000}
                      step={1}
                      value={Number.isFinite(frequency.presses) ? frequency.presses : ""}
                      disabled={busy}
                      onChange={(event) => setFrequency({ ...frequency, presses: event.currentTarget.valueAsNumber })}
                    />
                  </label>
                ) : null}
                {frequency.mode === "random-presses" ? (
                  <>
                    <label>
                      <span>Minimum presses</span>
                      <input
                        type="number"
                        aria-label="Minimum presses"
                        min={1}
                        max={10000}
                        step={1}
                        value={Number.isFinite(frequency.minimum) ? frequency.minimum : ""}
                        disabled={busy}
                        onChange={(event) => setFrequency({ ...frequency, minimum: event.currentTarget.valueAsNumber })}
                      />
                    </label>
                    <label>
                      <span>Maximum presses</span>
                      <input
                        type="number"
                        aria-label="Maximum presses"
                        min={1}
                        max={10000}
                        step={1}
                        value={Number.isFinite(frequency.maximum) ? frequency.maximum : ""}
                        disabled={busy}
                        onChange={(event) => setFrequency({ ...frequency, maximum: event.currentTarget.valueAsNumber })}
                      />
                    </label>
                  </>
                ) : null}
                {!validFrequency ? (
                  <p className="button-animation-picker-page__hint">
                    Enter whole numbers from 1 to 10,000. The minimum cannot exceed the maximum.
                  </p>
                ) : null}
                <label>
                  <span>Transparency: {transparency}%</span>
                  <input
                    type="range"
                    aria-label="Animation transparency"
                    min={0}
                    max={100}
                    step={1}
                    value={transparency}
                    disabled={busy}
                    onChange={(event) => setTransparency(Number(event.currentTarget.value))}
                  />
                </label>
              </>
            ) : null}
            <button
              className="button-animation-picker-page__apply"
              type="button"
              disabled={busy || !canApplyPreset}
              onClick={() => void onApply(selectedPresetId || null, 1 - transparency / 100, frequency)}
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
                {appliedPreset?.id === "plus-rise"
                  ? "This plus is the animation's largest size."
                  : "This preview is the animation's playback size."}{" "}
                Drag it to move; drag any invisible edge or corner to resize at its locked{" "}
                {appliedPreset?.spritePixelSize.width}:{appliedPreset?.spritePixelSize.height}{" "}
                shape, then save here.
              </p>
            ) : null}
            {selectedPresetId && frequency.mode !== "every-press" ? (
              <p className="button-animation-picker-page__hint">
                Press progress is remembered between sessions.
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
