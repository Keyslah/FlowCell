import {
  BUTTON_SKIN_COMPILER_VERSION,
  type ButtonSkin
} from "../types.js";

export const DEFAULT_BUTTON_SKIN_ID = "skin-default-neutral";

export const DEFAULT_BUTTON_SKIN: ButtonSkin = {
  id: DEFAULT_BUTTON_SKIN_ID,
  name: "Default Neutral",
  structure: `<div data-core style="display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;padding:10px 18px;border-radius:10px;white-space:nowrap;text-align:center;background:var(--button-bg,#292d34);border:1px solid var(--button-edge,#555c67);color:var(--button-ink,#f1f3f5);font:600 13px 'Segoe UI',system-ui,sans-serif;transition:background 140ms ease,border-color 140ms ease,transform 100ms ease;transform:scale(var(--button-scale,1));">{{label}}</div>`,
  keyframes: "",
  base: [
    "--button-bg:#292d34",
    "--button-edge:#555c67",
    "--button-ink:#f1f3f5",
    "--button-scale:1"
  ].join(";"),
  hover: "--button-bg:#353b45;--button-edge:#707987",
  play: "",
  pressed: "--button-bg:#22262c;--button-scale:0.97",
  held: "--button-edge:#8b96a8",
  release: "--button-scale:1",
  disabled: "--button-bg:#24272c;--button-edge:#3a3f47;--button-ink:#777f8a",
  error: "--button-edge:#d26161",
  metadata: { bundled: true },
  compileCache: {
    compilerVersion: BUTTON_SKIN_COMPILER_VERSION,
    sourceFingerprint: "bundled-default-neutral-v1"
  }
};
