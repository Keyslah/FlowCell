import type { ButtonPlacement, ButtonSkin, ButtonStateDocument, RegularButtonPopoutUnit } from "../types.js";
import { DEFAULT_BUTTON_SKIN_ID } from "../skins/defaultButtonSkin.js";
import { cloneButtonDocument } from "./buttonDefaults.js";

// Exact authored desktop arrangement from the existing Collections popup.
// Legacy source filenames identify the same installed scripts after source migration.
const COLLECTIONS_BUTTONS = [
  {
    "fileName": "snapshot.py",
    "legacyFileName": "button-migrated-732f25b29e66e1b3.flowcell-source.json",
    "label": "snapshot",
    "x": 0,
    "y": 0,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-snapshot-24273fe741dff36b.flowcell-source.json"
  },
  {
    "fileName": "back.py",
    "legacyFileName": "button-migrated-33a48533bd7bb56e.flowcell-source.json",
    "label": "back",
    "x": 92.25982793135026,
    "y": 0,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-back-977e41cdcd1fdf74.flowcell-source.json"
  },
  {
    "fileName": "rename selected.py",
    "legacyFileName": "button-migrated-59ec159fcc065765.flowcell-source.json",
    "label": "rename",
    "x": 184.51965586270052,
    "y": 0,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-rename-selected-0c5d71230b8a13fd.flowcell-source.json"
  },
  {
    "fileName": "restore.py",
    "legacyFileName": "button-migrated-9ce6d0b70319a0d5.flowcell-source.json",
    "label": "restore",
    "x": 276.77948379405075,
    "y": 0,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-restore-a4756e503bf2d00b.flowcell-source.json"
  },
  {
    "fileName": "cycle collection",
    "legacyFileName": "button-migrated-ffab1a6d8ba276ba.flowcell-source.json",
    "label": "Cycle Collection",
    "x": 0,
    "y": 44,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-cycle-collection-392908b010e66caa.flowcell-source.json"
  },
  {
    "fileName": "cycle versions back.py",
    "legacyFileName": "button-migrated-bba360f269618b3f.flowcell-source.json",
    "label": ">",
    "x": 92.25982793135026,
    "y": 44,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-cycle-versions-back-9848576ccba11075.flowcell-source.json"
  },
  {
    "fileName": "cycle versions forward.py",
    "legacyFileName": "button-migrated-0f0658a2a4083677.flowcell-source.json",
    "label": "<",
    "x": 184.51965586270052,
    "y": 44,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-cycle-versions-forward-01752f77775816cb.flowcell-source.json"
  },
  {
    "fileName": "empty trash.py",
    "legacyFileName": "button-migrated-1ad5412302415527.flowcell-source.json",
    "label": "empty trash",
    "x": 276.77948379405075,
    "y": 44,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-empty-trash-e6f8f6984ec4bebb.flowcell-source.json"
  },
  {
    "fileName": "baseline visibility.py",
    "legacyFileName": "button-migrated-92ebbf1a4bec6edb.flowcell-source.json",
    "label": "base V",
    "x": 0,
    "y": 88,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-baseline-visibility-3903df36c83e2ef7.flowcell-source.json"
  },
  {
    "fileName": "restore visibility.py",
    "legacyFileName": "button-migrated-a24cd3848d611c52.flowcell-source.json",
    "label": "restore V",
    "x": 92.25982793135026,
    "y": 88,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-restore-visibility-7a3bde3525b2185a.flowcell-source.json"
  },
  {
    "fileName": "add to live.py",
    "legacyFileName": "button-migrated-0a3948162cf1c2af.flowcell-source.json",
    "label": "add to live",
    "x": 184.51965586270052,
    "y": 88,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-add-to-live-6bc83eb76f60d805.flowcell-source.json"
  },
  {
    "fileName": "trash.py",
    "legacyFileName": "button-migrated-612d93488b42b835.flowcell-source.json",
    "label": "trash",
    "x": 276.77948379405075,
    "y": 88,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-trash-9992649bd492edb7.flowcell-source.json"
  },
  {
    "fileName": "archive.py",
    "legacyFileName": "button-migrated-3a5453e36785edf5.flowcell-source.json",
    "label": "archive",
    "x": 0,
    "y": 132,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-archive-90327748ee0a4d43.flowcell-source.json"
  },
  {
    "fileName": "make collections.py",
    "legacyFileName": "button-migrated-e8a7dc905a589b14.flowcell-source.json",
    "label": "Make Collections",
    "x": 92.25982793135026,
    "y": 132,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-make-collections-41348343f8d5b599.flowcell-source.json"
  },
  {
    "fileName": "empty collections.py",
    "legacyFileName": "button-migrated-dce4f2bf2f6beed2.flowcell-source.json",
    "label": "empty collections",
    "x": 184.51965586270052,
    "y": 132,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-empty-collections-47f1d0b33fb54e94.flowcell-source.json"
  },
  {
    "fileName": "sort live.py",
    "legacyFileName": "button-migrated-7c6aa015489893fa.flowcell-source.json",
    "label": "Sort Live",
    "x": 276.77948379405075,
    "y": 132,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-sort-live-83fae983e7891070.flowcell-source.json"
  },
  {
    "fileName": "new collection.py",
    "legacyFileName": "button-migrated-cc7880447911485a.flowcell-source.json",
    "label": "+collection",
    "x": 0,
    "y": 176,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-new-collection-abaa4d1b59863fa2.flowcell-source.json"
  },
  {
    "fileName": "sort.py",
    "legacyFileName": "button-migrated-51d0ad516a44f4d7.flowcell-source.json",
    "label": "sort",
    "x": 92.25982793135026,
    "y": 176,
    "width": 92.25982793135026,
    "height": 44,
    "bundledFileName": "bundled-blender-blender-sort-76c92e43c16849a3.flowcell-source.json"
  }
] as const;

