// Temporary dev harness for reproducing Skin Editor bugs outside Tauri.
// Not part of the app; delete after use.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ButtonSkinEditor } from "./button/editor/ButtonSkinEditor";
import { ButtonSkinRenderer } from "./button/skins/ButtonSkinRenderer";
import type { ButtonPlacement, ButtonSkin } from "./button/types";
import "./app.css";
import "./button/editor/buttonEditor.css";

const USER_SKIN: ButtonSkin = {
  "id": "skin-24c8ad6c-60a6-4109-b7e9-9d5066185b0a",
  "name": "New Skin 2",
  "structure": "<div data-core style=\"\n  position: relative; display: inline-flex; align-items: center; justify-content: center;\n  cursor: pointer; padding: 1px; border-radius: 999px; box-sizing: border-box;\n  font: bold 1rem 'Rubik', system-ui, sans-serif; line-height: 1;\n  color: var(--ycb-ink, #292524); background: #292524;\n  transform: translate(var(--ycb-shift, -4px), var(--ycb-shift, -4px));\n  box-shadow: var(--ycb-shadow,\n    0.5px 0.5px 0 0 #292524, 1px 1px 0 0 #292524, 1.5px 1.5px 0 0 #292524,\n    2px 2px 0 0 #292524, 2.5px 2.5px 0 0 #292524, 3px 3px 0 0 #292524,\n    0 0 0 2px #fafaf9, 0.5px 0.5px 0 2px #fafaf9, 1px 1px 0 2px #fafaf9,\n    1.5px 1.5px 0 2px #fafaf9, 2px 2px 0 2px #fafaf9, 2.5px 2.5px 0 2px #fafaf9,\n    3px 3px 0 2px #fafaf9, 3.5px 3.5px 0 2px #fafaf9, 4px 4px 0 2px #fafaf9);\n  transition: transform 150ms ease, box-shadow 150ms ease;\">\n  <div style=\"\n    position: relative; display: inline-flex; align-items: center; justify-content: center;\n    overflow: hidden; border-radius: 999px;\n    background: var(--ycb-face, #facc15); border: 2px solid rgba(255,255,255,0.3);\">\n    <div data-anim=\"ycbdots\" style=\"\n      position: absolute; inset: 0; border-radius: 999px; opacity: 0.5; pointer-events: none;\n      background-image:\n        radial-gradient(rgba(255,255,255,0.8) 20%, transparent 20%),\n        radial-gradient(rgba(255,255,255,1) 20%, transparent 20%);\n      background-position: 0 0, 4px 4px; background-size: 8px 8px;\n      mix-blend-mode: hard-light;\"></div>\n    <span style=\"\n      position: relative; display: flex; align-items: center; justify-content: center;\n      padding: 0.75rem 1.25rem; gap: 0.25rem; white-space: nowrap;\n      filter: drop-shadow(0 -1px 0 rgba(255,255,255,0.25));\">{{label}}</span>\n  </div>\n</div>",
  "keyframes": "@keyframes ycb-dots {\n  0%   { background-position: 0 0, 4px 4px; }\n  100% { background-position: 8px 0, 12px 4px; }\n}",
  "base": "",
  "hover": "--ycb-shift: 0px;\n--ycb-shadow: 0 0 0 2px #fafaf9;",
  "play": "",
  "pressed": "--ycb-shift: 0px;\n--ycb-shadow: 0 0 0 2px #fafaf9;\n--ycb-face: #eab308;",
  "held": "",
  "release": "--ycb-shift: -5px;",
  "disabled": "--ycb-face: #b9b7ac;\n--ycb-ink: rgba(41,37,36,0.45);",
  "error": "--ycb-face: #f0a5a5;",
  "metadata": {},
  "compileCache": {
    "compilerVersion": 1,
    "sourceFingerprint": "2ee6833e"
  }
} as unknown as ButtonSkin;

const HARNESS_PLACEMENT: ButtonPlacement = {
  id: "dev-harness-placement",
  buttonId: "dev-harness-button",
  surfaceId: "dev-harness-surface",
  x: 0,
  y: 0,
  width: 140,
  height: 56,
  zIndex: 0,
  skinOverrideId: USER_SKIN.id,
  textFitMode: "shrink-and-stack",
  textAlignment: "skin",
  textOffsetX: 0,
  textOffsetY: 0,
  minimumFontSize: 8,
  textSizeOverride: null,
  allowLabelResize: false,
  matchHitboxToSkin: false,
  allowStretching: false,
  visualStateMap: null,
  resizeAnchor: "top-left"
};

function Harness() {
  const [skin, setSkin] = useState<ButtonSkin>(() => structuredClone(USER_SKIN));
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <div style={{ display: "flex", gap: 24, padding: 16, alignItems: "flex-start", background: "#1c2126", minHeight: "100vh", color: "#e8edef" }}>
      <div style={{ width: 420 }} data-harness-editor>
        <ButtonSkinEditor
          skin={skin}
          skins={[skin]}
          skinContextKey="dev-harness"
          busy={false}
          placement={HARNESS_PLACEMENT}
          surfaceButtonCount={1}
          allSurfaceButtonsSameSize={false}
          buttonLabel="Button Preview"
          activationBehavior={null}
          visualStateMap={null}
          onButtonLabelChange={() => {}}
          onActivationBehaviorChange={() => {}}
          onVisualStateMapChange={() => {}}
          onApplyButtonStateSetup={() => {}}
          onApplyAllButtonText={() => {}}
          onAssignSize={() => {}}
          onAssignSizeToPanel={() => {}}
          onPlacementTextChange={() => {}}
          onAssignSkin={(next) => setSkin(next)}
          onAssignSkinToPanel={(next) => setSkin(next)}
          onSaveSkin={(next) => setSkin(next)}
          onSaveAsNewSkin={() => {}}
        />
      </div>
      <div>
        <h3>Constrained preview (140 x 56)</h3>
        <label><input type="checkbox" checked={hovered} onChange={(e) => setHovered(e.currentTarget.checked)} /> hover</label>
        <label style={{ marginLeft: 12 }}><input type="checkbox" checked={pressed} onChange={(e) => setPressed(e.currentTarget.checked)} /> pressed</label>
        <div style={{ padding: 24, background: "#2b3238", display: "inline-block" }} data-harness-preview>
          <ButtonSkinRenderer
            skin={skin}
            label="Pop"
            width={140}
            height={56}
            constrained
            textFitMode="shrink-and-stack"
            minimumFontSize={8}
            hovered={hovered}
            pressed={pressed}
          />
        </div>
        <h3>Current base section</h3>
        <pre data-harness-base style={{ maxWidth: 480, whiteSpace: "pre-wrap", border: "1px solid #444", padding: 8 }}>{skin.base}</pre>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>
);