// Retained from the existing saved Green Highlight choice, independently of the gray default.
const COLLECTIONS_GREEN_SKIN: ButtonSkin = {
  "base": "--flowcell-button-highlight-on-hover:1;--flowcell-button-color-surface:#8FDB0A;\r\n--flowcell-button-shade-surface-face-light:var(--flowcell-button-color-surface,#E6E6E6);\r\n--flowcell-button-shade-surface-face-dark:color-mix(in oklch,var(--flowcell-button-color-surface,#E6E6E6) 83.2412698031%,black);\r\n--flowcell-button-color-text:#050505;\r\n--flowcell-button-shade-text-dark:var(--flowcell-button-color-text,#191919);\r\n--flowcell-button-shade-text-light:color-mix(in oklch,var(--flowcell-button-color-text,#191919) 74.6482056525%,white);\r\n--fc-skeuo-outer-shadow: 0 0.05em 0.05em -0.01em rgba(5,5,5,1), 0 0.01em 0.01em -0.01em rgba(5,5,5,0.5), 0.15em 0.3em 0.1em -0.01em rgba(5,5,5,0.25);\r\n--fc-skeuo-inner-clip: inset(0 0 0 0 round 100em);\r\n--fc-skeuo-inner-shadow: 0 0 0 0 inset rgba(5,5,5,0.1), -0.05em -0.05em 0.05em 0 inset rgba(5,5,5,0.25), 0 0 0 0 inset rgba(5,5,5,0.1), 0 0 0 0 inset rgba(255,255,255,0), 0 0 0 0 inset rgba(255,255,255,0), 0 0 0 0 inset rgba(255,255,255,0), -0.075em -0.25em 0.25em 0.1em inset rgba(5,5,5,0.25);\r\n--fc-skeuo-inner-transform: scale(1);\r\n--fc-skeuo-label-transform: scale(1);",
  "compileCache": null,
  "disabled": "",
  "error": "",
  "held": "--fc-skeuo-inner-transform: scale(0.975);",
  "hover": "--fc-skeuo-outer-shadow: 0 0 0 0 rgba(5,5,5,1), 0 0 0 0 rgba(5,5,5,0.5), 0 0 0 0 rgba(5,5,5,0.25);\r\n--fc-skeuo-inner-clip: inset(clamp(1px,0.0625em,2px) clamp(1px,0.0625em,2px) clamp(1px,0.0625em,2px) clamp(1px,0.0625em,2px) round 100em);\r\n--fc-skeuo-inner-shadow: 0.1em 0.15em 0.05em 0 inset rgba(5,5,5,0.75), -0.025em -0.03em 0.05em 0.025em inset rgba(5,5,5,0.5), 0.25em 0.25em 0.2em 0 inset rgba(5,5,5,0.5), 0 0 0 0 inset rgba(255,255,255,0), 0 0 0 0 inset rgba(255,255,255,0), 0 0 0 0 inset rgba(255,255,255,0), -0.075em -0.12em 0.2em 0.1em inset rgba(5,5,5,0.25);\r\n--fc-skeuo-label-transform: scale(0.975);",
  "id": "skin-blender-collections-green-highlight",
  "keyframes": "",
  "metadata": {
    "bundled": true
  },
  "name": "Collections Green Highlight",
  "play": "",
  "pressed": "--fc-skeuo-inner-transform: scale(0.975);",
  "release": "",
  "structure": "<div data-core style=\"display:inline-flex;position:relative;box-sizing:content-box;font-family:'Inter 18pt','Inter','Segoe UI',sans-serif;font-size:16px;line-height:20px;border-radius:100em;background-color:rgba(0,0,0,0.75);box-shadow:-0.15em -0.15em 0.15em -0.075em rgba(5,5,5,0.25),0.0375em 0.0375em 0.0675em 0 rgba(5,5,5,0.1);cursor:pointer;-webkit-tap-highlight-color:rgba(0,0,0,0);\">\r\n  <div style=\"position:absolute;z-index:0;box-sizing:content-box;width:calc(100% + 0.3em);height:calc(100% + 0.3em);top:-0.15em;left:-0.15em;border-radius:inherit;background:linear-gradient(-135deg,rgba(5,5,5,0.5),transparent 20%,transparent 100%);filter:blur(0.0125em);opacity:0.25;mix-blend-mode:multiply;pointer-events:none;\"></div>\r\n  <div style=\"display:flex;flex:1 1 auto;min-width:0;min-height:0;position:relative;z-index:1;box-sizing:border-box;border-radius:inherit;transition:box-shadow 300ms ease;will-change:box-shadow;box-shadow:var(--fc-skeuo-outer-shadow,0 0.05em 0.05em -0.01em rgba(5,5,5,1),0 0.01em 0.01em -0.01em rgba(5,5,5,0.5),0.15em 0.3em 0.1em -0.01em rgba(5,5,5,0.25));pointer-events:none;\">\r\n    <div style=\"--inset:0.035em;display:flex;flex:1 1 auto;min-width:0;min-height:0;align-items:center;justify-content:center;position:relative;z-index:1;box-sizing:border-box;border-radius:inherit;padding:1em 1.5em;background-image:linear-gradient(135deg,var(--flowcell-button-shade-surface-face-light,rgba(230,230,230,1)),var(--flowcell-button-shade-surface-face-dark,rgba(180,180,180,1)));transition:box-shadow 300ms ease,clip-path 250ms ease,background-image 250ms ease,transform 250ms ease;will-change:box-shadow,clip-path,background-image,transform;overflow:clip;clip-path:var(--fc-skeuo-inner-clip,inset(0 0 0 0 round 100em));box-shadow:var(--fc-skeuo-inner-shadow,0 0 0 0 inset rgba(5,5,5,0.1),-0.05em -0.05em 0.05em 0 inset rgba(5,5,5,0.25),0 0 0 0 inset rgba(5,5,5,0.1),0 0 0 0 inset rgba(255,255,255,0),0 0 0 0 inset rgba(255,255,255,0),0 0 0 0 inset rgba(255,255,255,0),-0.075em -0.25em 0.25em 0.1em inset rgba(5,5,5,0.25));transform:var(--fc-skeuo-inner-transform,scale(1));pointer-events:none;\">\r\n      <span style=\"position:relative;z-index:4;box-sizing:border-box;font-family:'Inter',sans-serif;font-size:16px;line-height:20px;letter-spacing:-0.05em;font-weight:500;color:rgba(0,0,0,0);background-image:linear-gradient(135deg,var(--flowcell-button-shade-text-dark,rgba(25,25,25,1)),var(--flowcell-button-shade-text-light,rgba(75,75,75,1)));-webkit-background-clip:text;background-clip:text;transition:transform 250ms ease;display:block;will-change:transform;text-shadow:rgba(0,0,0,0.1) 0 0 0.1em;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;transform:var(--fc-skeuo-label-transform,scale(1));pointer-events:none;\">{{label}}</span>\r\n    </div>\r\n  </div>\r\n</div>"
};

export const COLLECTIONS_POPOUT_PRESETS = [
  { id: "default-gray", label: "Collections — Default Gray" },
  { id: "green-highlight", label: "Collections — Green Highlight" }
] as const;
export type PanelPopoutPresetId = typeof COLLECTIONS_POPOUT_PRESETS[number]["id"];

function collectionsPresetPlacements(document: ButtonStateDocument, unit: Pick<RegularButtonPopoutUnit, "memberPlacementIds" | "ownerPlacementId">): ButtonPlacement[] | null {
  if (unit.memberPlacementIds.length !== COLLECTIONS_BUTTONS.length || unit.ownerPlacementId) return null;
  const members = unit.memberPlacementIds.map((id) => document.placements[id]);
  const records = members.map((placement) => placement && document.buttons[placement.buttonId]);
  if (records.some((button) => !button || button.sourceIdentity?.normalizedProgramName !== "blender" ||
    button.sourceIdentity.normalizedPanelName !== "collections")) return null;
  const result: ButtonPlacement[] = [];
  for (const entry of COLLECTIONS_BUTTONS) {
    const matches = records.flatMap((button, index) => {
      if (!button) return [];
      const file = button.sourceIdentity!.normalizedFileName.split(/[\\/]/).at(-1);
      return file === entry.fileName || file === entry.legacyFileName || file === entry.bundledFileName
        ? [members[index]] : [];
    });
    if (matches.length !== 1 || result.includes(matches[0])) return null;
    result.push(matches[0]);
  }
  return result;
}

export function availablePanelPopoutPresets(document: ButtonStateDocument, unit: RegularButtonPopoutUnit) {
  return collectionsPresetPlacements(document, unit) ? COLLECTIONS_POPOUT_PRESETS : [];
}

export function availablePanelPopoutPresetsForPanel(document: ButtonStateDocument, programName: string, panelName: string) {
  if (programName.trim().toLowerCase() !== "blender" || panelName.trim().toLowerCase() !== "collections") return [];
  const memberPlacementIds = Object.values(document.placements).filter((placement) => {
    const identity = document.buttons[placement.buttonId]?.sourceIdentity;
    return document.surfaces[placement.surfaceId]?.kind === "panel" &&
      identity?.normalizedProgramName === "blender" && identity.normalizedPanelName === "collections";
  }).map((placement) => placement.id);
  return collectionsPresetPlacements(document, { memberPlacementIds, ownerPlacementId: null }) ? COLLECTIONS_POPOUT_PRESETS : [];
}

export function panelPopoutPresetPath(preset: PanelPopoutPresetId): string {
  return `flowcell-preset:blender-collections/${preset}`;
}

export function panelPopoutPresetFromPath(path: string): PanelPopoutPresetId | null {
  return COLLECTIONS_POPOUT_PRESETS.find((preset) => panelPopoutPresetPath(preset.id) === path)?.id ?? null;
}

/** Apply an explicitly chosen authored popup without changing shared actions or Main presentation. */
export function applyPanelPopoutPreset(
  document: ButtonStateDocument, unit: RegularButtonPopoutUnit, preset: PanelPopoutPresetId = "default-gray"
): boolean {
  const placements = collectionsPresetPlacements(document, unit);
  if (!placements) return false;
  if (preset === "green-highlight") document.skins[COLLECTIONS_GREEN_SKIN.id] = cloneButtonDocument(COLLECTIONS_GREEN_SKIN);
  const surface = document.surfaces[unit.surfaceId];
  placements.forEach((placement, index) => {
    const entry = COLLECTIONS_BUTTONS[index];
    Object.assign(placement, { x: entry.x, y: entry.y, width: entry.width, height: entry.height, zIndex: index,
      skinOverrideId: preset === "green-highlight" ? COLLECTIONS_GREEN_SKIN.id : DEFAULT_BUTTON_SKIN_ID,
      textFitMode: "shrink", textAlignment: "skin", textOffsetX: 0, textOffsetY: 0,
      textSizeOverride: null, minimumFontSize: 8, matchHitboxToSkin: false, allowStretching: false,
      allowLabelResize: false, highlightOnHover: false,
      presentationOverride: { ...placement.presentationOverride, label: entry.label }
    });
    if (document.themeOverrides) delete document.themeOverrides[placement.id];
  });
  surface.placementIds = placements.map((placement) => placement.id);
  surface.width = 680;
  surface.height = 268;
  surface.uniformButtonSize = { width: 92.25982793135026, height: 44 };
  unit.memberPlacementIds = [...surface.placementIds];
  unit.memberSourceIdentities = placements.map((placement) => cloneButtonDocument(document.buttons[placement.buttonId].sourceIdentity!));
  unit.canonicalBounds = { x: 0, y: 0, width: surface.width, height: surface.height };
  unit.desktopBoundsEnvelope = { ...unit.canonicalBounds };
  unit.desktopBounds = null;
  unit.windowFitMode = "surface";
  unit.desktopBoundsFitMode = "surface";
  return true;
}
