import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createButtonStateDocument
} from "./.compiled-button-system/button/state/buttonDefaults.js";

const frontendRoot = join(import.meta.dirname, "..");
import {
  normalizeLoadedButtonStateDocument,
  parseButtonStateDocumentJson,
  validateButtonStateDocument
} from "./.compiled-button-system/button/state/buttonStateValidation.js";
import {
  createButtonSourceIdentity,
  deriveRegularPopoutSelectionKey,
  resolveButtonFanSetups,
  resolvePanelOwnerButton,
  resolveRegularButtonPopout,
  resolveToolSetOwnerPopout,
  splitMixedButtonPopSelection
} from "./.compiled-button-system/button/state/sourceIdentity.js";
import {
  applyNamedButtonSkinSections,
  parseButtonSkinPaste
} from "./.compiled-button-system/button/skins/skinPasteParser.js";
import {
  buttonSkinNameFromPath,
  createEmptyButtonSkinSections,
  serializeButtonSkinSections
} from "./.compiled-button-system/button/skins/buttonSkinFormat.js";
import {
  BUTTON_SKIN_RECENT_FILE_LIMIT,
  createButtonSkinFromFile,
  normalizeButtonSkinRecentFiles,
  readButtonSkinRecentFiles,
  rememberButtonSkinRecentFile,
  writeButtonSkinRecentFiles
} from "./.compiled-button-system/button/editor/buttonSkinFiles.js";
import {
  validateButtonSkin
} from "./.compiled-button-system/button/skins/skinValidator.js";
import {
  compileButtonSkin
} from "./.compiled-button-system/button/skins/skinCompiler.js";
import {
  BUTTON_VISUAL_SETTLE_FRAMES,
  resolveButtonVisualSamplingDecision
} from "./.compiled-button-system/button/skins/buttonVisualSampling.js";
import {
  buttonVisualMotionBlocksStateChange,
  commitPreparedButtonVisual,
  createButtonVisualLatch,
  finishButtonVisualMotion,
  requestButtonVisual,
  settleButtonVisualMotionProbe
} from "./.compiled-button-system/button/runtime/buttonVisualLatch.js";
import {
  applyButtonLabelTextOffset
} from "./.compiled-button-system/button/skins/buttonTextOffset.js";
import {
  buttonRectsOverlap,
  buildButtonReorderRowCandidates,
  chooseButtonReorderRowCandidate,
  compactButtonPlacementRows,
  compactButtonPlacements,
  compactUniformButtonPlacements,
  inferButtonPlacementRows,
  inferButtonPlacementRowProfile,
  lockButtonRectAspect,
  normalizeButtonScreenMeasurement,
  reorderButtonPlacementIds,
  resolveAspectLockedButtonGeometry,
  resolveAspectLockedButtonGeometryAlongPath,
  resolveButtonSkinScale,
  resolveButtonRenderedCssScale,
  resolveButtonShadowScreenOffsets,
  resolveButtonGeometry,
  resolveButtonGeometryAlongPath,
  validateExactButtonLayoutGeometry
} from "./.compiled-button-system/button/geometry/buttonGeometry.js";
import {
  applyLabelResizePolicy,
  resolveDeterministicLabelGrowth
} from "./.compiled-button-system/button/geometry/labelGrowth.js";
import {
  buttonTextFitAllowsMultipleLines,
  computeButtonTextFitPlan
} from "./.compiled-button-system/button/text/textFit.js";
import {
  ensureFanSetup,
  ensureRegularPopout,
  removeOwnedButtonGraph,
  resolveDiscardedStagedOwnerButtonIds,
  resolveUninstallOwnerButtonIds
} from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import {
  FRONTEND_MACRO_CORE_ACTION_ID,
  attachCanonicalFrontendMacroButton,
  isCanonicalFrontendMacroButton,
  removeCanonicalFrontendMacroButtonGraphs
} from "./.compiled-button-system/button/state/frontendMacroButtonOperations.js";
import {
  applyInstalledSourceUpdate
} from "./.compiled-button-system/button/state/sourceUpdateOperations.js";
import {
  removedInstalledPageOwnerIds,
  scopedInstalledPageOwnerIds
} from "./.compiled-button-system/button/state/installedPageLifecycle.js";
import {
  buttonStateDocumentsEqual,
  reconcileBundledProgramSources
} from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import {
  findPanelOwnerButton,
  initialPanelOwnerButtonId,
  initialPanelOwnerMainPlacementId,
  initialProgramPanelOwnerSurfaceId,
  reconcileProgramPanelOwners,
  removePanelOwnerGraph,
  removeProgramPanelOwnerGraphs,
  renamePanelOwnerIdentity,
  renameProgramPanelOwnerIdentities,
  resolvePanelOwnerFanPlacement,
  resolvePanelOwnerMainPlacement
} from "./.compiled-button-system/button/state/panelOwnerButtonOperations.js";
import {
  removePanelButtonDocumentScope,
  removeProgramButtonDocumentScope,
  renamePanelButtonDocumentScope,
  renameProgramButtonDocumentScope
} from "./.compiled-button-system/button/state/buttonDocumentScopeOperations.js";
import {
  executeButtonRecord,
  isToolSetChildStateSelected,
  registerButtonCoreAction,
  resolveButtonPressEventPlan
} from "./.compiled-button-system/button/runtime/ButtonRuntimeAdapter.js";
import {
  mappedToolPackageFields
} from "./.compiled-button-system/button/runtime/toolPackageMapping.js";
import {
  buttonDesktopBoundsInsideCanvas,
  buttonDesktopBoundsToCanvasRect,
  buttonDesktopBoundsFromFlowCellBounds,
  buttonWindowRectContainsPoint,
  isUsableButtonWindowBounds,
  physicalSurfaceSize,
  resolveAspectLockedWindowBounds,
  resolveButtonFrameForScaleFactor,
  resolveButtonWebviewPixelRatio,
  resolveButtonWindowClientPoint,
  resolveButtonWindowEnvelope,
  resolveExpandedPopoutBounds,
  resolveFixedButtonCanvasBounds,
  resolveInitialPhysicalButtonWindowEnvelopeBounds,
  resolveMeasuredCollapsedButtonBounds,
  resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin,
  resolvePhysicalButtonWindowEnvelopeBounds,
  resolvePopoutBoundsAfterDrag,
  resolveUniformSurfaceScale,
  resolveTargetButtonWebviewPixelRatio,
  shouldBypassButtonWindowGeometryTransition,
  translateButtonDesktopBounds
} from "./.compiled-button-system/button/windows/buttonWindowGeometry.js";
import {
  createNativeCursorIgnoreController,
  isNativeQueryRevisionCurrent,
  shouldIgnoreButtonWindowCursor
} from "./.compiled-button-system/button/windows/nativeCursorIgnoreController.js";
import {
  readRegisteredLayoutWindow,
  registerLayoutWindow
} from "./.compiled-button-system/lib/layoutSnapshots.js";
import {
  buildButtonEditorButtonOptions,
  buildButtonEditorPanelOptions,
  buildButtonEditorPlacementOptions,
  resolveButtonEditorContextPlacementId,
  resolveButtonEditorIdentity,
  resolveButtonEditorSurfaceSkinTargetPlacementIds,
  resolveButtonEditorPanelSurfaceId,
  resolvePreferredButtonPlacementId
} from "./.compiled-button-system/button/editor/buttonEditorSelection.js";
import {
  buttonActivationCycleStructureMatches
} from "./.compiled-button-system/button/editor/buttonActivationStateStructure.js";
import {
  BUTTON_FAN_EDITOR_HOVER_CLOSE_DELAY_MS,
  createInitialButtonFanDisclosureState,
  reduceButtonFanDisclosure
} from "./.compiled-button-system/button/editor/buttonFanDisclosure.js";
import {
  shouldApplyMatchedButtonMeasurement
} from "./.compiled-button-system/button/editor/buttonMeasurementReconciliation.js";
import {
  buttonPlacementSizingMode,
  buttonPlacementSizingPatch,
  resolveAssignedButtonDimensions
} from "./.compiled-button-system/button/editor/buttonSizeAssignments.js";
import {
  discardStagedButtonInstalls
} from "./.compiled-button-system/button/editor/stagedInstallCleanup.js";

function source(program, panel, file) {
  return createButtonSourceIdentity(program, panel, file);
}

function button(id, role, identity = null) {
  return {
    id,
    role,
    sourceIdentity: identity,
    label: id,
    tooltip: "",
    executionTarget: role === "single-script"
      ? { kind: "panel-script", programName: "Blender", panelName: "Tools", fileName: `${id}.flowcell-source.json` }
      : null,
    defaultSkinId: "skin-default-neutral",
    defaultTextFitMode: "shrink",
    disabled: false,
    activationAnimation: null,
    activationBehavior: null,
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: {}
  };
}

function addScopePanelSurface(document, id, name, buttonIds) {
  const placementIds = buttonIds.map((buttonId) => `placement-${id}-${buttonId}`);
  document.surfaces[id] = {
    id,
    name,
    kind: "panel",
    width: 720,
    height: 120,
    placementIds,
    visualOverflowAllowance: 0
  };
  buttonIds.forEach((buttonId, index) => {
    const placementId = placementIds[index];
    document.placements[placementId] = {
      id: placementId,
      buttonId,
      surfaceId: id,
      x: 8 + index * 176,
      y: 24,
      width: 160,
      height: 44,
      zIndex: index,
      skinOverrideId: null,
      textFitMode: document.buttons[buttonId].defaultTextFitMode,
      textAlignment: "skin",
      textOffsetX: 0,
      textOffsetY: 0,
      minimumFontSize: document.settings.defaultMinimumFontSize,
      textSizeOverride: null,
      allowLabelResize: false,
      matchHitboxToSkin: true,
      allowStretching: false,
      highlightOnHover: false,
      resizeAnchor: "top-left",
      activationCycle: null,
      visualStateMap: null
    };
  });
  return { surfaceId: id, placementIds };
}

function buildButtonDocumentScopeFixture() {
  const document = createButtonStateDocument();
  const scopeScript = button(
    "scope-script",
    "single-script",
    source("Blender", "Tools", "scope-script.flowcell-source.json")
  );
  scopeScript.label = "Scoped Script";
  scopeScript.tooltip = "Keep script presentation";
  scopeScript.metadata = { programName: "Blender", panelName: "Tools", note: "keep" };

  const scopeCore = button(
    "scope-core",
    "single-script",
    source("Blender", "Tools", "scope-core.flowcell-source.json")
  );
  scopeCore.label = "Scoped Core";
  scopeCore.executionTarget = {
    kind: "core-action",
    actionId: "scope-core-action",
    payload: { programName: "Blender", panelName: "Tools", note: "keep" }
  };

  const toolOwner = button(
    "scope-tool-owner",
    "tool-set-owner",
    source("Blender", "Tools", "scope-tool.flowcell-source.json")
  );
  toolOwner.label = "Scoped Tool Set";
  toolOwner.tooltip = "Keep tool-set presentation";
  toolOwner.metadata = { programName: "Blender", panelName: "Tools", note: "keep" };

  const toolChild = {
    ...button("scope-tool-child", "tool-set-child"),
    label: "Scoped Child",
    executionTarget: {
      kind: "tool-set-action",
      programName: "Blender",
      panelName: "Tools",
      ownerFileName: "scope-tool.flowcell-source.json",
      command: "child"
    },
    toolSetParentId: toolOwner.id,
    toolSetBehavior: { execute: true },
    metadata: { programName: "Blender", panelName: "Tools", note: "keep" }
  };

  const siblingPanel = button(
    "sibling-panel",
    "single-script",
    source("Blender", "Other", "sibling-panel.flowcell-source.json")
  );
  siblingPanel.label = "Sibling Panel";
  siblingPanel.executionTarget = {
    kind: "panel-script",
    programName: "Blender",
    panelName: "Other",
    fileName: "sibling-panel.flowcell-source.json"
  };

  const siblingProgram = button(
    "sibling-program",
    "single-script",
    source("Illustrator", "Tools", "sibling-program.flowcell-source.json")
  );
  siblingProgram.label = "Sibling Program";
  siblingProgram.executionTarget = {
    kind: "panel-script",
    programName: "Illustrator",
    panelName: "Tools",
    fileName: "sibling-program.flowcell-source.json"
  };

  Object.assign(document.buttons, {
    [scopeScript.id]: scopeScript,
    [scopeCore.id]: scopeCore,
    [toolOwner.id]: toolOwner,
    [toolChild.id]: toolChild,
    [siblingPanel.id]: siblingPanel,
    [siblingProgram.id]: siblingProgram
  });

  const toolsPanel = addScopePanelSurface(
    document,
    "panel-blender-tools",
    "Blender / Tools",
    [scopeScript.id, scopeCore.id, toolOwner.id]
  );
  const otherPanel = addScopePanelSurface(
    document,
    "panel-blender-other",
    "Blender / Other",
    [siblingPanel.id]
  );
  const illustratorPanel = addScopePanelSurface(
    document,
    "panel-illustrator-tools",
    "Illustrator / Tools",
    [siblingProgram.id]
  );
  document.surfaces["panel-blender-utility-empty"] = {
    id: "panel-blender-utility-empty",
    name: "Blender / Utility",
    kind: "panel",
    width: 720,
    height: 120,
    placementIds: [],
    visualOverflowAllowance: 0
  };

  document.surfaces["scope-tool-surface"] = {
    id: "scope-tool-surface",
    name: "Scoped Tool Set",
    kind: "tool-set-popout",
    width: 240,
    height: 120,
    placementIds: ["scope-tool-child-placement"],
    visualOverflowAllowance: 0
  };
  document.placements["scope-tool-child-placement"] = {
    id: "scope-tool-child-placement",
    buttonId: toolChild.id,
    surfaceId: "scope-tool-surface",
    x: 8,
    y: 8,
    width: 160,
    height: 44,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink",
    textAlignment: "skin",
    textOffsetX: 0,
    textOffsetY: 0,
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    highlightOnHover: false,
    resizeAnchor: "top-left",
    activationCycle: null,
    visualStateMap: null
  };
  document.popoutUnits["scope-tool-unit"] = {
    id: "scope-tool-unit",
    name: "Scoped Tool Set",
    kind: "tool-set",
    surfaceId: "scope-tool-surface",
    canonicalBounds: { x: 0, y: 0, width: 240, height: 120 },
    desktopBounds: null,
    openRule: "toggle",
    closeRule: "escape",
    transparency: 1,
    pinnedDefault: false,
    ownerButtonId: toolOwner.id,
    childButtonIds: [toolChild.id],
    childPlacementIds: ["scope-tool-child-placement"],
    fields: [{
      id: "scope-service",
      kind: "text",
      label: "Service",
      payloadKey: "service",
      x: 8,
      y: 64,
      width: 160,
      height: 32,
      zIndex: 1,
      defaultValue: "",
      serviceTarget: {
        kind: "tool-set-action",
        programName: "Blender",
        panelName: "Tools",
        ownerFileName: "scope-tool.flowcell-source.json",
        command: "service"
      }
    }]
  };

  const regular = ensureRegularPopout(document, [scopeScript, scopeCore]);
  const fan = ensureFanSetup({
    document,
    programName: "Blender",
    panelName: "Tools",
    buttons: [scopeScript, toolOwner]
  });
  const blenderRail = reconcileProgramPanelOwners(document, {
    programName: "Blender",
    panels: [
      { panelName: "Tools", rect: { x: 20, y: 20, width: 140, height: 40 } },
      { panelName: "Other", rect: { x: 20, y: 72, width: 140, height: 40 } },
      { panelName: "Utility", rect: { x: 20, y: 124, width: 140, height: 40 } }
    ],
    surfaceBounds: { width: 400, height: 180 }
  });
  const illustratorRail = reconcileProgramPanelOwners(document, {
    programName: "Illustrator",
    panels: [{ panelName: "Tools", rect: { x: 20, y: 20, width: 140, height: 40 } }],
    surfaceBounds: { width: 400, height: 180 }
  });
  const toolsPanelOwner = findPanelOwnerButton(document, "Blender", "Tools");
  assert.ok(toolsPanelOwner);
  toolsPanelOwner.label = "Custom Tools Panel";
  toolsPanelOwner.tooltip = "Keep panel presentation";
  toolsPanelOwner.disabled = true;
  toolsPanelOwner.defaultTextFitMode = "stack-whole-words";
  const otherPanelOwner = findPanelOwnerButton(document, "Blender", "Other");
  const utilityPanelOwner = findPanelOwnerButton(document, "Blender", "Utility");
  assert.ok(otherPanelOwner);
  assert.ok(utilityPanelOwner);
  otherPanelOwner.tooltip = "Keep other panel presentation";
  utilityPanelOwner.tooltip = "Keep utility panel presentation";
  const toolsOwnerMainPlacement = resolvePanelOwnerMainPlacement(document, "Blender", "Tools");
  const toolsOwnerFanPlacement = resolvePanelOwnerFanPlacement(document, fan.id);
  assert.ok(toolsOwnerMainPlacement);
  assert.ok(toolsOwnerFanPlacement);
  toolsOwnerMainPlacement.minimumFontSize = 11;
  toolsOwnerMainPlacement.allowLabelResize = true;
  toolsOwnerFanPlacement.minimumFontSize = 10;

  return {
    document,
    ids: {
      scopeSourceOwners: [scopeCore.id, scopeScript.id, toolOwner.id].sort(),
      scopeButtons: [scopeCore.id, scopeScript.id, toolOwner.id, toolChild.id].sort(),
      siblingPanel: siblingPanel.id,
      siblingProgram: siblingProgram.id,
      toolsPanelOwner: toolsPanelOwner.id,
      otherPanelOwner: otherPanelOwner.id,
      utilityPanelOwner: utilityPanelOwner.id,
      illustratorPanelOwner: findPanelOwnerButton(document, "Illustrator", "Tools").id,
      regular: regular.id,
      fan: fan.id,
      toolUnit: "scope-tool-unit",
      toolsPanelSurface: toolsPanel.surfaceId,
      otherPanelSurface: otherPanel.surfaceId,
      utilityPanelSurface: "panel-blender-utility-empty",
      illustratorPanelSurface: illustratorPanel.surfaceId,
      blenderRailSurface: blenderRail.surfaceId,
      illustratorRailSurface: illustratorRail.surfaceId
    }
  };
}

function renamePreservationSnapshot(document) {
  return {
    ids: {
      buttons: Object.keys(document.buttons).sort(),
      placements: Object.keys(document.placements).sort(),
      surfaces: Object.keys(document.surfaces).sort(),
      popouts: Object.keys(document.popoutUnits).sort(),
      fans: Object.keys(document.fanSetups).sort()
    },
    presentation: Object.fromEntries(Object.values(document.buttons)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => [record.id, {
        label: record.label,
        tooltip: record.tooltip,
        defaultSkinId: record.defaultSkinId,
        defaultTextFitMode: record.defaultTextFitMode,
        disabled: record.disabled
      }])),
    placements: structuredClone(document.placements)
  };
}

function assertValidScopeFixture(document) {
  const validation = validateButtonStateDocument(document);
  assert.equal(
    validation.valid,
    true,
    validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")
  );
}

function placementActivationCycle(stateIds) {
  return {
    states: stateIds.map((id, index) => ({
      id,
      label: id,
      advanceTrigger: index % 2 === 0 ? "press" : "release",
      visualState: index === 0 ? "base" : "pressed"
    }))
  };
}

test("Button activation-cycle structure matching handles null and configured transitions", () => {
  const configured = placementActivationCycle(["state-1", "state-2"]);
  assert.equal(buttonActivationCycleStructureMatches(null, null), true);
  assert.equal(buttonActivationCycleStructureMatches(null, configured), false);
  assert.equal(buttonActivationCycleStructureMatches(configured, null), false);
});

test("Button activation-cycle structure matching rejects state ID reorder, add, and removal", () => {
  const cycle = placementActivationCycle(["one", "two", "three"]);
  assert.equal(
    buttonActivationCycleStructureMatches(cycle, placementActivationCycle(["two", "one", "three"])),
    false
  );
  assert.equal(
    buttonActivationCycleStructureMatches(cycle, placementActivationCycle(["one", "two", "three", "four"])),
    false
  );
  assert.equal(
    buttonActivationCycleStructureMatches(cycle, placementActivationCycle(["one", "two"])),
    false
  );
});

test("Button activation-cycle structure matching ignores label, trigger, and visual edits", () => {
  const committed = placementActivationCycle(["state-1", "state-2"]);
  const draft = structuredClone(committed);
  draft.states[0].label = "Ready";
  draft.states[0].advanceTrigger = "hover";
  draft.states[0].visualState = "held";
  draft.states[1].label = "Armed";
  draft.states[1].advanceTrigger = "press";
  draft.states[1].visualState = "hover";
  assert.equal(buttonActivationCycleStructureMatches(committed, draft), true);
});

test("Button window geometry keeps restored and expanded bounds in physical pixels", () => {
  assert.deepEqual(
    buttonDesktopBoundsFromFlowCellBounds({
      Left: 2400,
      Top: 180,
      Width: 735,
      Height: 410
    }),
    { left: 2400, top: 180, width: 735, height: 410 }
  );

  const moved = resolveExpandedPopoutBounds({
    collapsedOrigin: { x: 2680, y: 320 },
    canonicalBounds: { x: -24, y: 12, width: 480, height: 260 },
    scaleFactor: 1.5,
    authoritativeExpandedBounds: {
      left: 100,
      top: 200,
      width: 735,
      height: 410
    }
  });
  assert.deepEqual(moved, {
    left: 2644,
    top: 338,
    width: 735,
    height: 410
  });
  assert.deepEqual(physicalSurfaceSize(480, 260, 1.5), {
    width: 720,
    height: 390
  });

  const persisted = resolvePopoutBoundsAfterDrag({
    liveWindowBounds: { left: 2680, top: 320, width: 160, height: 44 },
    toolSetCollapsed: true,
    canonicalBounds: { x: -24, y: 12, width: 480, height: 260 },
    scaleFactor: 1.5,
    authoritativeExpandedBounds: moved
  });
  assert.deepEqual(persisted.desktopBounds, moved);
  assert.deepEqual(persisted.layoutSnapshotBounds, {
    left: 2680,
    top: 320,
    width: 160,
    height: 44
  });
});

test("fixed Button canvas maps physical desktop frames into local CSS pixels", () => {
  const bounds = { left: -1600, top: 90, width: 500, height: 250 };
  const workArea = { Left: -1920, Top: 0, Width: 1920, Height: 1040 };
  assert.deepEqual(resolveFixedButtonCanvasBounds({
    Left: bounds.left,
    Top: bounds.top,
    Width: bounds.width,
    Height: bounds.height
  }, workArea), workArea);
  assert.deepEqual(resolveFixedButtonCanvasBounds({
    Left: -2000,
    Top: -60,
    Width: 500,
    Height: 250
  }, workArea), {
    Left: -2000,
    Top: -60,
    Width: 2000,
    Height: 1100
  });
  assert.equal(buttonDesktopBoundsInsideCanvas(bounds, workArea), true);
  assert.equal(buttonDesktopBoundsInsideCanvas({
    left: -2000,
    top: -60,
    width: 500,
    height: 250
  }, workArea), false);
  assert.deepEqual(buttonDesktopBoundsToCanvasRect(bounds, {
    left: -1920,
    top: 0,
    scaleFactor: 1.25
  }), {
    left: 256,
    top: 72,
    width: 400,
    height: 200
  });
  assert.deepEqual(translateButtonDesktopBounds(bounds, { x: 275, y: -40 }), {
    left: -1325,
    top: 50,
    width: 500,
    height: 250
  });
});

test("fixed Button canvas broad phase rejects unrelated transparent space", () => {
  const frame = { x: 240, y: 120, width: 320, height: 180 };
  assert.equal(buttonWindowRectContainsPoint(frame, { x: 400, y: 200 }), true);
  assert.equal(buttonWindowRectContainsPoint(frame, { x: 224, y: 104 }, 16), true);
  assert.equal(buttonWindowRectContainsPoint(frame, { x: 223.9, y: 104 }, 16), false);
  assert.equal(buttonWindowRectContainsPoint(frame, { x: 1, y: 1 }, 16), false);
  assert.equal(buttonWindowRectContainsPoint(null, { x: 400, y: 200 }), false);
});

test("Button Editor bounds reject Windows minimized sentinels and discard stale snapshots", () => {
  const normalBounds = { Left: -1920, Top: 80, Width: 1240, Height: 860 };
  const minimizedBounds = { Left: -32000, Top: -32000, Width: 160, Height: 28 };
  assert.equal(isUsableButtonWindowBounds(normalBounds), true);
  assert.equal(isUsableButtonWindowBounds(minimizedBounds), false);

  const values = new Map();
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key)
    }
  };
  try {
    values.set("flowcell.button-layout-windows.v2", JSON.stringify({
      "flowcell-button-editor": {
        windowLabel: "flowcell-button-editor",
        kind: "button-editor",
        snapshotBounds: minimizedBounds
      }
    }));
    assert.equal(
      readRegisteredLayoutWindow("flowcell-button-editor")?.snapshotBounds,
      undefined
    );

    registerLayoutWindow({
      windowLabel: "flowcell-button-editor",
      kind: "button-editor"
    });
    const persisted = JSON.parse(values.get("flowcell.button-layout-windows.v2"));
    assert.equal(persisted["flowcell-button-editor"].snapshotBounds, undefined);
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test("fixed Button cursor and frame mapping honor the WebView pixel ratio", () => {
  assert.equal(resolveButtonWebviewPixelRatio(1, 1.05), 1.05);
  assert.equal(resolveButtonWebviewPixelRatio(1.25, undefined), 1.25);
  assert.equal(resolveButtonWebviewPixelRatio(1.25, 0), 1.25);
  assert.ok(
    Math.abs(resolveTargetButtonWebviewPixelRatio(1, 1.05, 1.5) - 1.575) < 0.0001
  );

  const clientPoint = resolveButtonWindowClientPoint(
    { x: 325, y: 1009 },
    { x: 0, y: 0 },
    1,
    1.05
  );
  assert.ok(Math.abs(clientPoint.x - 309.5238) < 0.0001);
  assert.ok(Math.abs(clientPoint.y - 960.9524) < 0.0001);
  assert.equal(
    buttonWindowRectContainsPoint(
      { x: 262.99, y: 938.97, width: 160, height: 43.99 },
      clientPoint
    ),
    true
  );
  assert.equal(
    buttonWindowRectContainsPoint(
      { x: 262.99, y: 990.98, width: 160, height: 43.99 },
      clientPoint
    ),
    false
  );

  const canvasRect = buttonDesktopBoundsToCanvasRect(
    { left: 255, top: 879, width: 680, height: 268 },
    { left: 0, top: 0, scaleFactor: 1.05 }
  );
  assert.ok(canvasRect);
  assert.ok(Math.abs(canvasRect.left * 1.05 - 255) < 0.0001);
  assert.ok(Math.abs(canvasRect.top * 1.05 - 879) < 0.0001);
  assert.ok(Math.abs(canvasRect.width * 1.05 - 680) < 0.0001);
  assert.ok(Math.abs(canvasRect.height * 1.05 - 268) < 0.0001);
});

test("native Button cursor gating fails closed outside the owning program", () => {
  assert.equal(shouldIgnoreButtonWindowCursor(false, true), true);
  assert.equal(shouldIgnoreButtonWindowCursor(false, false), true);
  assert.equal(shouldIgnoreButtonWindowCursor(false, true, true), true);
  assert.equal(shouldIgnoreButtonWindowCursor(false, false, true), true);
  assert.equal(shouldIgnoreButtonWindowCursor(true, false), true);
  assert.equal(shouldIgnoreButtonWindowCursor(true, true), false);
  assert.equal(shouldIgnoreButtonWindowCursor(true, false, true), false);
  assert.equal(isNativeQueryRevisionCurrent(4, 4), true);
  assert.equal(isNativeQueryRevisionCurrent(4, 5), false);
});

test("native Button cursor-ignore failures retry and converge to the latest state", async () => {
  const retryCalls = [];
  let firstAttempt = true;
  const retryController = createNativeCursorIgnoreController(async (ignored) => {
    retryCalls.push(ignored);
    if (firstAttempt) {
      firstAttempt = false;
      throw new Error("transient native failure");
    }
  }, { retryDelaysMs: [0] });
  retryController.request(true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(retryCalls, [true, true]);
  retryController.shutdown();

  const latestCalls = [];
  let releaseFirst;
  const firstApply = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const latestController = createNativeCursorIgnoreController(async (ignored) => {
    latestCalls.push(ignored);
    if (latestCalls.length === 1) await firstApply;
  }, { retryDelaysMs: [0] });
  latestController.request(false);
  await Promise.resolve();
  latestController.request(true);
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(latestCalls, [false, true]);
  latestController.shutdown();
});

test("native Button cursor controller invalidates external HWND changes and shuts down ignored", async () => {
  const invalidationCalls = [];
  const invalidationController = createNativeCursorIgnoreController(async (ignored) => {
    invalidationCalls.push(ignored);
  }, { retryDelaysMs: [0] });
  invalidationController.request(false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  invalidationController.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(invalidationCalls, [false, false]);
  invalidationController.reset(true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(invalidationCalls, [false, false, true]);
  invalidationController.shutdown();

  const shutdownCalls = [];
  let releaseActiveApply;
  const activeApply = new Promise((resolve) => {
    releaseActiveApply = resolve;
  });
  const shutdownController = createNativeCursorIgnoreController(async (ignored) => {
    shutdownCalls.push(ignored);
    if (shutdownCalls.length === 1) await activeApply;
  }, { retryDelaysMs: [0] });
  shutdownController.request(false);
  await Promise.resolve();
  shutdownController.shutdown();
  releaseActiveApply();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(shutdownCalls, [false, true]);
});

test("equal Button envelopes bypass only when no geometry transition is pending", () => {
  const current = { x: -4, y: -3, width: 180, height: 52 };
  assert.equal(
    shouldBypassButtonWindowGeometryTransition(current, { ...current }, 0),
    true
  );
  assert.equal(
    shouldBypassButtonWindowGeometryTransition(current, { ...current }, 1),
    false
  );
  assert.equal(
    shouldBypassButtonWindowGeometryTransition(current, { ...current, width: 181 }, 0),
    false
  );
});

test("finite Button visual sampling stops after animations and settle frames", () => {
  const activeState = {
    hovered: true,
    pressed: false,
    held: false,
    play: false,
    release: false,
    error: false
  };
  const running = resolveButtonVisualSamplingDecision({
    state: activeState,
    animationInspectionAvailable: true,
    hasRunningAnimations: true,
    settleFramesRemaining: 0
  });
  assert.deepEqual(running, {
    continueSampling: true,
    settleFramesRemaining: BUTTON_VISUAL_SETTLE_FRAMES
  });
  const settling = resolveButtonVisualSamplingDecision({
    state: activeState,
    animationInspectionAvailable: true,
    hasRunningAnimations: false,
    settleFramesRemaining: running.settleFramesRemaining
  });
  assert.deepEqual(settling, {
    continueSampling: true,
    settleFramesRemaining: BUTTON_VISUAL_SETTLE_FRAMES - 1
  });
  const finalSettle = resolveButtonVisualSamplingDecision({
    state: activeState,
    animationInspectionAvailable: true,
    hasRunningAnimations: false,
    settleFramesRemaining: settling.settleFramesRemaining
  });
  assert.equal(finalSettle.continueSampling, true);
  const stopped = resolveButtonVisualSamplingDecision({
    state: activeState,
    animationInspectionAvailable: true,
    hasRunningAnimations: false,
    settleFramesRemaining: finalSettle.settleFramesRemaining
  });
  assert.deepEqual(stopped, { continueSampling: false, settleFramesRemaining: 0 });

  const fallback = resolveButtonVisualSamplingDecision({
    state: activeState,
    animationInspectionAvailable: false,
    hasRunningAnimations: false,
    settleFramesRemaining: 0
  });
  assert.equal(fallback.continueSampling, true);
  const idle = resolveButtonVisualSamplingDecision({
    state: { ...activeState, hovered: false },
    animationInspectionAvailable: true,
    hasRunningAnimations: true,
    settleFramesRemaining: BUTTON_VISUAL_SETTLE_FRAMES
  });
  assert.deepEqual(idle, { continueSampling: false, settleFramesRemaining: 0 });
});

test("Button visual latch holds Live through press and release until its finite hover transition finishes", () => {
  const intent = (key, visualState, activationStateIndex) => ({
    key,
    value: { label: "Live", visualState, activationStateIndex }
  });
  const offBase = intent("live:off:base", "base", 0);
  const offHover = intent("live:off:hover", "hover", 0);
  const pressed = intent("live:off:pressed", "pressed", 0);
  const released = intent("live:off:release", "release", 0);
  const onHover = intent("live:on:hover", "hover", 1);

  let state = createButtonVisualLatch(offBase);
  const initialPresentationId = state.presentation.id;
  state = requestButtonVisual(state, offHover);
  assert.equal(state.presentation.intent.key, offBase.key);
  state = settleButtonVisualMotionProbe(state, initialPresentationId, "none");
  const hoverPresentationId = state.presentation.id;
  state = commitPreparedButtonVisual(state, hoverPresentationId);

  // An input arriving before the browser exposes the transition must not replace
  // the presentation that is still being probed.
  state = requestButtonVisual(state, pressed);
  assert.equal(state.presentation.id, hoverPresentationId);
  assert.equal(state.presentation.intent.key, offHover.key);
  state = settleButtonVisualMotionProbe(state, hoverPresentationId, "finite");

  state = requestButtonVisual(state, released);
  state = requestButtonVisual(state, onHover);
  assert.equal(state.presentation.id, hoverPresentationId);
  assert.equal(state.presentation.intent.key, offHover.key);
  assert.equal(state.desired.key, onHover.key);

  state = finishButtonVisualMotion(state, hoverPresentationId);
  assert.notEqual(state.presentation.id, hoverPresentationId);
  assert.equal(state.presentation.intent.key, onHover.key);
  assert.equal(state.motion?.phase, "preparing");
  state = commitPreparedButtonVisual(state, state.presentation.id);
  state = settleButtonVisualMotionProbe(state, state.presentation.id, "none");
  assert.equal(state.motion, null);
});

test("Button visual preparation drops stale unpainted candidates before native prep resolves", () => {
  const intent = (key) => ({ key, value: key });
  let state = createButtonVisualLatch(intent("base"));
  state = settleButtonVisualMotionProbe(state, state.presentation.id, "none");

  state = requestButtonVisual(state, intent("hover"));
  const staleHoverId = state.presentation.id;
  assert.equal(state.motion?.phase, "preparing");

  state = requestButtonVisual(state, intent("pressed"));
  const stalePressedId = state.presentation.id;
  assert.notEqual(stalePressedId, staleHoverId);
  assert.equal(commitPreparedButtonVisual(state, staleHoverId), state);

  state = requestButtonVisual(state, intent("release"));
  const releaseId = state.presentation.id;
  assert.notEqual(releaseId, stalePressedId);
  assert.equal(commitPreparedButtonVisual(state, stalePressedId), state);

  state = commitPreparedButtonVisual(state, releaseId);
  assert.equal(state.presentation.intent.key, "release");
  assert.equal(state.motion?.phase, "probing");
});

test("authored Pressed motion commits before a Smart Axis result can replace it", () => {
  const intent = (key, options = {}) => ({
    key,
    value: key,
    ...options
  });
  const base = intent("smart-axis:x");
  const pressed = intent("smart-axis:x:pressed", { commitBeforeSupersede: true });
  const released = intent("smart-axis:x:release");
  const armed = intent("smart-axis:x-minus");

  let state = createButtonVisualLatch(base);
  state = settleButtonVisualMotionProbe(state, state.presentation.id, "none");
  state = requestButtonVisual(state, pressed);
  const pressedPresentationId = state.presentation.id;
  assert.equal(state.motion?.phase, "preparing");

  // Pointer-up and the successful Blender response can both arrive while the
  // native Pop/Fan envelope is still preparing the Pressed presentation.
  state = requestButtonVisual(state, released);
  state = requestButtonVisual(state, armed);
  assert.equal(state.presentation.id, pressedPresentationId);
  assert.equal(state.presentation.intent.key, pressed.key);
  assert.equal(state.desired.key, armed.key);

  state = commitPreparedButtonVisual(state, pressedPresentationId);
  state = settleButtonVisualMotionProbe(state, pressedPresentationId, "finite");
  assert.equal(state.presentation.intent.key, pressed.key);
  assert.equal(state.desired.key, armed.key);

  state = finishButtonVisualMotion(state, pressedPresentationId);
  assert.notEqual(state.presentation.id, pressedPresentationId);
  assert.equal(state.presentation.intent.key, armed.key);
  assert.equal(state.motion?.phase, "preparing");
});

test("Button visual latch never blocks on infinite-only motion and ignores stale completion", () => {
  const base = { key: "base", value: "base" };
  const hover = { key: "hover", value: "hover" };
  let state = createButtonVisualLatch(base);
  state = settleButtonVisualMotionProbe(state, state.presentation.id, "none");
  state = requestButtonVisual(state, hover);
  const hoverPresentationId = state.presentation.id;
  state = commitPreparedButtonVisual(state, hoverPresentationId);
  state = settleButtonVisualMotionProbe(state, hoverPresentationId, "infinite");
  assert.equal(state.motion, null);

  state = requestButtonVisual(state, base);
  const basePresentationId = state.presentation.id;
  assert.notEqual(basePresentationId, hoverPresentationId);
  assert.equal(state.presentation.intent.key, base.key);
  const afterStaleFinish = finishButtonVisualMotion(state, hoverPresentationId);
  assert.equal(afterStaleFinish.presentation.id, basePresentationId);

  assert.equal(buttonVisualMotionBlocksStateChange({
    pending: false,
    playState: "running",
    endTime: 1000
  }), true);
  assert.equal(buttonVisualMotionBlocksStateChange({
    pending: false,
    playState: "running",
    endTime: Number.POSITIVE_INFINITY
  }), false);
  assert.equal(buttonVisualMotionBlocksStateChange({
    pending: false,
    playState: "finished",
    endTime: 1000
  }), false);
});

test("backend execution starts while a finite Button visual presentation remains latched", async () => {
  let releaseResponse;
  const response = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  let calls = 0;
  const unregister = registerButtonCoreAction("test-visual-latch-backend", async () => {
    calls += 1;
    return response;
  });
  try {
    const base = { key: "live:base", value: "base" };
    const hover = { key: "live:hover", value: "hover" };
    let state = createButtonVisualLatch(base);
    state = settleButtonVisualMotionProbe(state, state.presentation.id, "none");
    state = requestButtonVisual(state, hover);
    const presentationId = state.presentation.id;
    state = commitPreparedButtonVisual(state, presentationId);
    state = settleButtonVisualMotionProbe(state, presentationId, "finite");

    const execution = executeButtonRecord({
      id: "live-button",
      role: "single-script",
      sourceIdentity: null,
      label: "Live",
      tooltip: "",
      executionTarget: { kind: "core-action", actionId: "test-visual-latch-backend" },
      defaultSkinId: "skin-default-neutral",
      defaultTextFitMode: "shrink",
      disabled: false,
      activationAnimation: null,
      activationBehavior: null,
      toolSetParentId: null,
      toolSetBehavior: null,
      metadata: {}
    }, "click");

    assert.equal(calls, 1);
    assert.equal(state.presentation.id, presentationId);
    assert.equal(state.motion?.phase, "finite");
    releaseResponse({ live: true });
    const result = await execution;
    assert.equal(result.executed, true);
    assert.deepEqual(result.response, { live: true });
  } finally {
    unregister();
  }
});

test("fixed Button frame rescaling preserves the opposite resize corner", () => {
  const bounds = { left: 100, top: 200, width: 400, height: 200 };
  const envelope = { x: -8, y: -6, width: 200, height: 100 };
  const common = { bounds, envelope, contentScale: 2, scaleFactor: 1.25 };
  assert.deepEqual(resolveButtonFrameForScaleFactor({ ...common, anchorCorner: "SouthEast" }), {
    left: 100, top: 200, width: 500, height: 250
  });
  assert.deepEqual(resolveButtonFrameForScaleFactor({ ...common, anchorCorner: "NorthEast" }), {
    left: 100, top: 150, width: 500, height: 250
  });
  assert.deepEqual(resolveButtonFrameForScaleFactor({ ...common, anchorCorner: "SouthWest" }), {
    left: 0, top: 200, width: 500, height: 250
  });
  assert.deepEqual(resolveButtonFrameForScaleFactor({ ...common, anchorCorner: "NorthWest" }), {
    left: 0, top: 150, width: 500, height: 250
  });
});

test("Button Pop window geometry uniformly fits surfaces and keeps the opposite corner anchored", () => {
  assert.equal(resolveUniformSurfaceScale({
    viewportWidth: 300,
    viewportHeight: 200,
    surfaceWidth: 600,
    surfaceHeight: 200
  }), 0.5);
  assert.equal(resolveUniformSurfaceScale({
    viewportWidth: 900,
    viewportHeight: 600,
    surfaceWidth: 300,
    surfaceHeight: 200
  }), 3);

  const initialBounds = { left: 100, top: 200, width: 400, height: 200 };
  const initialPointer = { x: 500, y: 400 };
  const southEast = resolveAspectLockedWindowBounds({
    initialBounds,
    initialPointer,
    pointer: { x: 620, y: 430 },
    corner: "SouthEast"
  });
  assert.deepEqual(southEast, {
    left: 100,
    top: 200,
    width: 520,
    height: 260
  });

  const northWest = resolveAspectLockedWindowBounds({
    initialBounds,
    initialPointer: { x: 100, y: 200 },
    pointer: { x: 20, y: 160 },
    corner: "NorthWest"
  });
  assert.deepEqual(northWest, {
    left: 20,
    top: 160,
    width: 480,
    height: 240
  });
  assert.equal(northWest.left + northWest.width, initialBounds.left + initialBounds.width);
  assert.equal(northWest.top + northWest.height, initialBounds.top + initialBounds.height);

  const northEast = resolveAspectLockedWindowBounds({
    initialBounds,
    initialPointer: { x: 500, y: 200 },
    pointer: { x: 600, y: 150 },
    corner: "NorthEast"
  });
  assert.deepEqual(northEast, {
    left: 100,
    top: 150,
    width: 500,
    height: 250
  });
  assert.equal(northEast.top + northEast.height, initialBounds.top + initialBounds.height);

  const southWest = resolveAspectLockedWindowBounds({
    initialBounds,
    initialPointer: { x: 100, y: 400 },
    pointer: { x: 0, y: 450 },
    corner: "SouthWest"
  });
  assert.deepEqual(southWest, {
    left: 0,
    top: 200,
    width: 500,
    height: 250
  });
  assert.equal(southWest.left + southWest.width, initialBounds.left + initialBounds.width);
});

test("Button Fan collapsed geometry keeps its physical anchor and refreshes measured size", () => {
  const anchor = { left: 2480, top: 360, width: 320, height: 180 };
  assert.deepEqual(resolveMeasuredCollapsedButtonBounds({
    anchor,
    measuredWidth: 132,
    measuredHeight: 37,
    scaleFactor: 1.5
  }), {
    left: 2480,
    top: 360,
    width: 198,
    height: 56
  });
  assert.deepEqual(resolveMeasuredCollapsedButtonBounds({
    anchor,
    measuredWidth: Number.NaN,
    measuredHeight: 0,
    scaleFactor: 2
  }), anchor);
});

test("Button state round-trips and validates schema version", () => {
  const document = createButtonStateDocument();
  const parsed = parseButtonStateDocumentJson(JSON.stringify(document));
  assert.equal(parsed.valid, true, parsed.issues.map((issue) => issue.message).join("\n"));
  assert.deepEqual(parsed.document, document);

  const wrongVersion = { ...document, schemaVersion: 99 };
  const invalid = validateButtonStateDocument(wrongVersion);
  assert.equal(invalid.structurallyValid, false);
  assert.match(invalid.issues[0].message, /Unsupported Button schema version/);
});

test("source identities normalize independently from editable Button fields", () => {
  const identity = source("  BLENDER ", "To\u0301ols", "Folder//MY Script.PY  ");
  assert.equal(identity.normalizedProgramName, "blender");
  assert.equal(identity.normalizedPanelName, "tóols");
  assert.equal(identity.normalizedFileName, "folder\\my script.py");
  const first = source("Blender", "Tools", "b.py");
  const second = source("Blender", "Tools", "a.py");
  assert.equal(
    deriveRegularPopoutSelectionKey([first, second]),
    deriveRegularPopoutSelectionKey([second, first])
  );
});

test("full and partial skin paste operations preserve omitted source literally", () => {
  const full = parseButtonSkinPaste(`=== structure ===\n<div data-core>{{label}}</div>\n=== base ===\n--ink: #fff;\n=== hover ===\n--ink: #0ff;`);
  assert.equal(full.ok, true);
  const initial = createEmptyButtonSkinSections();
  const created = applyNamedButtonSkinSections(initial, full);
  assert.equal(created.structure, "<div data-core>{{label}}</div>");
  assert.equal(created.base, "--ink: #fff;");

  const partial = parseButtonSkinPaste("=== hover ===\n--ink: #f00;");
  assert.equal(partial.ok, true);
  const updated = applyNamedButtonSkinSections(created, partial);
  assert.equal(updated.hover, "--ink: #f00;");
  assert.equal(updated.base, created.base);
  assert.equal(updated.structure, created.structure);

  const clear = parseButtonSkinPaste("=== hover ===\n");
  assert.equal(clear.ok, true);
  assert.equal(applyNamedButtonSkinSections(updated, clear).hover, "");
  assert.equal(initial.structure, "");
});

test("saved Button skin names come exactly from the chosen filename", () => {
  assert.equal(
    buttonSkinNameFromPath("C:\\Users\\Aaron\\Skins\\Smart Access Live.flowcell-button-skin.txt"),
    "Smart Access Live"
  );
  assert.equal(
    buttonSkinNameFromPath("D:/skins/KNIGHT.FLOWCELL-BUTTON-SKIN.TXT"),
    "KNIGHT"
  );
  assert.equal(buttonSkinNameFromPath("D:/skins/My.skin.v2"), "My.skin.v2");
});

test("recent Button skin files deduplicate Windows paths, move to the front, and stay capped", () => {
  const candidates = Array.from(
    { length: BUTTON_SKIN_RECENT_FILE_LIMIT + 2 },
    (_, index) => ({
      path: `C:\\Skins\\Skin ${index}.flowcell-button-skin.txt`,
      skinId: `skin-${index}`
    })
  );
  candidates.splice(1, 0, {
    path: "c:/skins/SKIN 0.flowcell-button-skin.txt",
    skinId: "skin-duplicate"
  });
  const normalized = normalizeButtonSkinRecentFiles(candidates);
  assert.equal(normalized.length, BUTTON_SKIN_RECENT_FILE_LIMIT);
  assert.equal(normalized[0].skinId, "skin-0");
  assert.equal(normalized.some((entry) => entry.skinId === "skin-duplicate"), false);

  const remembered = rememberButtonSkinRecentFile(
    normalized,
    "c:/skins/SKIN 3.flowcell-button-skin.txt",
    "skin-3-new"
  );
  assert.equal(remembered[0].skinId, "skin-3-new");
  assert.equal(
    remembered.filter((entry) => /skin 3\.flowcell-button-skin\.txt$/i.test(entry.path)).length,
    1
  );
  const reassigned = rememberButtonSkinRecentFile(
    remembered,
    "D:\\Other\\Moved.flowcell-button-skin.txt",
    "skin-3-new"
  );
  assert.equal(reassigned[0].path, "D:\\Other\\Moved.flowcell-button-skin.txt");
  assert.equal(reassigned.filter((entry) => entry.skinId === "skin-3-new").length, 1);
});

test("recent Button skin files persist as machine-local WebView history", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value)
      }
    }
  });
  try {
    const expected = [{
      path: "D:\\FlowCell\\Button editor\\Skins\\Neon.flowcell-button-skin.txt",
      skinId: "skin-neon"
    }];
    writeButtonSkinRecentFiles(expected);
    assert.deepEqual(readButtonSkinRecentFiles(), expected);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete globalThis.window;
    }
  }
});

test("portable Button skin files become complete isolated working skins", () => {
  const source = serializeButtonSkinSections({
    ...createEmptyButtonSkinSections(),
    structure: "<div data-core>{{label}}</div>",
    base: "--ink:#fff;",
    hover: "--ink:#0ff;"
  });
  const loaded = createButtonSkinFromFile(
    source,
    "D:\\Skins\\Neon.flowcell-button-skin.txt",
    "skin-neon",
    {
      id: "skin-existing",
      name: "Existing",
      ...createEmptyButtonSkinSections(),
      structure: "<div data-core>{{label}}</div>",
      metadata: { author: "FlowCell" },
      compileCache: {
        compilerVersion: 1,
        sourceFingerprint: "stale"
      }
    }
  );
  assert.equal(loaded.id, "skin-neon");
  assert.equal(loaded.name, "Neon");
  assert.equal(loaded.structure, "<div data-core>{{label}}</div>");
  assert.equal(loaded.base, "--ink:#fff;");
  assert.equal(loaded.hover, "--ink:#0ff;");
  assert.deepEqual(loaded.metadata, { author: "FlowCell" });
  assert.equal(loaded.compileCache, null);
  assert.throws(
    () => createButtonSkinFromFile(
      "=== structure ===\n<div data-core></div>",
      "D:\\Skins\\Partial.flowcell-button-skin.txt",
      "skin-partial"
    ),
    /missing canonical sections/
  );
});

test("skin paste rejects duplicate, unknown, malformed, and prefixed headers atomically", () => {
  for (const candidate of [
    "=== hover ===\na: b;\n=== hover ===\nc: d;",
    "=== unknown ===\na: b;",
    "== hover ==\na: b;",
    "prefix\n=== hover ===\na: b;"
  ]) {
    assert.equal(parseButtonSkinPaste(candidate).ok, false, candidate);
  }
});

test("skin paste tolerates leading blank lines, indentation, and header case", () => {
  const parsed = parseButtonSkinPaste(
    "\r\n\n  === Structure ===  \r\n<div data-core>{{label}}</div>\n\t=== HOVER ===\n--ink: #0ff;"
  );
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.presentSections, ["structure", "hover"]);
  assert.equal(parsed.sections.structure, "<div data-core>{{label}}</div>");
  assert.equal(parsed.sections.hover, "--ink: #0ff;");
  // Case-variant duplicates still collapse onto one section and get rejected.
  assert.equal(parseButtonSkinPaste("=== hover ===\na: b;\n=== Hover ===\nc: d;").ok, false);
});

test("semantic skin validation enforces data-core, label ownership, and safe animation", () => {
  const valid = {
    ...createEmptyButtonSkinSections(),
    structure: `<div style="color:var(--ink,#fff)"><div data-core>{{label}}<span data-anim="pulse"></span></div></div>`,
    keyframes: "@keyframes pulse{from{opacity:.5}to{opacity:1}}",
    play: "--anim-pulse: pulse 120ms ease 1;"
  };
  const validation = validateButtonSkin(valid);
  assert.equal(validation.valid, true);
  assert.equal(validation.analysis.hasLabelToken, true);
  assert.equal(validateButtonSkin({ ...valid, structure: "<script></script><div data-core>{{label}}</div>" }).valid, false);
  const interactiveRoot = validateButtonSkin({
    ...valid,
    structure: "<button data-core>{{label}}</button>"
  });
  assert.equal(interactiveRoot.valid, false);
  assert.match(
    interactiveRoot.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    /<button> is not allowed in a Button skin\./
  );
  assert.equal(validateButtonSkin({ ...valid, structure: "<div>{{label}}</div>" }).valid, false);
  assert.equal(validateButtonSkin({ ...valid, structure: "<div data-core>{{label}}{{label}}</div>" }).valid, false);
  assert.equal(validateButtonSkin({ ...valid, structure: "<div data-core></div>{{label}}" }).valid, false);
  assert.equal(validateButtonSkin({ ...valid, play: "--anim-pulse: pulse 1s infinite;" }).valid, false);
});

test("textless animation skins compile without synthesizing a visible label", () => {
  const skin = {
    id: "skin-animation-only",
    name: "Animation Only",
    ...createEmptyButtonSkinSections(),
    structure: "<span data-core style=\"display:inline-grid;width:72px;height:72px\"><i data-anim=\"pulse\"></i></span>",
    keyframes: "@keyframes pulse{from{opacity:.2}to{opacity:1}}",
    play: "--anim-pulse: pulse 120ms ease 1;",
    metadata: {},
    compileCache: null
  };
  const validation = validateButtonSkin(skin);
  assert.equal(validation.valid, true);
  assert.equal(validation.analysis.hasLabelToken, false);
  const result = compileButtonSkin(skin);
  assert.equal(result.ok, true);
  assert.equal(result.compiled.hasLabelToken, false);
  assert.equal(result.compiled.sanitizedMarkupTemplate.includes("{{label}}"), false);
  assert.equal(result.compiled.sanitizedMarkupTemplate.includes("data-button-label-node"), false);
});

test("compiled skins keep authored wrappers inert and expose the core to pointer input", () => {
  const skin = {
    id: "skin-core-hitbox",
    name: "Core Hitbox",
    ...createEmptyButtonSkinSections(),
    structure: "<span><span data-core style=\"display:inline-block;width:10px;height:10px\"></span></span>",
    metadata: {},
    compileCache: null
  };
  const result = compileButtonSkin(skin);
  assert.equal(result.ok, true);
  assert.match(result.compiled.scopedCss, /:host\{[^}]*pointer-events:auto;/);
  assert.match(result.compiled.scopedCss, /\[data-button-skin-root\]\{[^}]*pointer-events:none;/);
  assert.match(result.compiled.scopedCss, /\[data-core\]\{pointer-events:auto!important;/);
  assert.match(result.compiled.scopedCss, /svg\[data-core\]\{pointer-events:bounding-box!important;/);
  assert.match(
    result.compiled.scopedCss,
    /:host\(\[data-button-constrained="true"\]\) \[data-core\]\{[^}]*width:var\(--button-core-width\)!important;[^}]*height:var\(--button-core-height\)!important;[^}]*min-width:0!important;[^}]*max-width:none!important;/
  );
  assert.doesNotMatch(result.compiled.scopedCss, /\[data-core\]\{pointer-events:none!important;/);
});

test("Responsive sizing aligns an offset core to the placement origin without scaling it", () => {
  const renderer = readFileSync(
    join(frontendRoot, "src", "button", "skins", "ButtonSkinRenderer.tsx"),
    "utf8"
  );
  const responsiveBranch = renderer.match(
    /if \(!matchHitboxToSkin\) \{[\s\S]{0,220}?return;\s*\}/
  );
  assert.ok(responsiveBranch, "Responsive root-normalization branch must exist");
  assert.match(responsiveBranch[0], /translate\(\$\{-coreOffsetX\}px, \$\{-coreOffsetY\}px\)/);
  assert.doesNotMatch(responsiveBranch[0], /scale\(/);
});

test("placement text alignment overrides HTML layout without remounting or erasing skin styles", () => {
  const renderer = readFileSync(
    join(frontendRoot, "src", "button", "skins", "ButtonSkinRenderer.tsx"),
    "utf8"
  );
  const buttonHost = readFileSync(
    join(frontendRoot, "src", "button", "ButtonHost.tsx"),
    "utf8"
  );

  assert.match(buttonHost, /textAlignment=\{placement\.textAlignment\}/);
  assert.match(buttonHost, /textOffsetX=\{placement\.textOffsetX\}/);
  assert.match(buttonHost, /textOffsetY=\{placement\.textOffsetY\}/);
  assert.match(renderer, /textAlignmentRestores:\s*Array<\(\) => void>/);
  assert.match(renderer, /textAlignmentRestores\.splice\(0\)\.reverse\(\)/);
  assert.match(renderer, /if \(alignment === "skin"\) return;/);
  assert.match(renderer, /element\.style\.setProperty\(property, value, "important"\)/);
  assert.match(renderer, /overrideStyle\(element, "text-align", alignment\)/);
  assert.match(renderer, /overrideStyle\(element, "justify-content", alignment\)/);
  assert.match(renderer, /overrideStyle\(element, "align-items", value\)/);
  assert.match(renderer, /overrideStyle\(element, "justify-items", alignment\)/);
  assert.match(renderer, /labelIsOnlyInFlowChild/);
  assert.match(renderer, /}, \[textAlignment, hasMeasurementConsumer\]\);/);
  assert.match(
    renderer,
    /}, \[compiled\?\.skinId, compiled\?\.sourceFingerprint, hasMeasurementConsumer\]\);/
  );
  assert.match(renderer, /function applyTextOffset\([\s\S]*?applyButtonLabelTextOffset\(labelNode, offsetX, offsetY\);/);
  assert.match(renderer, /reapplyCurrentTextOffset\(\);[\s\S]*?requestAnimationFrame\(sample\)/);
  assert.match(renderer, /}, \[textOffsetX, textOffsetY, hasMeasurementConsumer\]\);/);
  assert.doesNotMatch(
    renderer,
    /}, \[compiled\?\.skinId, compiled\?\.sourceFingerprint, hasMeasurementConsumer,?\s*textOffset/
  );
  assert.match(renderer, /fitted\.label === renderedLabel/);
  assert.match(
    renderer,
    /}, \[width, height, renderedLabel, textFitMode, minimumFontSize, constrained, matchHitboxToSkin, allowStretching, textSizeOverride, previewStackWords\]\);/
  );
});

function fakeStyle(initial = {}) {
  const declarations = new Map(
    Object.entries(initial).map(([property, declaration]) => [
      property,
      typeof declaration === "string"
        ? { value: declaration, priority: "" }
        : { value: declaration.value, priority: declaration.priority ?? "" }
    ])
  );
  return {
    getPropertyValue(property) {
      return declarations.get(property)?.value ?? "";
    },
    getPropertyPriority(property) {
      return declarations.get(property)?.priority ?? "";
    },
    setProperty(property, value, priority = "") {
      declarations.set(property, { value, priority });
    },
    removeProperty(property) {
      const previous = declarations.get(property)?.value ?? "";
      declarations.delete(property);
      return previous;
    }
  };
}

function fakeLabelElement({
  namespaceURI,
  display,
  position = "static",
  translate = "none",
  parentDisplay,
  initialStyle,
  children = [],
  screenMatrix
}) {
  const ownerDocument = {
    defaultView: {
      getComputedStyle(element) {
        return {
          display: element.__display,
          position: element.__position,
          translate: element.__translate
        };
      }
    }
  };
  const parentElement = parentDisplay === undefined
    ? null
    : { __display: parentDisplay, ownerDocument };
  return {
    namespaceURI,
    __display: display,
    __position: position,
    __translate: translate,
    ownerDocument,
    parentElement,
    children,
    style: fakeStyle(initialStyle),
    getScreenCTM: screenMatrix ? () => screenMatrix : undefined
  };
}

function fakeSvgLine(initialAttributes = {}) {
  const attributes = new Map(Object.entries(initialAttributes));
  return {
    namespaceURI: "http://www.w3.org/2000/svg",
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    }
  };
}

test("text offsets move nested plain-inline HTML labels and restore their prior styles", () => {
  const label = fakeLabelElement({
    namespaceURI: "http://www.w3.org/1999/xhtml",
    display: "inline",
    parentDisplay: "inline",
    initialStyle: {
      position: { value: "static", priority: "" },
      left: { value: "auto", priority: "" },
      top: { value: "auto", priority: "" }
    }
  });

  applyButtonLabelTextOffset(label, -14, 12);
  assert.equal(label.style.getPropertyValue("position"), "relative");
  assert.equal(label.style.getPropertyValue("left"), "-14px");
  assert.equal(label.style.getPropertyValue("top"), "12px");
  assert.equal(label.style.getPropertyPriority("left"), "important");
  assert.equal(label.style.getPropertyValue("translate"), "");

  applyButtonLabelTextOffset(label, 0, 0);
  assert.equal(label.style.getPropertyValue("position"), "static");
  assert.equal(label.style.getPropertyValue("left"), "auto");
  assert.equal(label.style.getPropertyValue("top"), "auto");
});

test("text offsets use one HTML path and host-owned SVG line positions", () => {
  for (const parentDisplay of ["inline", "block", "flex", "grid"]) {
    const htmlLabel = fakeLabelElement({
      namespaceURI: "http://www.w3.org/1999/xhtml",
      display: "inline",
      parentDisplay,
      initialStyle: { transform: "rotate(5deg)" }
    });
    applyButtonLabelTextOffset(htmlLabel, 7, -3);
    assert.equal(htmlLabel.style.getPropertyValue("position"), "relative", parentDisplay);
    assert.equal(htmlLabel.style.getPropertyValue("left"), "7px", parentDisplay);
    assert.equal(htmlLabel.style.getPropertyValue("top"), "-3px", parentDisplay);
    assert.equal(htmlLabel.style.getPropertyValue("translate"), "", parentDisplay);
    assert.equal(htmlLabel.style.getPropertyValue("transform"), "rotate(5deg)", parentDisplay);

    applyButtonLabelTextOffset(htmlLabel, 0, 0);
    assert.equal(htmlLabel.style.getPropertyValue("position"), "", parentDisplay);
    assert.equal(htmlLabel.style.getPropertyValue("left"), "", parentDisplay);
    assert.equal(htmlLabel.style.getPropertyValue("top"), "", parentDisplay);
    assert.equal(htmlLabel.style.getPropertyValue("transform"), "rotate(5deg)", parentDisplay);
  }

  const positionedLabel = fakeLabelElement({
    namespaceURI: "http://www.w3.org/1999/xhtml",
    display: "block",
    position: "absolute",
    translate: "5px 6px",
    parentDisplay: "block",
    initialStyle: { position: "absolute", transform: "rotate(5deg)" }
  });
  applyButtonLabelTextOffset(positionedLabel, 7, -3);
  assert.equal(positionedLabel.style.getPropertyValue("position"), "absolute");
  assert.equal(positionedLabel.style.getPropertyValue("translate"), "calc(5px + 7px) calc(6px + -3px)");
  assert.equal(positionedLabel.style.getPropertyValue("transform"), "rotate(5deg)");
  applyButtonLabelTextOffset(positionedLabel, 0, 0);
  assert.equal(positionedLabel.style.getPropertyValue("position"), "absolute");
  assert.equal(positionedLabel.style.getPropertyValue("translate"), "");

  const firstLine = fakeSvgLine({
    "data-button-label-line": "true",
    dy: "0"
  });
  const secondLine = fakeSvgLine({
    "data-button-label-line": "true",
    dy: "1.1em"
  });
  const svgLabel = fakeLabelElement({
    namespaceURI: "http://www.w3.org/2000/svg",
    display: "inline",
    parentDisplay: "inline",
    initialStyle: { transform: "scale(2)" },
    children: [firstLine, secondLine]
  });
  applyButtonLabelTextOffset(svgLabel, 4, 9);
  assert.equal(firstLine.getAttribute("dx"), "4");
  assert.equal(firstLine.getAttribute("dy"), "9");
  assert.equal(secondLine.getAttribute("dx"), "4");
  assert.equal(secondLine.getAttribute("dy"), "1.1em");
  assert.equal(svgLabel.style.getPropertyValue("transform"), "scale(2)");

  applyButtonLabelTextOffset(svgLabel, 0, 0);
  assert.equal(firstLine.getAttribute("dx"), null);
  assert.equal(firstLine.getAttribute("dy"), "0");
  assert.equal(secondLine.getAttribute("dx"), null);
  assert.equal(secondLine.getAttribute("dy"), "1.1em");
  assert.equal(svgLabel.style.getPropertyValue("transform"), "scale(2)");

  const scaledSvgLine = fakeSvgLine({
    "data-button-label-line": "true",
    dy: "0"
  });
  const scaledSvgLabel = fakeLabelElement({
    namespaceURI: "http://www.w3.org/2000/svg",
    display: "inline",
    parentDisplay: "inline",
    children: [scaledSvgLine],
    screenMatrix: { a: 2, b: 0, c: 0, d: 4 }
  });
  applyButtonLabelTextOffset(scaledSvgLabel, 8, 12);
  assert.equal(scaledSvgLine.getAttribute("dx"), "4");
  assert.equal(scaledSvgLine.getAttribute("dy"), "3");
});

test("selection uses the authored pressed state while Main and native input stay core-shaped", () => {
  const buttonHost = readFileSync(
    join(frontendRoot, "src", "button", "ButtonHost.tsx"),
    "utf8"
  );
  const skinRenderer = readFileSync(
    join(frontendRoot, "src", "button", "skins", "ButtonSkinRenderer.tsx"),
    "utf8"
  );
  const nativeHitboxes = readFileSync(
    join(frontendRoot, "src", "button", "windows", "useNativeButtonHitboxes.ts"),
    "utf8"
  );
  const mainCss = readFileSync(
    join(frontendRoot, "src", "pages", "main", "mainPage.css"),
    "utf8"
  );

  assert.match(buttonHost, /const visualPressed = pressed \|\| selected;/);
  assert.match(buttonHost, /const visualRelease = selected \? false : release;/);
  assert.match(buttonHost, /pointerPressed=\{pressed\}/);
  assert.match(buttonHost, /const interactionElement = coreElement;/);
  assert.doesNotMatch(buttonHost, /button-system-host--selected|coreElement\.focus/);
  assert.match(skinRenderer, /pointerEvents: "auto"/);
  assert.match(nativeHitboxes, /shadowRoot\?\.querySelector<HTMLElement \| SVGElement>\("\[data-core\]"\)/);
  assert.match(nativeHitboxes, /const rect = hitbox\.element\.getBoundingClientRect\(\);/);
  assert.match(nativeHitboxes, /hitbox\.element\.dispatchEvent\(new PointerEvent\("pointerenter"/);
  assert.doesNotMatch(nativeHitboxes, /element\.hasAttribute\("data-button-skin-host"\)/);
  assert.doesNotMatch(mainCss, /button-system-host--selected|fc-selected-highlight/);
});

test("placement hover highlight follows the visual latch while native hover stays immediate", () => {
  const buttonHost = readFileSync(
    join(frontendRoot, "src", "button", "ButtonHost.tsx"),
    "utf8"
  );
  const skinRenderer = readFileSync(
    join(frontendRoot, "src", "button", "skins", "ButtonSkinRenderer.tsx"),
    "utf8"
  );
  const nativeHitboxes = readFileSync(
    join(frontendRoot, "src", "button", "windows", "useNativeButtonHitboxes.ts"),
    "utf8"
  );

  assert.match(buttonHost, /highlightOnHover=\{placement\.highlightOnHover\}/);
  assert.match(buttonHost, /rawHovered=\{hovered\}/);
  assert.doesNotMatch(buttonHost, /rawHovered=\{resolvedAppearance\.flags\.hovered\}/);
  assert.match(skinRenderer, /hoverHighlighted: highlightOnHover && rawHovered/);
  assert.match(skinRenderer, /filter: renderedVisual\.hoverHighlighted \? "brightness\(1\.15\)" : undefined/);
  assert.match(skinRenderer, /setBooleanAttribute\(host, "data-button-pointer-hover", rawHovered\)/);
  assert.match(skinRenderer, /return <span ref=\{hostRef\} data-button-skin-host="true" style=\{style\} \/>/);
  const pointerDownBlock = buttonHost.match(
    /const handlePointerDown = \(event: Event\) => \{[\s\S]*?\n    \};/
  )?.[0];
  assert.ok(pointerDownBlock);
  assert.ok(
    pointerDownBlock.indexOf("beginPress(pointerEvent)") <
      pointerDownBlock.indexOf("setPointerCapture")
  );
  assert.match(pointerDownBlock, /try \{[\s\S]*setPointerCapture[\s\S]*\} catch \{/);
  assert.match(nativeHitboxes, /shadowRoot\?\.querySelector<HTMLElement \| SVGElement>\("\[data-core\]"\)/);
  assert.match(nativeHitboxes, /host\.getAttribute\("data-button-pointer-hover"\) === "true"/);
  assert.match(nativeHitboxes, /data-button-skin-host.*data-button-pointer-pressed/);
  assert.match(
    nativeHitboxes,
    /shouldIgnoreButtonWindowCursor\(scopeActive,\s*(?:false|hovered),\s*pointerPressActive\)/
  );
  assert.doesNotMatch(nativeHitboxes, /host\.getAttribute\("data-button-hover"\) === "true"/);
});

test("Play tracking arms only after the latched Play presentation is applied", () => {
  const buttonHost = readFileSync(
    join(frontendRoot, "src", "button", "ButtonHost.tsx"),
    "utf8"
  );
  const startPlayBlock = buttonHost.match(
    /const startPlay = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[\]\);/
  )?.[0];
  assert.ok(startPlayBlock);
  assert.match(
    startPlayBlock,
    /!playVisualAvailableRef\.current \|\|[\s\S]{0,120}playRequestedRef\.current \|\|[\s\S]{0,120}appliedVisualStateRef\.current\.play/
  );
  assert.match(startPlayBlock, /playRequestedRef\.current = true;[\s\S]*?setPlay\(true\);/);
  assert.doesNotMatch(startPlayBlock, /playActiveRef\.current = true|PLAY_SAFETY_MS/);

  assert.match(
    buttonHost,
    /const handleAppliedVisualState = useCallback[\s\S]{0,500}if \(!state\.play\)[\s\S]{0,500}playActiveRef\.current = true;[\s\S]{0,300}window\.setTimeout\(finishPlay, PLAY_SAFETY_MS\)/
  );
  assert.equal(
    buttonHost.match(/!appliedVisualStateRef\.current\.play/g)?.length,
    2
  );
  assert.match(buttonHost, /playRequestedRef\.current = false;[\s\S]{0,120}playActiveRef\.current = false;/);
  assert.match(buttonHost, /void enqueueEvent\("click", activationEvent\);/);
});

test("Main Button single clicks select, double clicks execute, and Pop or Fan stays executable", () => {
  const buttonHost = readFileSync(
    join(frontendRoot, "src", "button", "ButtonHost.tsx"),
    "utf8"
  );
  const mainButtonHost = readFileSync(
    join(frontendRoot, "src", "pages", "main", "MainButtonHost.tsx"),
    "utf8"
  );
  const runtimeButtonRenderer = readFileSync(
    join(frontendRoot, "src", "button", "ButtonRenderer.tsx"),
    "utf8"
  );
  const mainPage = readFileSync(
    join(frontendRoot, "src", "pages", "main", "MainPage.tsx"),
    "utf8"
  );

  assert.match(mainButtonHost, /selectionOnly=\{Boolean\(button\.scriptFileName\)\}/);
  assert.doesNotMatch(runtimeButtonRenderer, /selectionOnly=/);
  assert.match(buttonHost, /if \(selectionOnly\) \{[\s\S]{0,260}eventName === "click"[\s\S]{0,180}onActivate\(button, activationEvent\)/);
  assert.match(buttonHost, /selectionOnlyRef\.current\s*\?[\s\S]{0,260}dispatchPressDown: false,[\s\S]{0,180}runClickOnRelease: true/);
  assert.match(
    mainPage,
    /if \(isPanelScriptButtonAction\(button\.actionId\) && button\.scriptFileName\) \{\s*togglePanelScriptSelection\(button\.scriptFileName\);\s*return;\s*\}/
  );
  assert.match(buttonHost, /interactionElement\.addEventListener\("dblclick", handleDoubleClick\)/);
  assert.match(
    buttonHost,
    /const handleDoubleClick = \(event: Event\) => \{[\s\S]{0,180}await handler\(buttonRef\.current, event as MouseEvent\);[\s\S]{0,320}const placementCycle = placementRef\.current\.activationCycle;[\s\S]{0,260}placementCycle && placementCycle\.states\.length >= 2[\s\S]{0,260}requestActivationTriggerRef\.current\("press", interactionId, true\);[\s\S]{0,120}requestActivationTriggerRef\.current\("release", interactionId, true\);[\s\S]{0,180}await advanceButtonActivationState\(buttonRef\.current\.id, stateCount\)/
  );
  assert.match(buttonHost, /selectionOnlyRef\.current && trigger !== "hover" && !allowSelectionOnlyTrigger/);
  assert.match(buttonHost, /if \(selectionOnlyRef\.current\) \{\s*pressActivationInteractionIdRef\.current = null;\s*\} else \{/);
  assert.match(mainPage, /const handleButtonDoubleActivate = async \([\s\S]{0,500}button\.disabled[\s\S]{0,500}handlePerformPanelScriptPrimaryAction\(button\.scriptFileName, matchedRecord\)/);
  assert.match(mainPage, /const pressPlan = resolveButtonPressEventPlan\(canonical\);[\s\S]{0,900}executeLifecycleEvent\("hoverEnter"\)[\s\S]{0,900}executeLifecycleEvent\("pressDown"\)[\s\S]{0,900}executeLifecycleEvent\("click"\)[\s\S]{0,900}executeLifecycleEvent\("pressUp"\)[\s\S]{0,900}executeLifecycleEvent\("hoverLeave"\)/);
  assert.equal(mainPage.match(/onDoubleActivate=\{handleButtonDoubleActivate\}/g)?.length, 1);
  assert.doesNotMatch(mainPage, /PANEL_SCRIPT_REACTIVATION_GUARD_MS|DOUBLE_CLICK/);
});

test("Button activation state drives live labels and mapped visuals without extending native sampling", () => {
  const buttonHost = readFileSync(
    join(frontendRoot, "src", "button", "ButtonHost.tsx"),
    "utf8"
  );
  const renderer = readFileSync(
    join(frontendRoot, "src", "button", "skins", "ButtonSkinRenderer.tsx"),
    "utf8"
  );
  const activationStateBus = readFileSync(
    join(frontendRoot, "src", "button", "runtime", "ButtonActivationStateBus.ts"),
    "utf8"
  );

  assert.match(buttonHost, /subscribeButtonActivationState\([\s\S]{0,1300}setActivationStateIndex\(index\)/);
  assert.match(buttonHost, /const activationStateKey = activationCycle \? placement\.id : button\.id;/);
  assert.match(buttonHost, /const authoredVisualStates = useMemo\(\(\) => new Set<ButtonSkinVisualState>/);
  assert.match(buttonHost, /resolveButtonAppearance\(\{[\s\S]{0,180}activationBehavior: button\.activationBehavior,[\s\S]{0,100}activationCycle,[\s\S]{0,160}visualStateMap: placement\.visualStateMap/);
  assert.match(buttonHost, /visualStateMap: placement\.visualStateMap,\s*authoredVisualStates,/);
  assert.match(buttonHost, /playVisualAvailableRef\.current = !activationCycle \|\| authoredVisualStates\.has\("play"\)/);
  assert.match(buttonHost, /requestActivationTriggerRef\.current\("press", interactionId\)/);
  assert.match(buttonHost, /requestActivationTriggerRef\.current\("release", activationInteractionId\)/);
  assert.match(buttonHost, /if \(!resumesActiveHoverSession\) \{[\s\S]{0,180}requestActivationTriggerRef\.current\([\s\S]{0,80}"hover"/);
  assert.match(activationStateBus, /interactionWasConsumed\(consumedInteractionIds, request\.activationKey, request\.interactionId\)/);
  assert.match(activationStateBus, /rememberConsumedInteraction\(consumedInteractionIds, request\.activationKey, request\.interactionId\)/);
  assert.match(activationStateBus, /MAX_CONSUMED_INTERACTION_IDS_PER_KEY/);
  assert.match(activationStateBus, /request\.advanceTriggers\[current\] !== request\.trigger/);
  assert.match(buttonHost, /const renderedLabel = inlineEditField[\s\S]{0,160}: resolvedAppearance\.label;/);
  assert.match(buttonHost, /: renderedLabel \|\| "FlowCell Button"/);
  assert.match(buttonHost, /if \(index === activationStateIndexRef\.current\) return;\s*activationStateIndexRef\.current = index;\s*setActivationStateIndex\(index\);/);
  assert.doesNotMatch(buttonHost, /activationStateTransitionRef|resolvePreparedVisualStateRef/);
  assert.match(buttonHost, /hovered=\{resolvedAppearance\.flags\.hovered\}[\s\S]{0,360}error=\{resolvedAppearance\.flags\.error\}/);
  assert.match(buttonHost, /samplingState=\{rawVisualState\}/);
  assert.match(buttonHost, /transitionSamplingKey=\{`\$\{activationStateIndex\}:\$\{resolvedAppearance\.activeTrigger\}:\$\{resolvedAppearance\.visualState\}`\}/);
  assert.match(buttonHost, /onPrepareVisualStateChange=\{onPrepareVisualStateChange\}/);
  assert.match(renderer, /await onPrepareVisualStateChangeRef\.current\?\.\([\s\S]{0,1400}setAppliedVisualPresentation\(presentation\)/);
  assert.match(renderer, /visualLatchStateRef\.current = committed;[\s\S]{0,420}flushSync\(\(\) => \{[\s\S]{0,180}setAppliedVisualPresentation\(presentation\)/);
  assert.match(renderer, /requestButtonVisual\(current, desired\)[\s\S]{0,120}resetButtonVisualLatch\(current, desired\)/);
  assert.match(
    renderer,
    /commitBeforeSupersede: snapshot\.pressed \|\| snapshot\.play \|\| snapshot\.release/
  );
  assert.match(renderer, /return animation\.finished/);
  assert.match(renderer, /Promise\.allSettled\(completions\)/);
  assert.doesNotMatch(renderer, /setTimeout\(finish,\s*250\)/);
  assert.match(renderer, /BUTTON_PERSISTENT_VISUAL_SAMPLE_FRAMES/);
  assert.match(
    renderer,
    /continueMeasurementSampling \|\| transitionFramesRemaining > 0 \|\| offsetFramesRemaining > 0/
  );
});

test("action-backed placement cycles open neutral and reconcile from action responses", () => {
  const buttonHost = readFileSync(
    join(frontendRoot, "src", "button", "ButtonHost.tsx"),
    "utf8"
  );
  const buttonSurface = readFileSync(
    join(frontendRoot, "src", "button", "ButtonSurface.tsx"),
    "utf8"
  );
  const popoutRenderer = readFileSync(
    join(frontendRoot, "src", "button", "popout", "ButtonPopoutRenderer.tsx"),
    "utf8"
  );
  assert.match(buttonHost, /buttonPlacementActivationCycleUsesResultMatches\(cycle\)/);
  assert.match(buttonSurface, /resetResultMappedActivationStateOnMount/);
  assert.match(
    buttonSurface,
    /buttonPlacementActivationCycleUsesResultMatches\(cycle\)[\s\S]{0,140}setButtonActivationState\(placementId, cycle!\.states\.length, 0\)/
  );
  assert.doesNotMatch(buttonSurface, /queryToolsetStateOnMount|queryToolsetState\(/);
  assert.match(buttonSurface, /resolveButtonActivationResultAssignments\([\s\S]{0,220}setButtonActivationState\(/);
  assert.match(buttonSurface, /onExecutionResult\?\.\(placementId, result\)/);
  assert.match(
    popoutRenderer,
    /resetResultMappedActivationStateOnMount=\{unit\.kind === "tool-set"\}/
  );
});

test("explicit Pop and Fan opens reveal after show while layout restore stays passive", () => {
  const windows = readFileSync(
    join(frontendRoot, "src", "button", "windows", "buttonWindows.ts"),
    "utf8"
  );
  const mainPage = readFileSync(
    join(frontendRoot, "src", "pages", "main", "MainPage.tsx"),
    "utf8"
  );
  const nativeWindows = readFileSync(
    join(frontendRoot, "src-tauri", "src", "commands", "windows.rs"),
    "utf8"
  );
  const popoutPage = readFileSync(
    join(frontendRoot, "src", "button", "popout", "ButtonPopoutWindowPage.tsx"),
    "utf8"
  );
  const fanPage = readFileSync(
    join(frontendRoot, "src", "button", "fan", "ButtonFanWindowPage.tsx"),
    "utf8"
  );

  assert.equal((windows.match(/await refreshScopedWindowTopmost\(windowLabel, args\.reveal !== false, true\);/g) ?? []).length, 2);
  assert.equal((windows.match(/applyButtonWindowChrome\(target, true, !existed\)/g) ?? []).length, 2);
  assert.match(windows, /await showWindow\(target, false\);\s*shown = true;\s*await refreshScopedWindowTopmost/);
  assert.equal((mainPage.match(/reveal: false/g) ?? []).length, 2);
  assert.match(
    popoutPage,
    /await ensureCanvasContainsFrame\(visibleBounds\);\s*setGeometryInitialized\(true\);/
  );
  assert.match(
    fanPage,
    /await ensureCanvasContainsFrame\(collapsedBounds\);\s*setGeometryInitialized\(true\);/
  );
  assert.match(nativeWindows, /if explicit_open_reveal \{[\s\S]{0,420}return \(ScopedWindowPlacement::Normal, true\);/);
  assert.match(nativeWindows, /entry\.initial_reveal = true;/);
  assert.match(nativeWindows, /if force\.unwrap_or\(false\) \{[\s\S]{0,260}entry\.last_placement = None;/);
});

test("skin compilation keeps authored source separate from deterministic sanitized markup", () => {
  const source = {
    ...createEmptyButtonSkinSections(),
    structure: `<!-- demo only --><div class='wrap'><span data-core data-note='a&quot;b'>{{label}}<i data-anim='pulse'/></span></div>`,
    keyframes: "@keyframes pulse{from{opacity:.5}to{opacity:1}}",
    play: "--anim-pulse: pulse 120ms ease 1;"
  };
  const skin = {
    id: "skin-sanitizer-test",
    name: "Sanitizer Test",
    ...source,
    metadata: {},
    compileCache: null
  };
  const first = compileButtonSkin(skin);
  const second = compileButtonSkin(skin);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.compiled.sanitizedMarkupTemplate, second.compiled.sanitizedMarkupTemplate);
  assert.notEqual(first.compiled.sanitizedMarkupTemplate, source.structure);
  assert.equal(first.compiled.sanitizedMarkupTemplate.includes("<!--"), false);
  assert.equal(first.compiled.sanitizedMarkupTemplate.includes(`class="wrap"`), true);
  assert.equal(first.compiled.sanitizedMarkupTemplate.includes(`<i data-anim="pulse"></i>`), true);
  assert.equal(source.structure.includes("<!-- demo only -->"), true);
});

test("skin compilation lifts the core inline style below state-section rules", () => {
  const skin = {
    id: "skin-core-style-test",
    name: "Core Style Test",
    ...createEmptyButtonSkinSections(),
    structure: `<div class="wrap" style="opacity:0.9"><span data-core style="font:600 13px sans-serif;padding:4px">{{label}}</span></div>`,
    base: "font-size:24px;--ink:#fff",
    metadata: {},
    compileCache: null
  };
  const result = compileButtonSkin(skin);
  assert.equal(result.ok, true);
  // The core's inline style moves into the stylesheet; decorative inline styles stay.
  assert.equal(result.compiled.sanitizedMarkupTemplate.includes("font:600 13px sans-serif"), false);
  assert.equal(result.compiled.sanitizedMarkupTemplate.includes(`style="opacity:0.9"`), true);
  const hoisted = result.compiled.scopedCss.indexOf("[data-core]{font:600 13px sans-serif;padding:4px}");
  const baseRule = result.compiled.scopedCss.indexOf("font-size:24px");
  assert.equal(hoisted >= 0, true);
  assert.equal(baseRule > hoisted, true);
});

test("Base custom properties cascade to literal nested visual elements", () => {
  const skin = {
    id: "skin-nested-base-test",
    name: "Nested Base Test",
    ...createEmptyButtonSkinSections(),
    structure: `<div data-core style="padding:4px"><span style="background:var(--face,#fc0);color:var(--ink,#111)">{{label}}</span></div>`,
    base: "--face:#d22;--ink:#fff;background:#222",
    metadata: {},
    compileCache: null
  };
  const result = compileButtonSkin(skin);
  assert.equal(result.ok, true);
  assert.equal(
    result.compiled.sanitizedMarkupTemplate.includes("background:var(--face,#fc0)"),
    true
  );
  assert.equal(result.compiled.scopedCss.includes(":host{--face:#d22;--ink:#fff;}"), true);
  assert.equal(result.compiled.scopedCss.includes("[data-core]{background:#222;}"), true);
});

test("Button Editor navigation resolves exact program, panel, Button, and placement contexts", () => {
  const document = createButtonStateDocument();
  const single = button("single", "single-script", source("Blender", "Tools", "single.flowcell-source.json"));
  const owner = button("owner", "tool-set-owner", source("Blender", "Tools", "owner.flowcell-source.json"));
  owner.label = "Rotate";
  const child = button("child", "tool-set-child");
  child.label = "X";
  child.toolSetParentId = owner.id;
  document.buttons = { single, owner, child };
  document.surfaces = {
    pop: {
      id: "pop",
      name: "Single Pop",
      kind: "regular-popout",
      width: 220,
      height: 80,
      placementIds: ["pop-single"],
      visualOverflowAllowance: 0
    },
    panel: {
      id: "panel",
      name: "Blender / Tools",
      kind: "panel",
      width: 640,
      height: 480,
      placementIds: ["panel-single", "panel-owner"],
      visualOverflowAllowance: 0
    },
    toolset: {
      id: "toolset",
      name: "Rotate Tool Set",
      kind: "tool-set-popout",
      width: 240,
      height: 160,
      placementIds: ["toolset-child"],
      visualOverflowAllowance: 0
    }
  };
  document.placements = {
    "pop-single": {
      id: "pop-single", buttonId: single.id, surfaceId: "pop", x: 8, y: 8,
      width: 160, height: 44, zIndex: 0, skinOverrideId: null,
      textFitMode: "shrink", textAlignment: "skin", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    },
    "panel-single": {
      id: "panel-single", buttonId: single.id, surfaceId: "panel", x: 8, y: 8,
      width: 160, height: 44, zIndex: 0, skinOverrideId: null,
      textFitMode: "shrink", textAlignment: "skin", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    },
    "panel-owner": {
      id: "panel-owner", buttonId: owner.id, surfaceId: "panel", x: 176, y: 8,
      width: 160, height: 44, zIndex: 1, skinOverrideId: null,
      textFitMode: "shrink", textAlignment: "skin", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    },
    "toolset-child": {
      id: "toolset-child", buttonId: child.id, surfaceId: "toolset", x: 8, y: 8,
      width: 80, height: 44, zIndex: 0, skinOverrideId: null,
      textFitMode: "shrink", textAlignment: "skin", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    }
  };
  document.popoutUnits = {
    regular: {
      id: "regular", name: "Single Pop", kind: "regular", surfaceId: "pop",
      canonicalBounds: { x: 0, y: 0, width: 220, height: 80 }, desktopBounds: null,
      memberPlacementIds: ["pop-single"], memberSourceIdentities: [single.sourceIdentity],
      selectionKey: "single", openRule: "toggle", closeRule: "escape",
      transparency: 1, pinnedDefault: false
    },
    tool: {
      id: "tool", name: "Rotate", kind: "tool-set", surfaceId: "toolset",
      canonicalBounds: { x: 0, y: 0, width: 240, height: 160 }, desktopBounds: null,
      ownerButtonId: owner.id, childButtonIds: [child.id], childPlacementIds: ["toolset-child"],
      fields: [], openRule: "toggle", closeRule: "escape", transparency: 1,
      pinnedDefault: false
    }
  };

  assert.deepEqual(resolveButtonEditorIdentity(document, child.id), {
    programName: "Blender",
    panelName: "Tools"
  });
  assert.deepEqual(buildButtonEditorPanelOptions(document, "Blender", []), ["Tools"]);
  assert.equal(resolveButtonEditorPanelSurfaceId(document, "Blender", "Tools"), "panel");
  assert.deepEqual(
    resolveButtonEditorSurfaceSkinTargetPlacementIds(
      document,
      "panel-single"
    ),
    ["panel-single", "panel-owner"]
  );
  assert.deepEqual(
    resolveButtonEditorSurfaceSkinTargetPlacementIds(
      document,
      "pop-single"
    ),
    ["pop-single"]
  );
  assert.deepEqual(
    resolveButtonEditorSurfaceSkinTargetPlacementIds(
      document,
      "toolset-child"
    ),
    ["toolset-child"]
  );
  assert.equal(resolvePreferredButtonPlacementId(document, single.id), "panel-single");
  assert.equal(resolvePreferredButtonPlacementId(document, single.id, "pop"), "pop-single");
  assert.deepEqual(
    buildButtonEditorPlacementOptions(document, single.id).map((option) => option.label),
    ["Main Page", "Pop-out"]
  );
  const ownerPlacementOptions = buildButtonEditorPlacementOptions(document, owner.id);
  assert.deepEqual(
    ownerPlacementOptions.map((option) => option.label),
    ["Main Page"]
  );
  assert.deepEqual(
    buildButtonEditorPlacementOptions(document, child.id).map((option) => option.label),
    ["Pop-out"]
  );
  const options = buildButtonEditorButtonOptions(document, "Blender", "Tools");
  assert.equal(options.some((option) => option.id === child.id && option.label === "X — Rotate"), true);
});

test("surface skin assignment targets every member of only the focused surface", () => {
  const document = createButtonStateDocument();
  document.surfaces = {
    panel: {
      id: "panel",
      name: "Main",
      kind: "panel",
      width: 400,
      height: 300,
      placementIds: ["panel-a", "panel-b", "stale-placement"],
      visualOverflowAllowance: 0
    },
    pop: {
      id: "pop",
      name: "Regular Pop",
      kind: "regular-popout",
      width: 400,
      height: 300,
      placementIds: ["pop-a", "pop-b"],
      visualOverflowAllowance: 0
    },
    fan: {
      id: "fan",
      name: "Fan",
      kind: "fan",
      width: 400,
      height: 300,
      placementIds: ["fan-a", "fan-b"],
      visualOverflowAllowance: 0
    },
    toolset: {
      id: "toolset",
      name: "Tool-set Pop",
      kind: "tool-set-popout",
      width: 400,
      height: 300,
      placementIds: ["toolset-a", "toolset-b"],
      visualOverflowAllowance: 0
    }
  };
  document.placements = {
    "panel-a": { id: "panel-a", buttonId: "shared", surfaceId: "panel" },
    "panel-b": { id: "panel-b", buttonId: "panel-only", surfaceId: "panel" },
    "pop-a": { id: "pop-a", buttonId: "shared", surfaceId: "pop" },
    "pop-b": { id: "pop-b", buttonId: "pop-only", surfaceId: "pop" },
    "fan-a": { id: "fan-a", buttonId: "shared", surfaceId: "fan" },
    "fan-b": { id: "fan-b", buttonId: "fan-only", surfaceId: "fan" },
    "toolset-a": { id: "toolset-a", buttonId: "shared", surfaceId: "toolset" },
    "toolset-b": { id: "toolset-b", buttonId: "toolset-only", surfaceId: "toolset" },
    orphan: { id: "orphan", buttonId: "shared", surfaceId: "missing-surface" }
  };

  assert.deepEqual(
    resolveButtonEditorSurfaceSkinTargetPlacementIds(document, "panel-a"),
    ["panel-a", "panel-b"]
  );
  assert.deepEqual(
    resolveButtonEditorSurfaceSkinTargetPlacementIds(document, "pop-a"),
    ["pop-a", "pop-b"]
  );
  assert.deepEqual(
    resolveButtonEditorSurfaceSkinTargetPlacementIds(document, "fan-a"),
    ["fan-a", "fan-b"]
  );
  assert.deepEqual(
    resolveButtonEditorSurfaceSkinTargetPlacementIds(document, "toolset-a"),
    ["toolset-a", "toolset-b"]
  );
  assert.deepEqual(
    resolveButtonEditorSurfaceSkinTargetPlacementIds(document, "missing-placement"),
    []
  );
  assert.deepEqual(
    resolveButtonEditorSurfaceSkinTargetPlacementIds(document, "orphan"),
    []
  );
});

test("panel-owner reconciliation creates empty panels and preserves presentation", () => {
  const document = createButtonStateDocument();
  const panels = [
    { panelName: "Files", rect: { x: 199, y: 126, width: 132, height: 37 } },
    { panelName: "Utility", rect: { x: 199, y: 176, width: 132, height: 37 } }
  ];
  const first = reconcileProgramPanelOwners(document, {
    programName: "Windows",
    panels,
    surfaceBounds: { width: 1225, height: 721 }
  });
  assert.equal(first.changed, true);
  assert.equal(first.surfaceId, initialProgramPanelOwnerSurfaceId("Windows"));
  assert.deepEqual(first.uninstallOwnerButtonIds, []);
  const utility = findPanelOwnerButton(document, " windows ", "UTILITY");
  const utilityPlacement = resolvePanelOwnerMainPlacement(document, "Windows", "Utility");
  assert.ok(utility);
  assert.ok(utilityPlacement);
  assert.equal(utility.id, initialPanelOwnerButtonId("Windows", "Utility"));
  assert.equal(utilityPlacement.id, initialPanelOwnerMainPlacementId("Windows", "Utility"));
  assert.deepEqual(
    { x: utilityPlacement.x, y: utilityPlacement.y, width: utilityPlacement.width, height: utilityPlacement.height },
    panels[1].rect
  );
  assert.equal(document.surfaces[first.surfaceId].width, 1225);
  assert.equal(document.surfaces[first.surfaceId].height, 721);
  assert.deepEqual(
    resolveButtonEditorSurfaceSkinTargetPlacementIds(
      document,
      utilityPlacement.id
    ),
    [
      initialPanelOwnerMainPlacementId("Windows", "Files"),
      initialPanelOwnerMainPlacementId("Windows", "Utility")
    ]
  );
  const initialPlacementOptions = buildButtonEditorPlacementOptions(document, utility.id);
  assert.deepEqual(
    initialPlacementOptions.map((option) => option.label),
    ["Main Page"]
  );

  utility.label = "Windows Tools";
  utility.tooltip = "Custom panel tooltip";
  utility.metadata.custom = "keep";
  utilityPlacement.x = 244;
  utilityPlacement.width = 150;
  utilityPlacement.skinOverrideId = document.settings.defaultSkinId;
  const preserved = structuredClone({ button: utility, placement: utilityPlacement });
  const second = reconcileProgramPanelOwners(document, {
    programName: "Windows",
    panels,
    surfaceBounds: { width: 1225, height: 721 }
  });
  assert.equal(second.changed, false);
  assert.deepEqual(document.buttons[utility.id], preserved.button);
  assert.deepEqual(document.placements[utilityPlacement.id], preserved.placement);
  assert.equal(validateButtonStateDocument(document).valid, true);
});

test("adding an alphabetically earlier panel keeps existing rail geometry collision-free", () => {
  const document = createButtonStateDocument();
  const filesRect = { x: 199, y: 126, width: 132, height: 37 };
  const utilityRect = { x: 199, y: 176, width: 132, height: 37 };
  const actionsRect = { x: 199, y: 126, width: 132, height: 37 };
  reconcileProgramPanelOwners(document, {
    programName: "Windows",
    panels: [
      { panelName: "Files", rect: filesRect },
      { panelName: "Utility", rect: utilityRect }
    ],
    surfaceBounds: { width: 1225, height: 721 }
  });
  const filesPlacement = structuredClone(resolvePanelOwnerMainPlacement(document, "Windows", "Files"));
  const utilityPlacement = structuredClone(resolvePanelOwnerMainPlacement(document, "Windows", "Utility"));

  const result = reconcileProgramPanelOwners(document, {
    programName: "Windows",
    panels: [
      { panelName: "Actions", rect: actionsRect },
      { panelName: "Files", rect: utilityRect },
      { panelName: "Utility", rect: { x: 199, y: 226, width: 132, height: 37 } }
    ],
    surfaceBounds: { width: 1225, height: 721 }
  });
  const actionsPlacement = resolvePanelOwnerMainPlacement(document, "Windows", "Actions");
  assert.equal(result.changed, true);
  assert.ok(actionsPlacement);
  assert.deepEqual(resolvePanelOwnerMainPlacement(document, "Windows", "Files"), filesPlacement);
  assert.deepEqual(resolvePanelOwnerMainPlacement(document, "Windows", "Utility"), utilityPlacement);
  assert.equal(actionsPlacement.y, 226);
  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
});

test("one panel owner has exact Main and Fan placements", () => {
  const document = createButtonStateDocument();
  reconcileProgramPanelOwners(document, {
    programName: "Windows",
    panels: [{ panelName: "Utility", rect: { x: 199, y: 126, width: 132, height: 37 } }],
    surfaceBounds: { width: 1225, height: 721 }
  });
  const owner = findPanelOwnerButton(document, "Windows", "Utility");
  assert.ok(owner);
  const script = button("toggle-monitors", "single-script", source("Windows", "Utility", "toggle.flowcell-source.json"));
  script.label = "Toggle Monitors";
  script.executionTarget = {
    kind: "panel-script", programName: "Windows", panelName: "Utility",
    fileName: "toggle.flowcell-source.json"
  };
  document.buttons[script.id] = script;
  const setup = ensureFanSetup({ document, programName: "Windows", panelName: "Utility", buttons: [script] });
  assert.equal(setup.panelOwnerButtonId, owner.id);
  const mainPlacement = resolvePanelOwnerMainPlacement(document, "Windows", "Utility");
  const fanPlacement = resolvePanelOwnerFanPlacement(document, setup.id);
  assert.ok(mainPlacement);
  assert.ok(fanPlacement);
  assert.notEqual(mainPlacement.id, fanPlacement.id);
  assert.equal(fanPlacement.surfaceId, setup.fanSurfaceId);
  assert.equal(
    resolveButtonEditorContextPlacementId(document, { surfaceId: setup.fanSurfaceId }),
    fanPlacement.id
  );
  assert.deepEqual(
    buildButtonEditorPlacementOptions(document, owner.id).map((option) => option.label),
    ["Main Page", "Fan"]
  );
  assert.equal(buildButtonEditorButtonOptions(document, "Windows", "Utility").some((option) => option.id === owner.id), true);
  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));

  const duplicateOwner = structuredClone(document);
  const duplicatePlacementId = "duplicate-fan-panel-owner";
  duplicateOwner.placements[duplicatePlacementId] = {
    ...structuredClone(fanPlacement),
    id: duplicatePlacementId,
    x: fanPlacement.x + fanPlacement.width + 8
  };
  duplicateOwner.surfaces[setup.fanSurfaceId].placementIds.push(duplicatePlacementId);
  assert.equal(resolvePanelOwnerFanPlacement(duplicateOwner, setup.id), null);
  const rejected = validateButtonStateDocument(duplicateOwner);
  assert.equal(rejected.valid, false);
  assert.equal(
    rejected.issues.some((issue) => issue.path === `fanSetups.${setup.id}.panelOwnerButtonId`),
    true
  );
});

test("Button Editor Fan disclosure matches hover and click-pin behavior", () => {
  assert.equal(BUTTON_FAN_EDITOR_HOVER_CLOSE_DELAY_MS, 140);
  let state = createInitialButtonFanDisclosureState();
  state = reduceButtonFanDisclosure(state, { type: "hover-enter" });
  assert.deepEqual(state, {
    expanded: true,
    pinned: false,
    suppressHoverUntilLeave: false
  });
  state = reduceButtonFanDisclosure(state, { type: "hover-leave" });
  assert.deepEqual(state, createInitialButtonFanDisclosureState());

  state = reduceButtonFanDisclosure(state, { type: "owner-activate" });
  assert.equal(state.expanded, true);
  assert.equal(state.pinned, true);
  state = reduceButtonFanDisclosure(state, { type: "hover-leave" });
  assert.equal(state.expanded, true);
  assert.equal(state.pinned, true);

  state = reduceButtonFanDisclosure(state, { type: "owner-activate" });
  assert.deepEqual(state, {
    expanded: false,
    pinned: false,
    suppressHoverUntilLeave: true
  });
  state = reduceButtonFanDisclosure(state, { type: "hover-enter" });
  assert.equal(state.expanded, false);
  state = reduceButtonFanDisclosure(state, { type: "hover-leave" });
  state = reduceButtonFanDisclosure(state, { type: "hover-enter" });
  assert.equal(state.expanded, true);
  assert.equal(state.pinned, false);
});

test("Button Editor Fan disclosure honors saved open, close, and pinned rules", () => {
  const clickEscape = {
    openRule: "click",
    closeRule: "escape",
    pinnedDefault: false
  };
  let state = createInitialButtonFanDisclosureState(clickEscape);
  state = reduceButtonFanDisclosure(state, { type: "hover-enter" }, clickEscape);
  assert.equal(state.expanded, false);
  state = reduceButtonFanDisclosure(state, { type: "owner-activate" }, clickEscape);
  assert.equal(state.expanded, true);
  assert.equal(state.pinned, true);
  state = reduceButtonFanDisclosure(state, { type: "owner-activate" }, clickEscape);
  assert.equal(state.expanded, false);
  assert.equal(state.suppressHoverUntilLeave, true);
  state = reduceButtonFanDisclosure(state, { type: "hover-leave" }, clickEscape);
  assert.equal(state.suppressHoverUntilLeave, false);

  for (const closeRule of ["escape", "manual"]) {
    const rules = { openRule: "hover", closeRule, pinnedDefault: false };
    let transient = createInitialButtonFanDisclosureState(rules);
    transient = reduceButtonFanDisclosure(transient, { type: "hover-enter" }, rules);
    transient = reduceButtonFanDisclosure(transient, { type: "hover-leave" }, rules);
    assert.equal(transient.expanded, true);
    assert.equal(transient.pinned, false);
  }

  const manual = {
    openRule: "manual",
    closeRule: "manual",
    pinnedDefault: false
  };
  state = createInitialButtonFanDisclosureState(manual);
  state = reduceButtonFanDisclosure(state, { type: "hover-enter" }, manual);
  assert.equal(state.expanded, false);
  state = reduceButtonFanDisclosure(state, { type: "owner-activate" }, manual);
  assert.equal(state.expanded, true);
  assert.equal(state.pinned, true);

  const pinned = {
    openRule: "manual",
    closeRule: "manual",
    pinnedDefault: true
  };
  state = createInitialButtonFanDisclosureState(pinned);
  assert.equal(state.expanded, true);
  assert.equal(state.pinned, true);
  state = reduceButtonFanDisclosure(
    createInitialButtonFanDisclosureState(),
    { type: "reset" },
    pinned
  );
  assert.equal(state.expanded, true);
  assert.equal(state.pinned, true);
});

test("panel-owner renames preserve IDs and custom presentation with collision-safe recreation", () => {
  const document = createButtonStateDocument();
  reconcileProgramPanelOwners(document, {
    programName: "Windows",
    panels: [
      { panelName: "Files", rect: { x: 199, y: 126, width: 132, height: 37 } },
      { panelName: "Utility", rect: { x: 199, y: 176, width: 132, height: 37 } }
    ],
    surfaceBounds: { width: 1225, height: 721 }
  });
  const owner = findPanelOwnerButton(document, "Windows", "Utility");
  const placement = resolvePanelOwnerMainPlacement(document, "Windows", "Utility");
  assert.ok(owner);
  assert.ok(placement);
  owner.label = "My Utility";
  owner.tooltip = "Keep this tooltip";
  placement.x = 321;
  const ownerId = owner.id;
  const placementId = placement.id;
  const script = button("utility-script", "single-script", source("Windows", "Utility", "utility.flowcell-source.json"));
  script.executionTarget = {
    kind: "panel-script", programName: "Windows", panelName: "Utility",
    fileName: "utility.flowcell-source.json"
  };
  document.buttons[script.id] = script;
  const setup = ensureFanSetup({ document, programName: "Windows", panelName: "Utility", buttons: [script] });

  const panelRename = renamePanelOwnerIdentity(document, {
    programName: "Windows", currentPanelName: "Utility", nextPanelName: "Tools"
  });
  assert.equal(panelRename.ownerButtonId, ownerId);
  assert.equal(findPanelOwnerButton(document, "Windows", "Tools")?.id, ownerId);
  assert.equal(document.buttons[ownerId].label, "My Utility");
  assert.equal(document.buttons[ownerId].tooltip, "Keep this tooltip");
  assert.equal(document.placements[placementId].x, 321);
  assert.equal(document.fanSetups[setup.id].panelName, "Tools");

  const programRename = renameProgramPanelOwnerIdentities(document, {
    currentProgramName: "Windows", nextProgramName: "Desktop"
  });
  assert.equal(programRename.changed, true);
  assert.equal(findPanelOwnerButton(document, "Desktop", "Tools")?.id, ownerId);
  assert.equal(document.fanSetups[setup.id].programName, "Desktop");

  const recreated = reconcileProgramPanelOwners(document, {
    programName: "Windows",
    panels: [{ panelName: "Utility", rect: { x: 199, y: 126, width: 132, height: 37 } }],
    surfaceBounds: { width: 1225, height: 721 }
  });
  const recreatedOwner = findPanelOwnerButton(document, "Windows", "Utility");
  assert.ok(recreatedOwner);
  assert.notEqual(recreatedOwner.id, ownerId);
  assert.equal(recreatedOwner.id.endsWith("-2"), true);
  assert.notEqual(recreated.surfaceId, document.placements[placementId].surfaceId);
  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
});

test("panel-owner reconcile and removal leave no stale owner graphs", () => {
  const document = createButtonStateDocument();
  const entries = [
    { panelName: "Files", rect: { x: 199, y: 126, width: 132, height: 37 } },
    { panelName: "Utility", rect: { x: 199, y: 176, width: 132, height: 37 } }
  ];
  const first = reconcileProgramPanelOwners(document, {
    programName: "Windows", panels: entries, surfaceBounds: { width: 1225, height: 721 }
  });
  const utilityOwner = findPanelOwnerButton(document, "Windows", "Utility");
  assert.ok(utilityOwner);
  const script = button("utility-member", "single-script", source("Windows", "Utility", "member.flowcell-source.json"));
  script.executionTarget = {
    kind: "panel-script", programName: "Windows", panelName: "Utility",
    fileName: "member.flowcell-source.json"
  };
  document.buttons[script.id] = script;
  const setup = ensureFanSetup({ document, programName: "Windows", panelName: "Utility", buttons: [script] });

  const exact = reconcileProgramPanelOwners(document, {
    programName: "Windows", panels: [entries[0]], surfaceBounds: { width: 1225, height: 721 }
  });
  assert.deepEqual(exact.removedOwnerButtonIds, [utilityOwner.id]);
  assert.deepEqual(exact.uninstallOwnerButtonIds, []);
  assert.equal(document.buttons[utilityOwner.id], undefined);
  assert.equal(document.fanSetups[setup.id], undefined);
  assert.equal(document.surfaces[setup.fanSurfaceId], undefined);
  assert.ok(document.buttons[script.id]);
  assert.ok(document.surfaces[first.surfaceId]);

  const filesRemoval = removePanelOwnerGraph(document, "Windows", "Files");
  assert.equal(filesRemoval.changed, true);
  assert.deepEqual(filesRemoval.uninstallOwnerButtonIds, []);
  assert.equal(document.surfaces[first.surfaceId], undefined);
  assert.equal(removeProgramPanelOwnerGraphs(document, "Windows").changed, false);

  reconcileProgramPanelOwners(document, {
    programName: "Windows", panels: entries, surfaceBounds: { width: 1225, height: 721 }
  });
  const allRemoval = reconcileProgramPanelOwners(document, { programName: "Windows", panels: [] });
  assert.equal(allRemoval.removedOwnerButtonIds.length, 2);
  assert.deepEqual(allRemoval.uninstallOwnerButtonIds, []);
  assert.equal(findPanelOwnerButton(document, "Windows", "Files"), null);
  assert.equal(findPanelOwnerButton(document, "Windows", "Utility"), null);
  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
});

test("panel-owner discovery reconciliation never removes owners from a stale folder snapshot", () => {
  const document = createButtonStateDocument();
  const entries = [
    { panelName: "Files", rect: { x: 199, y: 126, width: 132, height: 37 } },
    { panelName: "Utility", rect: { x: 199, y: 176, width: 132, height: 37 } }
  ];
  reconcileProgramPanelOwners(document, {
    programName: "Windows",
    panels: entries,
    surfaceBounds: { width: 1225, height: 721 }
  });
  const utilityOwner = findPanelOwnerButton(document, "Windows", "Utility");
  assert.ok(utilityOwner);

  const staleDiscovery = reconcileProgramPanelOwners(document, {
    programName: "Windows",
    panels: [entries[0]],
    surfaceBounds: { width: 1225, height: 721 },
    removeStaleOwners: false
  });

  assert.deepEqual(staleDiscovery.removedOwnerButtonIds, []);
  assert.deepEqual(staleDiscovery.uninstallOwnerButtonIds, []);
  assert.equal(findPanelOwnerButton(document, "Windows", "Utility")?.id, utilityOwner.id);
  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
});

test("panel scope rename rewrites every owned target while preserving IDs and presentation", () => {
  const { document, ids } = buildButtonDocumentScopeFixture();
  assertValidScopeFixture(document);
  const preserved = renamePreservationSnapshot(document);
  const siblingPanel = structuredClone(document.buttons[ids.siblingPanel]);
  const siblingProgram = structuredClone(document.buttons[ids.siblingProgram]);
  const siblingPanelOwner = structuredClone(document.buttons[ids.otherPanelOwner]);

  const result = renamePanelButtonDocumentScope(document, {
    programName: "Blender",
    currentPanelName: "Tools",
    nextPanelName: "Widgets"
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.sourceOwnerButtonIds, ids.scopeSourceOwners);
  ids.scopeSourceOwners.forEach((buttonId) => {
    assert.equal(document.buttons[buttonId].sourceIdentity.displayProgramName, "Blender");
    assert.equal(document.buttons[buttonId].sourceIdentity.displayPanelName, "Widgets");
  });
  assert.deepEqual(document.buttons["scope-script"].executionTarget, {
    kind: "panel-script",
    programName: "Blender",
    panelName: "Widgets",
    fileName: "scope-script.flowcell-source.json"
  });
  assert.deepEqual(document.buttons["scope-core"].executionTarget.payload, {
    programName: "Blender",
    panelName: "Widgets",
    note: "keep"
  });
  assert.equal(document.buttons["scope-tool-child"].executionTarget.panelName, "Widgets");
  assert.equal(
    document.popoutUnits[ids.toolUnit].fields[0].serviceTarget.panelName,
    "Widgets"
  );
  const regular = document.popoutUnits[ids.regular];
  assert.equal(regular.memberSourceIdentities.every((identity) =>
    identity.displayProgramName === "Blender" && identity.displayPanelName === "Widgets"
  ), true);
  assert.equal(regular.selectionKey, deriveRegularPopoutSelectionKey(regular.memberSourceIdentities));
  assert.equal(document.fanSetups[ids.fan].programName, "Blender");
  assert.equal(document.fanSetups[ids.fan].panelName, "Widgets");
  assert.equal(findPanelOwnerButton(document, "Blender", "Widgets")?.id, ids.toolsPanelOwner);
  assert.equal(document.buttons[ids.toolsPanelOwner].label, "Custom Tools Panel");
  assert.equal(document.buttons[ids.toolsPanelOwner].tooltip, "Keep panel presentation");
  assert.equal(document.surfaces[ids.toolsPanelSurface].name, "Blender / Widgets");
  assert.deepEqual(document.buttons[ids.siblingPanel], siblingPanel);
  assert.deepEqual(document.buttons[ids.siblingProgram], siblingProgram);
  assert.deepEqual(document.buttons[ids.otherPanelOwner], siblingPanelOwner);
  assert.deepEqual(renamePreservationSnapshot(document), preserved);
  assertValidScopeFixture(document);
});

test("program scope rename rewrites every panel graph including empty registered panels", () => {
  const { document, ids } = buildButtonDocumentScopeFixture();
  assertValidScopeFixture(document);
  const preserved = renamePreservationSnapshot(document);
  const illustratorButton = structuredClone(document.buttons[ids.siblingProgram]);
  const illustratorOwner = structuredClone(document.buttons[ids.illustratorPanelOwner]);

  const result = renameProgramButtonDocumentScope(document, {
    currentProgramName: "Blender",
    nextProgramName: "Studio"
  });

  assert.equal(result.changed, true);
  assert.deepEqual(
    result.sourceOwnerButtonIds,
    [...ids.scopeSourceOwners, ids.siblingPanel].sort()
  );
  [...ids.scopeSourceOwners, ids.siblingPanel].forEach((buttonId) => {
    assert.equal(document.buttons[buttonId].sourceIdentity.displayProgramName, "Studio");
  });
  assert.equal(document.buttons["scope-script"].executionTarget.programName, "Studio");
  assert.equal(document.buttons["scope-core"].executionTarget.payload.programName, "Studio");
  assert.equal(document.buttons["scope-core"].executionTarget.payload.panelName, "Tools");
  assert.equal(document.buttons["scope-tool-child"].executionTarget.programName, "Studio");
  assert.equal(document.buttons[ids.siblingPanel].executionTarget.programName, "Studio");
  assert.equal(
    document.popoutUnits[ids.toolUnit].fields[0].serviceTarget.programName,
    "Studio"
  );
  const regular = document.popoutUnits[ids.regular];
  assert.equal(regular.memberSourceIdentities.every((identity) =>
    identity.displayProgramName === "Studio" && identity.displayPanelName === "Tools"
  ), true);
  assert.equal(regular.selectionKey, deriveRegularPopoutSelectionKey(regular.memberSourceIdentities));
  assert.equal(document.fanSetups[ids.fan].programName, "Studio");
  assert.equal(document.fanSetups[ids.fan].panelName, "Tools");
  assert.equal(findPanelOwnerButton(document, "Studio", "Tools")?.id, ids.toolsPanelOwner);
  assert.equal(findPanelOwnerButton(document, "Studio", "Other")?.id, ids.otherPanelOwner);
  assert.equal(findPanelOwnerButton(document, "Studio", "Utility")?.id, ids.utilityPanelOwner);
  assert.equal(document.surfaces[ids.toolsPanelSurface].name, "Studio / Tools");
  assert.equal(document.surfaces[ids.otherPanelSurface].name, "Studio / Other");
  assert.equal(document.surfaces[ids.utilityPanelSurface].name, "Studio / Utility");
  assert.deepEqual(document.buttons[ids.siblingProgram], illustratorButton);
  assert.deepEqual(document.buttons[ids.illustratorPanelOwner], illustratorOwner);
  assert.deepEqual(renamePreservationSnapshot(document), preserved);
  assertValidScopeFixture(document);
});

test("case-only program scope rename is an exact-case idempotent mutation", () => {
  const { document, ids } = buildButtonDocumentScopeFixture();

  const first = renameProgramButtonDocumentScope(document, {
    currentProgramName: "Blender",
    nextProgramName: "blender"
  });
  assert.equal(first.changed, true);
  [...ids.scopeSourceOwners, ids.siblingPanel].forEach((buttonId) => {
    assert.equal(document.buttons[buttonId].sourceIdentity.displayProgramName, "blender");
  });
  assert.equal(document.buttons[ids.toolsPanelOwner].metadata.programName, "blender");
  assert.equal(document.surfaces[ids.toolsPanelSurface].name, "blender / Tools");

  const persisted = structuredClone(document);
  const second = renameProgramButtonDocumentScope(document, {
    currentProgramName: "Blender",
    nextProgramName: "blender"
  });
  assert.equal(second.changed, false);
  assert.deepEqual(document, persisted);
  assertValidScopeFixture(document);
});

test("panel scope deletion returns exact uninstall owners and preserves sibling scopes", () => {
  const { document, ids } = buildButtonDocumentScopeFixture();
  assertValidScopeFixture(document);
  const siblingPanel = structuredClone(document.buttons[ids.siblingPanel]);
  const siblingProgram = structuredClone(document.buttons[ids.siblingProgram]);
  const siblingPanelPlacement = structuredClone(
    document.placements[document.surfaces[ids.otherPanelSurface].placementIds[0]]
  );
  const siblingOwnerPlacement = structuredClone(
    resolvePanelOwnerMainPlacement(document, "Blender", "Other")
  );

  const result = removePanelButtonDocumentScope(document, {
    programName: "Blender",
    panelName: "Tools"
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.uninstallOwnerButtonIds, ids.scopeSourceOwners);
  assert.deepEqual(
    result.removedButtonIds,
    [...ids.scopeButtons, ids.toolsPanelOwner].sort()
  );
  result.removedButtonIds.forEach((buttonId) => assert.equal(document.buttons[buttonId], undefined));
  assert.equal(document.popoutUnits[ids.regular], undefined);
  assert.equal(document.popoutUnits[ids.toolUnit], undefined);
  assert.equal(document.fanSetups[ids.fan], undefined);
  assert.equal(document.surfaces[ids.toolsPanelSurface], undefined);
  assert.ok(document.surfaces[ids.otherPanelSurface]);
  assert.ok(document.surfaces[ids.utilityPanelSurface]);
  assert.ok(document.surfaces[ids.blenderRailSurface]);
  assert.deepEqual(document.buttons[ids.siblingPanel], siblingPanel);
  assert.deepEqual(document.buttons[ids.siblingProgram], siblingProgram);
  assert.deepEqual(
    document.placements[siblingPanelPlacement.id],
    siblingPanelPlacement
  );
  assert.deepEqual(
    document.placements[siblingOwnerPlacement.id],
    siblingOwnerPlacement
  );
  assert.equal(document.buttons[ids.otherPanelOwner].role, "panel-owner");
  assert.equal(document.buttons[ids.utilityPanelOwner].role, "panel-owner");
  assertValidScopeFixture(document);
});

test("program scope deletion uninstalls only that program and preserves the other program", () => {
  const { document, ids } = buildButtonDocumentScopeFixture();
  assertValidScopeFixture(document);
  const illustratorButton = structuredClone(document.buttons[ids.siblingProgram]);
  const illustratorOwner = structuredClone(document.buttons[ids.illustratorPanelOwner]);
  const illustratorPlacement = structuredClone(
    document.placements[document.surfaces[ids.illustratorPanelSurface].placementIds[0]]
  );
  const illustratorOwnerPlacement = structuredClone(
    resolvePanelOwnerMainPlacement(document, "Illustrator", "Tools")
  );

  const result = removeProgramButtonDocumentScope(document, { programName: "Blender" });

  assert.equal(result.changed, true);
  assert.deepEqual(
    result.uninstallOwnerButtonIds,
    [...ids.scopeSourceOwners, ids.siblingPanel].sort()
  );
  assert.deepEqual(
    result.removedButtonIds,
    [
      ...ids.scopeButtons,
      ids.siblingPanel,
      ids.toolsPanelOwner,
      ids.otherPanelOwner,
      ids.utilityPanelOwner
    ].sort()
  );
  result.removedButtonIds.forEach((buttonId) => assert.equal(document.buttons[buttonId], undefined));
  assert.equal(document.surfaces[ids.toolsPanelSurface], undefined);
  assert.equal(document.surfaces[ids.otherPanelSurface], undefined);
  assert.equal(document.surfaces[ids.utilityPanelSurface], undefined);
  assert.equal(document.surfaces[ids.blenderRailSurface], undefined);
  assert.deepEqual(document.buttons[ids.siblingProgram], illustratorButton);
  assert.deepEqual(document.buttons[ids.illustratorPanelOwner], illustratorOwner);
  assert.deepEqual(document.placements[illustratorPlacement.id], illustratorPlacement);
  assert.deepEqual(
    document.placements[illustratorOwnerPlacement.id],
    illustratorOwnerPlacement
  );
  assert.ok(document.surfaces[ids.illustratorPanelSurface]);
  assert.ok(document.surfaces[ids.illustratorRailSurface]);
  assertValidScopeFixture(document);
});

test("Button Editor navigation disambiguates final Button and placement label collisions", () => {
  const document = createButtonStateDocument();
  const firstButton = button(
    "button-owner-alpha-sharedtail",
    "single-script",
    source("Blender", "Tools", "same.py")
  );
  const secondButton = button(
    "button-owner-beta-sharedtail",
    "single-script",
    source("Blender", "Tools", "same.py")
  );
  firstButton.label = "Same";
  secondButton.label = "Same";
  document.buttons = {
    [secondButton.id]: secondButton,
    [firstButton.id]: firstButton
  };
  document.surfaces = {
    "surface-alpha-sharedtail": {
      id: "surface-alpha-sharedtail",
      name: "Same",
      kind: "regular-popout",
      width: 220,
      height: 80,
      placementIds: ["placement-alpha-sharedtail"],
      visualOverflowAllowance: 0
    },
    "surface-beta-sharedtail": {
      id: "surface-beta-sharedtail",
      name: "Same",
      kind: "regular-popout",
      width: 220,
      height: 80,
      placementIds: ["placement-beta-sharedtail"],
      visualOverflowAllowance: 0
    }
  };
  document.placements = {
    "placement-beta-sharedtail": {
      id: "placement-beta-sharedtail", buttonId: firstButton.id,
      surfaceId: "surface-beta-sharedtail", x: 8, y: 8,
      width: 160, height: 44, zIndex: 0, skinOverrideId: null,
      textFitMode: "shrink", textAlignment: "skin", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    },
    "placement-alpha-sharedtail": {
      id: "placement-alpha-sharedtail", buttonId: firstButton.id,
      surfaceId: "surface-alpha-sharedtail", x: 8, y: 8,
      width: 160, height: 44, zIndex: 0, skinOverrideId: null,
      textFitMode: "shrink", textAlignment: "skin", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    },
    "placement-second-button": {
      id: "placement-second-button", buttonId: secondButton.id,
      surfaceId: "surface-alpha-sharedtail", x: 8, y: 60,
      width: 160, height: 44, zIndex: 1, skinOverrideId: null,
      textFitMode: "shrink", textAlignment: "skin", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    }
  };
  document.surfaces["surface-alpha-sharedtail"].placementIds.push("placement-second-button");
  document.popoutUnits = {
    alpha: {
      id: "alpha", name: "Same", kind: "regular",
      surfaceId: "surface-alpha-sharedtail",
      canonicalBounds: { x: 0, y: 0, width: 220, height: 120 },
      desktopBounds: null,
      memberPlacementIds: ["placement-alpha-sharedtail", "placement-second-button"],
      memberSourceIdentities: [firstButton.sourceIdentity, secondButton.sourceIdentity],
      selectionKey: "alpha", openRule: "toggle", closeRule: "escape",
      transparency: 1, pinnedDefault: false
    },
    beta: {
      id: "beta", name: "Same", kind: "regular",
      surfaceId: "surface-beta-sharedtail",
      canonicalBounds: { x: 0, y: 0, width: 220, height: 80 },
      desktopBounds: null,
      memberPlacementIds: ["placement-beta-sharedtail"],
      memberSourceIdentities: [firstButton.sourceIdentity],
      selectionKey: "beta", openRule: "toggle", closeRule: "escape",
      transparency: 1, pinnedDefault: false
    }
  };

  const buttonOptions = buildButtonEditorButtonOptions(document, "Blender", "Tools");
  const buttonLabels = buttonOptions.map((option) => option.label);
  assert.equal(new Set(buttonLabels).size, buttonLabels.length);
  assert.equal(buttonLabels.every((label) => label.startsWith("Same — same.py — ")), true);

  const placementOptions = buildButtonEditorPlacementOptions(document, firstButton.id);
  const placementLabels = placementOptions.map((option) => option.label);
  assert.equal(placementLabels.length, 2);
  assert.equal(new Set(placementLabels).size, 1);
  assert.equal(placementLabels.every((label) => label === "Pop-out"), true);
});

test("staged Button import cleanup removes successes and retains failures for retry", async () => {
  const first = { ownerButtonId: "button-first" };
  const second = { ownerButtonId: "button-second" };
  const staged = new Map([
    [first.ownerButtonId, first],
    [second.ownerButtonId, second]
  ]);
  const failure = new Error("locked local package");
  const attempts = [];
  let activeUninstalls = 0;
  let maximumConcurrentUninstalls = 0;

  const failures = await discardStagedButtonInstalls(staged, async (installed) => {
    attempts.push(`start:${installed.ownerButtonId}`);
    activeUninstalls += 1;
    maximumConcurrentUninstalls = Math.max(maximumConcurrentUninstalls, activeUninstalls);
    await Promise.resolve();
    activeUninstalls -= 1;
    attempts.push(`end:${installed.ownerButtonId}`);
    if (installed === second) throw failure;
  });

  assert.deepEqual(attempts, [
    `start:${first.ownerButtonId}`,
    `end:${first.ownerButtonId}`,
    `start:${second.ownerButtonId}`,
    `end:${second.ownerButtonId}`
  ]);
  assert.equal(maximumConcurrentUninstalls, 1);
  assert.deepEqual([...staged.keys()], [second.ownerButtonId]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].installed, second);
  assert.equal(failures[0].error, failure);

  assert.deepEqual(await discardStagedButtonInstalls(staged, async () => {}), []);
  assert.equal(staged.size, 0);
});

test("aspect-ratio lock scales both dimensions from the dominant axis", () => {
  const start = { x: 0, y: 0, width: 120, height: 48 };
  const grown = lockButtonRectAspect(start, 180, 50, 8);
  assert.equal(grown.width, 180);
  assert.equal(grown.height, 72);
  const shrunk = lockButtonRectAspect(start, 118, 24, 8);
  assert.equal(shrunk.height, 24);
  assert.equal(shrunk.width, 60);
  const clamped = lockButtonRectAspect(start, 1, 1, 8);
  assert.equal(clamped.width >= 8 && clamped.height >= 8, true);
});

test("aspect-locked geometry snaps one driving dimension without ratio drift", () => {
  const resolved = resolveAspectLockedButtonGeometry(
    { width: 120, height: 48 },
    { x: 0, y: 0, width: 180, height: 72 },
    {
      surface: { width: 400, height: 240 },
      otherRects: [],
      tolerance: 0,
      gridSize: 8,
      keepInsideSurface: true
    }
  );
  assert.equal(resolved.valid, true);
  assert.equal(resolved.rect.width, 184);
  assert.equal(resolved.rect.height, 73.6);
  assert.equal(resolved.rect.width / resolved.rect.height, 2.5);

  const moved = resolveButtonGeometry(
    { ...resolved.rect, x: 13, y: 13 },
    {
      surface: { width: 400, height: 240 },
      otherRects: [],
      tolerance: 0,
      gridSize: 8,
      keepInsideSurface: true,
      snapSize: false
    }
  );
  assert.equal(moved.rect.width, 184);
  assert.equal(moved.rect.height, 73.6);
  assert.equal(moved.rect.width / moved.rect.height, 2.5);
});

test("skin sizing is uniform by default and stretches only when allowed", () => {
  assert.deepEqual(
    resolveButtonSkinScale(
      { width: 100, height: 50 },
      { width: 200, height: 50 },
      false
    ),
    { scaleX: 1, scaleY: 1 }
  );
  assert.deepEqual(
    resolveButtonSkinScale(
      { width: 100, height: 50 },
      { width: 200, height: 50 },
      true
    ),
    { scaleX: 2, scaleY: 1 }
  );
  assert.deepEqual(
    resolveButtonSkinScale(
      { width: 0, height: 50 },
      { width: 200, height: 50 },
      true
    ),
    { scaleX: 1, scaleY: 1 }
  );
});

test("explicit Button size assignments preserve each sizing rule deterministically", () => {
  assert.equal(buttonPlacementSizingMode({ matchHitboxToSkin: false, allowStretching: false }), "responsive");
  assert.equal(buttonPlacementSizingMode({ matchHitboxToSkin: true, allowStretching: false }), "proportional");
  assert.equal(buttonPlacementSizingMode({ matchHitboxToSkin: true, allowStretching: true }), "stretch");

  assert.deepEqual(
    resolveAssignedButtonDimensions(
      { width: 200, height: 50, sizingMode: "responsive" },
      { width: 100, height: 50 }
    ),
    { width: 200, height: 50 }
  );
  assert.deepEqual(
    resolveAssignedButtonDimensions(
      { width: 200, height: 50, sizingMode: "stretch" },
      { width: 100, height: 50 }
    ),
    { width: 200, height: 50 }
  );
  assert.deepEqual(
    resolveAssignedButtonDimensions(
      { width: 200, height: 50, sizingMode: "proportional" },
      { width: 100, height: 50 }
    ),
    { width: 100, height: 50 }
  );
  assert.deepEqual(
    resolveAssignedButtonDimensions(
      { width: 200, height: 100, sizingMode: "proportional" },
      { width: 100, height: 50 }
    ),
    { width: 200, height: 100 }
  );

  assert.deepEqual(
    buttonPlacementSizingPatch({ width: 200, height: 50, sizingMode: "responsive" }),
    { matchHitboxToSkin: false, allowStretching: false, allowLabelResize: false }
  );
  assert.deepEqual(
    buttonPlacementSizingPatch({ width: 200, height: 50, sizingMode: "proportional" }),
    { matchHitboxToSkin: true, allowStretching: false, allowLabelResize: false }
  );
  assert.deepEqual(
    buttonPlacementSizingPatch({ width: 200, height: 50, sizingMode: "stretch" }),
    { matchHitboxToSkin: true, allowStretching: true, allowLabelResize: false }
  );
});

test("scaled skin measurement removes ancestor scale but retains painted skin scale", () => {
  const ancestorScale = 0.7069;
  const internalSkinScale = 1.4;
  const paintedScale = resolveButtonRenderedCssScale({
    renderedWidth: 100 * ancestorScale * internalSkinScale,
    renderedHeight: 50 * ancestorScale * internalSkinScale,
    layoutWidth: 100,
    layoutHeight: 50,
    fallback: { scaleX: ancestorScale, scaleY: ancestorScale }
  });
  assert.ok(Math.abs(paintedScale.scaleX - ancestorScale * internalSkinScale) < 1e-12);
  assert.ok(Math.abs(paintedScale.scaleY - ancestorScale * internalSkinScale) < 1e-12);
  assert.deepEqual(resolveButtonRenderedCssScale({
    renderedWidth: 20,
    renderedHeight: 200,
    layoutWidth: 100,
    layoutHeight: 20,
    fallback: { scaleX: 1, scaleY: 1 },
    conservativeUniform: true
  }), { scaleX: 10, scaleY: 10 });
  assert.deepEqual(resolveButtonShadowScreenOffsets({
    offsetX: 10,
    offsetY: 0,
    blurExtent: 0,
    spread: 0,
    paintScale: { scaleX: 1, scaleY: 1 },
    conservativeDirections: true
  }), { left: -10, top: -10, right: 10, bottom: 10 });
  const skewBound = resolveButtonRenderedCssScale({
    renderedWidth: 1010,
    renderedHeight: 1,
    layoutWidth: 1000,
    layoutHeight: 1,
    fallback: { scaleX: 1, scaleY: 1 },
    conservativeUniform: true,
    minimumUniformScale: Math.hypot(10, 1)
  });
  assert.ok(skewBound.scaleX > 10 && skewBound.scaleY > 10);
  const skewedShadow = resolveButtonShadowScreenOffsets({
    offsetX: 0,
    offsetY: 10,
    blurExtent: 0,
    spread: 0,
    paintScale: skewBound,
    conservativeDirections: true
  });
  assert.ok(skewedShadow.right > 100 && skewedShadow.bottom > 100);

  const coreRect = {
    left: 100,
    top: 200,
    width: 160 * ancestorScale,
    height: 44 * ancestorScale
  };
  const core = {
    ...coreRect,
    right: coreRect.left + coreRect.width,
    bottom: coreRect.top + coreRect.height
  };
  const shadowScreenExtent = 8 * paintedScale.scaleX;
  const visual = {
    left: core.left - shadowScreenExtent,
    top: core.top - shadowScreenExtent,
    right: core.right + shadowScreenExtent,
    bottom: core.bottom + shadowScreenExtent
  };
  const measurement = normalizeButtonScreenMeasurement({
    coreRect: core,
    visualRect: visual,
    hostScale: { scaleX: ancestorScale, scaleY: ancestorScale }
  });
  assert.ok(Math.abs(measurement.width - 160) < 1e-12);
  assert.ok(Math.abs(measurement.height - 44) < 1e-12);
  for (const edge of Object.values(measurement.visualOverflow)) {
    assert.ok(Math.abs(edge - 8 * internalSkinScale) < 1e-12);
  }
});

test("screen measurement converts non-finite visual edges to finite zero overflow", () => {
  const measurement = normalizeButtonScreenMeasurement({
    coreRect: {
      left: 10,
      top: 20,
      right: 154,
      bottom: 68,
      width: 144,
      height: 48
    },
    visualRect: {
      left: Number.NaN,
      top: Number.NaN,
      right: Number.NaN,
      bottom: Number.NaN
    },
    hostScale: { scaleX: Number.NaN, scaleY: 0 }
  });

  assert.equal(measurement.width, 144);
  assert.equal(measurement.height, 48);
  assert.deepEqual(measurement.visualOverflow, {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  });
  assert.equal(
    Object.values(measurement.visualOverflow).every(Number.isFinite),
    true
  );
});

test("state validation reports malformed skins and all saved Button presentation fields without throwing", () => {
  const document = createButtonStateDocument();
  document.buttons.one = button("one", "single-script", source("Blender", "Tools", "one.py"));
  document.buttons.one.defaultTextFitMode = "compress";
  document.placements.one = {
    id: "one",
    buttonId: "one",
    surfaceId: "surface-button-editor-main",
    x: 8,
    y: 8,
    width: 120,
    height: 40,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "wrap",
    textAlignment: "diagonal",
    textOffsetX: Number.POSITIVE_INFINITY,
    textOffsetY: "down",
    minimumFontSize: 0,
    textSizeOverride: "large",
    allowLabelResize: "yes",
    matchHitboxToSkin: "yes",
    allowStretching: "yes",
    highlightOnHover: "yes",
    resizeAnchor: "center"
  };
  const surface = document.surfaces["surface-button-editor-main"];
  surface.placementIds.push("one");
  surface.name = 42;
  surface.kind = "floating";
  surface.visualOverflowAllowance = -1;
  surface.uniformButtonSize = { width: 0, height: "large" };
  document.skins.malformed = { id: "malformed", name: "Malformed", structure: null };

  let result;
  assert.doesNotThrow(() => { result = validateButtonStateDocument(document); });
  assert.equal(result.structurallyValid, true);
  const paths = new Set(result.issues.map((issue) => issue.path));
  assert.equal(paths.has("buttons.one.defaultTextFitMode"), true);
  assert.equal(paths.has("placements.one.textFitMode"), true);
  assert.equal(paths.has("placements.one.textAlignment"), true);
  assert.equal(paths.has("placements.one.textOffsetX"), true);
  assert.equal(paths.has("placements.one.textOffsetY"), true);
  assert.equal(paths.has("placements.one.minimumFontSize"), true);
  assert.equal(paths.has("placements.one.textSizeOverride"), true);
  assert.equal(paths.has("placements.one.allowLabelResize"), true);
  assert.equal(paths.has("placements.one.matchHitboxToSkin"), true);
  assert.equal(paths.has("placements.one.allowStretching"), true);
  assert.equal(paths.has("placements.one.highlightOnHover"), true);
  assert.equal(paths.has("placements.one.resizeAnchor"), true);
  assert.equal(paths.has("surfaces.surface-button-editor-main.name"), true);
  assert.equal(paths.has("surfaces.surface-button-editor-main.kind"), true);
  assert.equal(paths.has("surfaces.surface-button-editor-main.visualOverflowAllowance"), true);
  assert.equal(paths.has("surfaces.surface-button-editor-main.uniformButtonSize"), true);
  assert.equal(paths.has("skins.malformed"), true);
});

test("uniform surface sizing validates one fixed policy and disabling it preserves geometry", () => {
  const document = createButtonStateDocument();
  const records = [
    button("uniform-a", "single-script", source("Blender", "Tools", "uniform-a.py")),
    button("uniform-b", "single-script", source("Blender", "Tools", "uniform-b.py"))
  ];
  records.forEach((record) => { document.buttons[record.id] = record; });
  const popout = ensureRegularPopout(document, records);
  const surface = document.surfaces[popout.surfaceId];
  surface.uniformButtonSize = { width: 160, height: 44 };
  popout.memberPlacementIds.forEach((placementId, index) => {
    Object.assign(document.placements[placementId], {
      x: index * 160,
      y: 0,
      width: 160,
      height: 44,
      matchHitboxToSkin: false,
      allowLabelResize: false
    });
  });

  assert.equal(validateButtonStateDocument(document).valid, true);
  const geometryBeforeDisable = popout.memberPlacementIds.map((placementId) => ({
    ...document.placements[placementId]
  }));
  surface.uniformButtonSize = null;
  assert.equal(validateButtonStateDocument(document).valid, true);
  assert.deepEqual(
    popout.memberPlacementIds.map((placementId) => document.placements[placementId]),
    geometryBeforeDisable
  );

  surface.uniformButtonSize = { width: 160, height: 44 };
  document.placements[popout.memberPlacementIds[1]].width = 140;
  const invalid = validateButtonStateDocument(document);
  assert.equal(invalid.valid, false);
  assert.equal(
    invalid.issues.some((issue) => issue.path === `surfaces.${surface.id}.uniformButtonSize`),
    true
  );
});

test("source updates preserve Button identities and presentation while refreshing runtime targets", () => {
  const document = createButtonStateDocument();
  const singleIdentity = source("Windows", "Files", "single.flowcell-source.json");
  document.buttons.single = button("single", "single-script", singleIdentity);
  document.buttons.single.label = "My Custom Label";
  const updatedIdentity = source("Windows", "Files", "single.flowcell-source.json");
  applyInstalledSourceUpdate(document, {
    ownerButtonId: "single",
    sourceIdentity: updatedIdentity,
    executionTarget: {
      kind: "core-action",
      actionId: "open-window-grid",
      payload: { ownerButtonId: "single" }
    },
    label: "Manifest Label",
    tooltip: "Manifest tooltip",
    children: []
  });
  assert.equal(document.buttons.single.label, "My Custom Label");
  assert.equal(document.buttons.single.sourceIdentity, updatedIdentity);
  assert.equal(document.buttons.single.executionTarget.actionId, "open-window-grid");

  const ownerIdentity = source("Blender", "Tools", "owner.flowcell-source.json");
  document.buttons.owner = button("owner", "tool-set-owner", ownerIdentity);
  document.buttons.first = {
    ...button("first", "tool-set-child"),
    toolSetParentId: "owner",
    label: "Custom First",
    executionTarget: {
      kind: "tool-set-action",
      programName: "Blender",
      panelName: "Tools",
      ownerFileName: "owner.flowcell-source.json",
      command: "first"
    }
  };
  document.buttons.second = {
    ...button("second", "tool-set-child"),
    toolSetParentId: "owner",
    executionTarget: {
      kind: "tool-set-action",
      programName: "Blender",
      panelName: "Tools",
      ownerFileName: "owner.flowcell-source.json",
      command: "second"
    }
  };
  document.popoutUnits.tools = {
    id: "tools",
    name: "Tools",
    kind: "tool-set",
    surfaceId: "surface-tools",
    canonicalBounds: { x: 0, y: 0, width: 300, height: 200 },
    desktopBounds: null,
    childPlacementIds: [],
    openRule: "toggle",
    closeRule: "toggle",
    transparency: 1,
    pinnedDefault: false,
    ownerButtonId: "owner",
    childButtonIds: ["first", "second"],
    fields: []
  };
  applyInstalledSourceUpdate(document, {
    ownerButtonId: "owner",
    sourceIdentity: ownerIdentity,
    executionTarget: null,
    label: "Updated Tools",
    tooltip: "Updated",
    children: [
      {
        slot: "second",
        label: "Second Updated",
        executionTarget: {
          kind: "tool-set-action",
          programName: "Blender",
          panelName: "Tools",
          ownerFileName: "owner.flowcell-source.json",
          command: "second",
          payload: { version: 2 }
        }
      },
      {
        slot: "first",
        label: "First Updated",
        executionTarget: {
          kind: "tool-set-action",
          programName: "Blender",
          panelName: "Tools",
          ownerFileName: "owner.flowcell-source.json",
          command: "first",
          payload: { version: 2 }
        }
      }
    ],
    layout: {
      fields: [{
        id: "amount",
        label: "Amount",
        kind: "number",
        payloadKey: "amount",
        x: 0,
        y: 0,
        width: 100,
        height: 24,
        zIndex: 0,
        defaultValue: 1
      }],
      childBehaviors: {
        first: { execute: false }
      }
    }
  });
  assert.equal(document.buttons.first.label, "Custom First");
  assert.equal(document.buttons.first.executionTarget.payload.version, 2);
  assert.equal(document.buttons.second.executionTarget.payload.version, 2);
  assert.equal(document.buttons.first.toolSetBehavior.execute, false);
  assert.equal(document.popoutUnits.tools.fields[0].id, "amount");
  assert.throws(() => applyInstalledSourceUpdate(document, {
    ownerButtonId: "owner",
    sourceIdentity: ownerIdentity,
    executionTarget: null,
    label: "Broken",
    tooltip: "",
    children: [{
      slot: "renamed",
      label: "Renamed",
      executionTarget: {
        kind: "tool-set-action",
        programName: "Blender",
        panelName: "Tools",
        ownerFileName: "owner.flowcell-source.json",
        command: "renamed"
      }
    }]
  }), /cannot add, remove, or rename/);
});

test("installed-page lifecycle closes only removed owner identities", () => {
  const previous = createButtonStateDocument();
  previous.buttons.page = {
    ...button("page", "single-script", source("Example", "Tools", "page.flowcell-source.json")),
    executionTarget: {
      kind: "core-action",
      actionId: "open-installed-page",
      payload: {
        ownerButtonId: "page",
        programName: "Example",
        panelName: "Tools",
        fileName: "page.flowcell-source.json",
        pageId: "example.page"
      }
    }
  };
  previous.buttons.shared = {
    ...button("shared", "single-script", source("Windows", "Utilities", "shared.flowcell-source.json")),
    executionTarget: {
      kind: "core-action",
      actionId: "open-installed-page",
      payload: {
        ownerButtonId: "shared",
        programName: "Windows",
        panelName: "Utilities",
        fileName: "shared.flowcell-source.json",
        pageId: "shared.page"
      }
    }
  };

  const next = structuredClone(previous);
  delete next.buttons.page;

  assert.deepEqual(removedInstalledPageOwnerIds(previous, next), ["page"]);
});

test("installed-page lifecycle finds owner identities in a program or panel scope", () => {
  const document = createButtonStateDocument();
  document.buttons.page = {
    ...button("page", "single-script", source("Example", "Tools", "page.flowcell-source.json")),
    executionTarget: {
      kind: "core-action",
      actionId: "open-installed-page",
      payload: {
        ownerButtonId: "page",
        fileName: "page.flowcell-source.json",
        pageId: "example.page"
      }
    }
  };
  document.buttons.other = {
    ...button("other", "single-script", source("Example", "Other", "other.flowcell-source.json")),
    executionTarget: {
      kind: "core-action",
      actionId: "open-installed-page",
      payload: {
        ownerButtonId: "other",
        fileName: "other.flowcell-source.json",
        pageId: "other.page"
      }
    }
  };

  assert.deepEqual(scopedInstalledPageOwnerIds(document, "example", "tools"), ["page"]);
  assert.equal(scopedInstalledPageOwnerIds(document, "Example").length, 2);
});

test("installed-page lifecycle closes an existing owner window when its page contract changes", () => {
  const previous = createButtonStateDocument();
  previous.buttons.page = {
    ...button("page", "single-script", source("Example", "Tools", "page.flowcell-source.json")),
    executionTarget: {
      kind: "core-action",
      actionId: "open-installed-page",
      payload: {
        ownerButtonId: "page",
        programName: "Example",
        panelName: "Tools",
        fileName: "page.flowcell-source.json",
        pageId: "example.page"
      }
    }
  };
  const next = structuredClone(previous);
  next.buttons.page.executionTarget.payload.pageId = "example.page.v2";

  assert.deepEqual(removedInstalledPageOwnerIds(previous, next), ["page"]);
});

test("source updates recover deterministic tool-set slots before applying core actions", () => {
  const document = createButtonStateDocument();
  const ownerId = "existing-tool-owner";
  const ownerIdentity = source("Example", "Tools", "existing-tool-owner.flowcell-source.json");
  const stableSegment = (value) => Array.from(value.trim().toLocaleLowerCase())
    .map((character) => character.codePointAt(0)?.toString(16) ?? "0")
    .join("-") || "item";
  const slots = ["browse_item", "apply_item"];
  const childIds = slots.map((slot, index) =>
    `button-child-${ownerId}-${stableSegment(slot)}-${index}`
  );

  document.buttons[ownerId] = button(ownerId, "tool-set-owner", ownerIdentity);
  childIds.forEach((childId, index) => {
    document.buttons[childId] = {
      ...button(childId, "tool-set-child"),
      toolSetParentId: ownerId,
      executionTarget: {
        kind: "core-action",
        actionId: "open-window-grid"
      }
    };
  });
  document.popoutUnits.tools = {
    id: "tools",
    name: "Tools",
    kind: "tool-set",
    surfaceId: "surface-tools",
    canonicalBounds: { x: 0, y: 0, width: 300, height: 200 },
    desktopBounds: null,
    childPlacementIds: [],
    openRule: "toggle",
    closeRule: "toggle",
    transparency: 1,
    pinnedDefault: false,
    ownerButtonId: ownerId,
    childButtonIds: childIds,
    fields: []
  };
  const update = {
    ownerButtonId: ownerId,
    sourceIdentity: ownerIdentity,
    executionTarget: null,
    label: "Tools",
    tooltip: "",
    children: slots.map((slot) => ({
      slot,
      label: slot,
      executionTarget: {
        kind: "core-action",
        actionId: "open-window-grid",
        payload: { slot }
      }
    })),
    layout: {
      childBehaviors: {
        browse_item: { execute: false },
        apply_item: { execute: true }
      }
    }
  };

  applyInstalledSourceUpdate(document, update);
  assert.equal(document.buttons[childIds[0]].metadata.toolSetSlot, "browse_item");
  assert.equal(document.buttons[childIds[1]].metadata.toolSetSlot, "apply_item");

  assert.doesNotThrow(() => applyInstalledSourceUpdate(document, update));
});

test("opt-in source updates append child slots without replacing existing Button identities", () => {
  const document = createButtonStateDocument();
  const ownerId = "tools-owner";
  const ownerIdentity = source("Example", "Tools", "tools.flowcell-source.json");
  document.buttons[ownerId] = button(ownerId, "tool-set-owner", ownerIdentity);
  document.buttons.existing = {
    ...button("existing", "tool-set-child"),
    toolSetParentId: ownerId,
    metadata: { toolSetSlot: "existing" },
    executionTarget: { kind: "core-action", actionId: "open-window-grid" }
  };
  document.surfaces["surface-tools"] = {
    id: "surface-tools",
    name: "Tools",
    kind: "tool-set-popout",
    width: 240,
    height: 120,
    placementIds: ["placement-existing"],
    visualOverflowAllowance: 24
  };
  document.placements["placement-existing"] = {
    id: "placement-existing",
    buttonId: "existing",
    surfaceId: "surface-tools",
    x: 7,
    y: 9,
    width: 111,
    height: 37,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink",
    textAlignment: "skin",
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    resizeAnchor: "top-left"
  };
  document.popoutUnits.tools = {
    id: "tools",
    name: "Tools",
    kind: "tool-set",
    surfaceId: "surface-tools",
    canonicalBounds: { x: 0, y: 0, width: 240, height: 120 },
    desktopBounds: null,
    childPlacementIds: ["placement-existing"],
    openRule: "toggle",
    closeRule: "toggle",
    transparency: 1,
    pinnedDefault: false,
    ownerButtonId: ownerId,
    childButtonIds: ["existing"],
    fields: []
  };

  applyInstalledSourceUpdate(document, {
    ownerButtonId: ownerId,
    sourceIdentity: ownerIdentity,
    executionTarget: null,
    label: "Tools",
    tooltip: "",
    children: [
      {
        slot: "existing",
        label: "Existing changed by manifest",
        executionTarget: { kind: "core-action", actionId: "open-window-grid", payload: { version: 2 } }
      },
      {
        slot: "save_package",
        label: "Save package",
        executionTarget: { kind: "core-action", actionId: "save-tool-package" }
      }
    ],
    layout: { updatePolicy: { appendMissingChildSlots: true } }
  });

  const appendedId = document.popoutUnits.tools.childButtonIds[1];
  assert.equal(document.popoutUnits.tools.childButtonIds[0], "existing");
  assert.equal(document.buttons.existing.label, "existing");
  assert.equal(document.placements["placement-existing"].x, 7);
  assert.equal(document.buttons[appendedId].metadata.toolSetSlot, "save_package");
  assert.equal(document.buttons[appendedId].executionTarget.actionId, "save-tool-package");
  assert.equal(document.popoutUnits.tools.childPlacementIds[1], `placement-${appendedId}`);
});

test("bundled source reconciliation repairs current owners and materializes missing required owners", () => {
  const document = createButtonStateDocument();
  document.buttons.existing = button(
    "existing",
    "single-script",
    source("Illustrator", "Layers Builder", "archive.flowcell-source.json")
  );
  document.buttons.existing.label = "My Archive";

  const reconciled = reconcileBundledProgramSources(document, [
    {
      ownerButtonId: "existing",
      sourceIdentity: {
        programName: "Illustrator",
        panelName: "Layers Builder",
        fileName: "archive.flowcell-source.json"
      },
      owner: {
        label: "archive",
        tooltip: "",
        executionTarget: {
          kind: "program-action",
          programName: "Illustrator",
          actionId: "run-installed-source",
          payload: { ownerButtonId: "existing", version: 2 }
        }
      },
      children: []
    },
    {
      ownerButtonId: "bundled-example-page",
      sourceIdentity: {
        programName: "Example",
        panelName: "Tools",
        fileName: "page.flowcell-source.json"
      },
      owner: {
        label: "Example Page",
        tooltip: "Open the installed page.",
        executionTarget: {
          kind: "core-action",
          actionId: "open-installed-page",
          payload: {
            ownerButtonId: "bundled-example-page",
            programName: "Example",
            panelName: "Tools",
            fileName: "page.flowcell-source.json",
            pageId: "example.page"
          }
        }
      },
      children: []
    }
  ]);

  assert.equal(reconciled.buttons.existing.label, "My Archive");
  assert.equal(reconciled.buttons.existing.executionTarget.payload.version, 2);
  assert.equal(reconciled.buttons["bundled-example-page"].label, "Example Page");
  assert.equal(
    reconciled.buttons["bundled-example-page"].executionTarget.actionId,
    "open-installed-page"
  );
  assert.ok(reconciled.placements["placement-bundled-example-page"]);
});

test("bundled source migration places missing owners around existing panel Buttons", () => {
  const document = createButtonStateDocument();
  const panelId = "surface-panel-65-78-61-6d-70-6c-65-74-6f-6f-6c-73";
  document.buttons.blocker = button(
    "blocker",
    "single-script",
    source("Example", "Tools", "blocker.flowcell-source.json")
  );
  document.surfaces[panelId] = {
    id: panelId,
    name: "Example / Tools",
    kind: "panel",
    width: 960,
    height: 640,
    placementIds: ["placement-blocker"],
    visualOverflowAllowance: 24
  };
  document.placements["placement-blocker"] = {
    id: "placement-blocker",
    buttonId: "blocker",
    surfaceId: panelId,
    x: 8,
    y: 8,
    width: 496,
    height: 44,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink",
    textAlignment: "skin",
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    resizeAnchor: "top-left"
  };
  const pageDescriptor = (ownerButtonId, pageId) => ({
    ownerButtonId,
    sourceIdentity: {
      programName: "Example",
      panelName: "Tools",
      fileName: `${ownerButtonId}.flowcell-source.json`
    },
    owner: {
      label: ownerButtonId,
      tooltip: "",
      executionTarget: {
        kind: "core-action",
        actionId: "open-installed-page",
        payload: {
          ownerButtonId,
          programName: "Example",
          panelName: "Tools",
          fileName: `${ownerButtonId}.flowcell-source.json`,
          pageId
        }
      }
    },
    children: []
  });

  const reconciled = reconcileBundledProgramSources(document, [
    pageDescriptor("page-one", "example.one"),
    pageDescriptor("page-two", "example.two")
  ]);
  const placements = [
    reconciled.placements["placement-blocker"],
    reconciled.placements["placement-page-one"],
    reconciled.placements["placement-page-two"]
  ];
  assert.equal(placements.every(Boolean), true);
  for (let left = 0; left < placements.length; left += 1) {
    for (let right = left + 1; right < placements.length; right += 1) {
      assert.equal(buttonRectsOverlap(placements[left], placements[right]), false);
    }
  }
});

test("Button document equality ignores JSON object insertion order but detects value changes", () => {
  const document = createButtonStateDocument();
  document.buttons.one = button(
    "one",
    "single-script",
    source("Windows", "Files", "one.flowcell-source.json")
  );
  const reordered = structuredClone(document);
  reordered.buttons.one.sourceIdentity = Object.fromEntries(
    Object.entries(reordered.buttons.one.sourceIdentity).reverse()
  );

  assert.equal(buttonStateDocumentsEqual(document, reordered), true);
  reordered.buttons.one.label = "Changed";
  assert.equal(buttonStateDocumentsEqual(document, reordered), false);
});

test("tool-set imports reject exact child placements outside their surface or overlapping", () => {
  assert.deepEqual(validateExactButtonLayoutGeometry([
    { id: "one", rect: { x: 8, y: 8, width: 40, height: 24 } },
    { id: "two", rect: { x: 56, y: 8, width: 40, height: 24 } }
  ], { width: 104, height: 40 }), []);

  const outside = validateExactButtonLayoutGeometry([
    { id: "outside", rect: { x: 80, y: 8, width: 40, height: 24 } }
  ], { width: 104, height: 40 });
  assert.match(outside[0].message, /outside/);

  const overlap = validateExactButtonLayoutGeometry([
    { id: "one", rect: { x: 8, y: 8, width: 40, height: 24 } },
    { id: "two", rect: { x: 32, y: 8, width: 40, height: 24 } }
  ], { width: 104, height: 40 });
  assert.deepEqual(overlap[0].placementIds, ["one", "two"]);
  assert.match(overlap[0].message, /overlap/);
});

test("Button reorder inserts before or after a target without mutating the saved order", () => {
  const original = ["a", "b", "c", "d"];
  assert.deepEqual(
    reorderButtonPlacementIds(original, "a", "c", "after"),
    ["b", "c", "a", "d"]
  );
  assert.deepEqual(
    reorderButtonPlacementIds(original, "d", "b", "before"),
    ["a", "d", "b", "c"]
  );
  assert.deepEqual(reorderButtonPlacementIds(original, "a", "a", "before"), original);
  assert.deepEqual(reorderButtonPlacementIds(original, "missing", "b", "after"), original);
  assert.deepEqual(reorderButtonPlacementIds(original, "a", "missing", "after"), original);
  assert.deepEqual(original, ["a", "b", "c", "d"]);
});

test("top-left compaction closes gaps, wraps by row height, and preserves Button sizes", () => {
  const input = [
    { id: "a", rect: { x: 72, y: 40, width: 50, height: 20 } },
    { id: "b", rect: { x: 8, y: 8, width: 40, height: 30 } },
    { id: "c", rect: { x: 160, y: 80, width: 60, height: 10 } }
  ];
  const original = structuredClone(input);
  const result = compactButtonPlacements(input, { width: 120, height: 100 });
  assert.equal(result.success, true);
  assert.equal(result.requiredWidth, 90);
  assert.equal(result.requiredHeight, 40);
  assert.deepEqual(result.placements, [
    { id: "a", rect: { x: 0, y: 0, width: 50, height: 20 }, zIndex: 0 },
    { id: "b", rect: { x: 50, y: 0, width: 40, height: 30 }, zIndex: 1 },
    { id: "c", rect: { x: 0, y: 30, width: 60, height: 10 }, zIndex: 2 }
  ]);
  assert.deepEqual(input, original);
  assert.deepEqual(
    validateExactButtonLayoutGeometry(result.placements, { width: 120, height: 100 }),
    []
  );
});

test("uniform Button compaction applies one size atomically without mutating inputs", () => {
  const input = [
    { id: "a", rect: { x: 4, y: 7, width: 20, height: 10 } },
    { id: "b", rect: { x: 30, y: 7, width: 35, height: 15 } },
    { id: "c", rect: { x: 70, y: 24, width: 25, height: 12 } }
  ];
  const original = structuredClone(input);
  const result = compactUniformButtonPlacements(
    input,
    { width: 40, height: 20 },
    { width: 100, height: 40 },
    { gap: 0 }
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.placements, [
    { id: "a", rect: { x: 0, y: 0, width: 40, height: 20 }, zIndex: 0 },
    { id: "b", rect: { x: 40, y: 0, width: 40, height: 20 }, zIndex: 1 },
    { id: "c", rect: { x: 0, y: 20, width: 40, height: 20 }, zIndex: 2 }
  ]);
  assert.deepEqual(input, original);
  assert.deepEqual(
    validateExactButtonLayoutGeometry(result.placements, { width: 100, height: 40 }),
    []
  );

  const failed = compactUniformButtonPlacements(
    input,
    { width: 60, height: 30 },
    { width: 100, height: 40 }
  );
  assert.equal(failed.success, false);
  assert.deepEqual(failed.placements, []);
  assert.deepEqual(input, original);
});

test("uniform Button compaction preserves existing row membership", () => {
  const input = [
    { id: "a", rect: { x: 0, y: 0, width: 20, height: 10 } },
    { id: "b", rect: { x: 20, y: 0, width: 20, height: 10 } },
    { id: "c", rect: { x: 0, y: 30, width: 20, height: 10 } },
    { id: "d", rect: { x: 20, y: 30, width: 20, height: 10 } }
  ];

  const result = compactUniformButtonPlacements(
    input,
    { width: 30, height: 15 },
    { width: 120, height: 60 },
    { gap: 0 }
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.placements, [
    { id: "a", rect: { x: 0, y: 0, width: 30, height: 15 }, zIndex: 0 },
    { id: "b", rect: { x: 30, y: 0, width: 30, height: 15 }, zIndex: 1 },
    { id: "c", rect: { x: 0, y: 30, width: 30, height: 15 }, zIndex: 2 },
    { id: "d", rect: { x: 30, y: 30, width: 30, height: 15 }, zIndex: 3 }
  ]);
});

test("reordered compaction normalizes z-index and fails atomically when it cannot fit", () => {
  const placements = {
    a: { id: "a", rect: { x: 0, y: 0, width: 50, height: 20 } },
    b: { id: "b", rect: { x: 50, y: 0, width: 40, height: 30 } },
    c: { id: "c", rect: { x: 0, y: 30, width: 60, height: 10 } }
  };
  const order = reorderButtonPlacementIds(["a", "b", "c"], "c", "b", "before");
  const result = compactButtonPlacements(order.map((id) => placements[id]), {
    width: 120,
    height: 100
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.placements.map((item) => [item.id, item.zIndex]), [
    ["a", 0],
    ["c", 1],
    ["b", 2]
  ]);
  assert.deepEqual(
    validateExactButtonLayoutGeometry(result.placements, { width: 120, height: 100 }),
    []
  );

  const failed = compactButtonPlacements([
    { id: "too-wide", rect: { x: 0, y: 0, width: 121, height: 20 } }
  ], { width: 120, height: 100 });
  assert.equal(failed.success, false);
  assert.deepEqual(failed.placements, []);
  assert.match(failed.reason, /wider/);
});

test("reorder compaction preserves every existing row as a reachable drop target", () => {
  const input = Array.from({ length: 7 }, (_, index) => ({
    id: String.fromCharCode(97 + index),
    rect: {
      x: 199.23,
      y: 125.759 + 49.727 * index,
      width: 131.568,
      height: 37.295
    }
  }));
  const rowProfile = inferButtonPlacementRowProfile(input);
  assert.equal(rowProfile.wrapWidth.toFixed(3), "131.568");
  assert.deepEqual(
    rowProfile.topOffsets.map((value) => value.toFixed(3)),
    ["0.000", "49.727", "99.454", "149.181", "198.908", "248.635", "298.362"]
  );

  const remainingIds = input.map((item) => item.id).filter((id) => id !== "a");
  const slots = [];
  for (let insertionIndex = 0; insertionIndex <= remainingIds.length; insertionIndex += 1) {
    const order = [...remainingIds];
    order.splice(insertionIndex, 0, "a");
    const result = compactButtonPlacements(
      order.map((id) => input.find((item) => item.id === id)),
      { width: 1225, height: 721 },
      {
        anchorX: 199.23,
        anchorY: 125.759,
        gap: 0,
        rowProfile
      }
    );
    assert.equal(result.success, true);
    slots.push(result.placements.find((item) => item.id === "a").rect);
  }
  assert.equal(new Set(slots.map((slot) => slot.y.toFixed(3))).size, 7);
  input.forEach((item, expectedInsertionIndex) => {
    const pointerX = item.rect.x + item.rect.width / 2;
    const pointerY = item.rect.y + item.rect.height / 2;
    const closestInsertionIndex = slots
      .map((slot, insertionIndex) => ({
        insertionIndex,
        distance: Math.hypot(
          pointerX - (slot.x + slot.width / 2),
          pointerY - (slot.y + slot.height / 2)
        )
      }))
      .sort((left, right) =>
        left.distance - right.distance ||
        left.insertionIndex - right.insertionIndex
      )[0].insertionIndex;
    assert.equal(closestInsertionIndex, expectedInsertionIndex);
  });
});

test("row inference groups mixed heights and rebalances variable-width Buttons", () => {
  const input = [
    { id: "a", rect: { x: 0, y: 48, width: 40, height: 44 } },
    { id: "b", rect: { x: 48, y: 56, width: 40, height: 20 } },
    { id: "c", rect: { x: 0, y: 100, width: 40, height: 30 } },
    { id: "d", rect: { x: 48, y: 104, width: 40, height: 10 } }
  ];
  const rowProfile = inferButtonPlacementRowProfile(input);
  assert.deepEqual(rowProfile, {
    wrapWidth: 80,
    topOffsets: [0, 52]
  });
  const compacted = compactButtonPlacements(input, { width: 200, height: 100 }, {
    gap: 0,
    rowProfile
  });
  assert.equal(compacted.success, true);
  assert.deepEqual(compacted.placements.map((item) => item.rect.y), [0, 0, 52, 52]);

  const invalidProfile = compactButtonPlacements(input, { width: 200, height: 100 }, {
    rowProfile: { wrapWidth: 0, topOffsets: [0] }
  });
  assert.equal(invalidProfile.success, false);
  assert.deepEqual(invalidProfile.placements, []);

  const variableWidthInput = [
    { id: "a", rect: { x: 0, y: 0, width: 50, height: 20 } },
    { id: "b", rect: { x: 50, y: 0, width: 30, height: 20 } },
    { id: "c", rect: { x: 0, y: 30, width: 20, height: 20 } },
    { id: "d", rect: { x: 20, y: 30, width: 60, height: 20 } }
  ];
  const variableProfile = inferButtonPlacementRowProfile(variableWidthInput);
  const rebalanced = compactButtonPlacements(
    ["b", "c", "a", "d"].map((id) =>
      variableWidthInput.find((item) => item.id === id)
    ),
    { width: 100, height: 100 },
    { rowProfile: variableProfile }
  );
  assert.equal(rebalanced.success, true);
  assert.equal(rebalanced.placements.find((item) => item.id === "a").rect.y, 30);
  assert.equal(rebalanced.placements.find((item) => item.id === "d").rect.y, 50);
  assert.deepEqual(
    validateExactButtonLayoutGeometry(rebalanced.placements, { width: 100, height: 100 }),
    []
  );

  const underfilledRows = [
    { id: "wide", rect: { x: 0, y: 0, width: 100, height: 20 } },
    { id: "narrow-a", rect: { x: 0, y: 40, width: 10, height: 20 } },
    { id: "narrow-b", rect: { x: 0, y: 80, width: 10, height: 20 } }
  ];
  const underfilledProfile = inferButtonPlacementRowProfile(underfilledRows);
  assert.deepEqual(underfilledProfile, {
    wrapWidth: 100,
    topOffsets: [0, 40, 80]
  });
  const preservedUnderfilledRows = compactButtonPlacements(
    underfilledRows,
    { width: 200, height: 120 },
    { rowProfile: underfilledProfile }
  );
  assert.equal(preservedUnderfilledRows.success, true);
  assert.deepEqual(
    preservedUnderfilledRows.placements.map((item) => item.rect.y),
    [0, 40, 80]
  );
});

test("explicit-row snap left-packs and moves rows up without changing row membership", () => {
  const input = [
    { id: "a", rect: { x: 40, y: 10, width: 50, height: 20 } },
    { id: "b", rect: { x: 120, y: 10, width: 30, height: 30 } },
    { id: "c", rect: { x: 30, y: 60, width: 40, height: 10 } },
    { id: "d", rect: { x: 100, y: 60, width: 60, height: 25 } },
    { id: "e", rect: { x: 190, y: 60, width: 20, height: 15 } },
    { id: "f", rect: { x: 80, y: 100, width: 70, height: 12 } }
  ];
  const original = structuredClone(input);
  const rows = inferButtonPlacementRows(input);
  assert.deepEqual(rows.map((row) => row.placements.map((placement) => placement.id)), [
    ["a", "b"],
    ["c", "d", "e"],
    ["f"]
  ]);
  const result = compactButtonPlacementRows(rows, { width: 240, height: 120 }, {
    gap: 0,
    preserveRowTopOffsets: false
  });
  assert.equal(result.success, true);
  assert.equal(result.requiredWidth, 120);
  assert.equal(result.requiredHeight, 67);
  assert.deepEqual(result.placements, [
    { id: "a", rect: { x: 0, y: 0, width: 50, height: 20 }, zIndex: 0 },
    { id: "b", rect: { x: 50, y: 0, width: 30, height: 30 }, zIndex: 1 },
    { id: "c", rect: { x: 0, y: 30, width: 40, height: 10 }, zIndex: 2 },
    { id: "d", rect: { x: 40, y: 30, width: 60, height: 25 }, zIndex: 3 },
    { id: "e", rect: { x: 100, y: 30, width: 20, height: 15 }, zIndex: 4 },
    { id: "f", rect: { x: 0, y: 55, width: 70, height: 12 }, zIndex: 5 }
  ]);
  assert.deepEqual(input, original);
  assert.deepEqual(
    validateExactButtonLayoutGeometry(result.placements, { width: 240, height: 120 }),
    []
  );
});

test("row-aware reorder exposes every row slot and an explicit new-row target", () => {
  const input = [
    { id: "a", rect: { x: 0, y: 0, width: 30, height: 10 } },
    { id: "b", rect: { x: 30, y: 0, width: 40, height: 20 } },
    { id: "c", rect: { x: 0, y: 20, width: 20, height: 15 } },
    { id: "d", rect: { x: 20, y: 20, width: 50, height: 12 } },
    { id: "e", rect: { x: 0, y: 35, width: 35, height: 18 } }
  ];
  const result = buildButtonReorderRowCandidates({
    placements: input,
    movingPlacementId: "a",
    movingRect: input[0].rect,
    surface: { width: 240, height: 100 },
    gap: 0
  });
  assert.equal(result.reason, null);
  const existing = result.candidates.filter((candidate) => candidate.kind === "existing-row");
  assert.deepEqual(
    existing.map((candidate) => [candidate.rowIndex, candidate.columnIndex]),
    [[0, 0], [0, 1], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1]]
  );
  assert.equal(new Set(existing.map((candidate) => candidate.key)).size, 7);

  const newBottomRow = result.candidates.find((candidate) =>
    candidate.kind === "new-row" && candidate.rowIndex === 3
  );
  assert.ok(newBottomRow);
  assert.deepEqual(newBottomRow.orderedPlacementIds, ["b", "c", "d", "e", "a"]);
  assert.deepEqual(newBottomRow.placements, [
    { id: "b", rect: { x: 0, y: 0, width: 40, height: 20 }, zIndex: 0 },
    { id: "c", rect: { x: 0, y: 20, width: 20, height: 15 }, zIndex: 1 },
    { id: "d", rect: { x: 20, y: 20, width: 50, height: 12 }, zIndex: 2 },
    { id: "e", rect: { x: 0, y: 35, width: 35, height: 18 }, zIndex: 3 },
    { id: "a", rect: { x: 0, y: 53, width: 30, height: 10 }, zIndex: 4 }
  ]);
  assert.deepEqual(
    validateExactButtonLayoutGeometry(newBottomRow.placements, { width: 240, height: 100 }),
    []
  );
});

test("row-aware reorder chooser reaches every thin existing row despite hysteresis", () => {
  const input = [
    { id: "a", rect: { x: 0, y: 0, width: 20, height: 8 } },
    { id: "b", rect: { x: 20, y: 0, width: 20, height: 8 } },
    { id: "c", rect: { x: 0, y: 8, width: 20, height: 8 } },
    { id: "d", rect: { x: 0, y: 16, width: 20, height: 8 } }
  ];
  let currentKey = null;
  const reachedRows = new Set();
  for (let y = -12; y <= 40; y += 0.25) {
    const result = buildButtonReorderRowCandidates({
      placements: input,
      movingPlacementId: "a",
      movingRect: { x: 0, y, width: 20, height: 8 },
      surface: { width: 100, height: 60 },
      gap: 0
    });
    const chosen = chooseButtonReorderRowCandidate(result.candidates, currentKey, 12);
    assert.ok(chosen);
    currentKey = chosen.key;
    if (chosen.kind === "existing-row") reachedRows.add(chosen.rowIndex);
  }
  assert.deepEqual([...reachedRows], [0, 1, 2]);
});

test("row-aware reorder chooser reaches every existing row and new-row boundary", () => {
  const input = [
    { id: "a", rect: { x: 0, y: 0, width: 30, height: 10 } },
    { id: "b", rect: { x: 30, y: 0, width: 40, height: 20 } },
    { id: "c", rect: { x: 0, y: 20, width: 20, height: 15 } },
    { id: "d", rect: { x: 20, y: 20, width: 50, height: 12 } },
    { id: "e", rect: { x: 0, y: 35, width: 35, height: 18 } }
  ];
  let currentKey = null;
  const reachedLanes = [];
  for (let y = -20; y <= 90; y += 0.25) {
    const result = buildButtonReorderRowCandidates({
      placements: input,
      movingPlacementId: "a",
      movingRect: { x: 0, y, width: 30, height: 10 },
      surface: { width: 240, height: 100 },
      gap: 0
    });
    const chosen = chooseButtonReorderRowCandidate(result.candidates, currentKey, 12);
    assert.ok(chosen);
    currentKey = chosen.key;
    const lane = `${chosen.kind}:${chosen.rowIndex}`;
    if (reachedLanes.at(-1) !== lane) reachedLanes.push(lane);
  }
  assert.deepEqual(reachedLanes, [
    "new-row:0",
    "existing-row:0",
    "new-row:1",
    "existing-row:1",
    "new-row:2",
    "existing-row:2",
    "new-row:3"
  ]);
});

test("explicit rows fail atomically instead of rebalancing an over-wide row", () => {
  const rows = [{
    placements: [
      { id: "a", rect: { x: 0, y: 0, width: 70, height: 20 } },
      { id: "b", rect: { x: 70, y: 0, width: 50, height: 20 } }
    ],
    topOffset: 0
  }];
  const result = compactButtonPlacementRows(rows, { width: 100, height: 100 });
  assert.equal(result.success, false);
  assert.deepEqual(result.placements, []);
  assert.match(result.reason, /row 1 is wider/i);
});

test("snapping aligns edges and collision prevention rejects overlap", () => {
  const snapped = resolveButtonGeometry(
    { x: 3, y: 4, width: 40, height: 24 },
    { surface: { width: 200, height: 100 }, otherRects: [], tolerance: 8, gridSize: 1 }
  );
  assert.equal(snapped.valid, true);
  assert.equal(snapped.rect.x, 0);
  assert.equal(snapped.rect.y, 0);

  const blocked = resolveButtonGeometry(
    { x: 12, y: 10, width: 40, height: 24 },
    { surface: { width: 100, height: 60 }, otherRects: [{ x: 10, y: 10, width: 40, height: 24 }], tolerance: 0, gridSize: 1 }
  );
  assert.equal(blocked.valid, false);
  assert.equal(buttonRectsOverlap(blocked.rect, { x: 10, y: 10, width: 40, height: 24 }), true);
});

test("continuous drag samples stop flush instead of skipping the snap band", () => {
  const options = {
    surface: { width: 400, height: 160 },
    otherRects: [{ x: 200, y: 16, width: 40, height: 24 }],
    tolerance: 4,
    gridSize: 8,
    keepInsideSurface: true,
    snapSize: false
  };
  const start = { x: 120, y: 16, width: 40, height: 24 };
  const blockedJump = resolveButtonGeometryAlongPath(
    start,
    { ...start, x: 180 },
    options
  );
  assert.equal(blockedJump.valid, true);
  assert.equal(blockedJump.rect.x, 160);
  assert.equal(blockedJump.rect.x + blockedJump.rect.width, 200);

  const tunnelJump = resolveButtonGeometryAlongPath(
    start,
    { ...start, x: 264 },
    options
  );
  assert.equal(tunnelJump.rect.x, 160);
});

test("continuous aspect-locked resize stops flush without ratio drift", () => {
  const start = { x: 0, y: 8, width: 40, height: 20 };
  const resolved = resolveAspectLockedButtonGeometryAlongPath(
    start,
    start,
    { ...start, width: 104, height: 52 },
    {
      surface: { width: 240, height: 160 },
      otherRects: [{ x: 80, y: 8, width: 40, height: 40 }],
      tolerance: 4,
      gridSize: 8,
      keepInsideSurface: true
    }
  );
  assert.equal(resolved.valid, true);
  assert.equal(resolved.rect.width, 80);
  assert.equal(resolved.rect.height, 40);
  assert.equal(resolved.rect.width / resolved.rect.height, 2);
});

test("continuous aspect lock keeps its original ratio across consecutive pointer moves", () => {
  const start = { x: 0, y: 0, width: 40, height: 24 };
  const options = {
    surface: { width: 400, height: 240 },
    otherRects: [],
    tolerance: 0,
    gridSize: 8,
    keepInsideSurface: true
  };
  let lastValid = start;
  for (let delta = 4; delta <= 12; delta += 1) {
    const resolved = resolveAspectLockedButtonGeometryAlongPath(
      start,
      lastValid,
      { ...start, width: start.width + delta, height: start.height + delta },
      options
    );
    assert.equal(resolved.rect.width + 0.0001 >= lastValid.width, true);
    assert.equal(Math.abs(resolved.rect.width / resolved.rect.height - 40 / 24) < 0.0001, true);
    lastValid = resolved.rect;
  }
});

test("continuous drag uses unsnapped swept collision checks on diagonal motion", () => {
  const start = { x: 0, y: 0, width: 40, height: 40 };
  const resolved = resolveButtonGeometryAlongPath(
    start,
    { ...start, x: 96, y: 96 },
    {
      surface: { width: 240, height: 240 },
      otherRects: [{ x: 0, y: 72, width: 40, height: 40 }],
      tolerance: 8,
      gridSize: 8,
      keepInsideSurface: true,
      snapSize: false
    }
  );
  assert.equal(resolved.rect.x, 40);
  assert.equal(resolved.rect.y, 32);
  assert.equal(buttonRectsOverlap(resolved.rect, { x: 0, y: 72, width: 40, height: 40 }), false);
});

test("label growth keeps the selected top-left anchor and resolves collisions deterministically", () => {
  const placements = [
    { id: "a", x: 0, y: 0, width: 40, height: 24 },
    { id: "b", x: 48, y: 0, width: 40, height: 24 },
    { id: "c", x: 96, y: 0, width: 40, height: 24 }
  ];
  const result = resolveDeterministicLabelGrowth({
    placements,
    selectedPlacementId: "a",
    grownWidth: 72,
    grownHeight: 24,
    surface: { width: 200, height: 100 },
    gridSize: 8,
    allowSurfaceExpansion: false
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.placements.find((item) => item.id === "a"), { id: "a", x: 0, y: 0, width: 72, height: 24 });
  assert.equal(result.movedPlacementIds.includes("b"), true);
  for (let left = 0; left < result.placements.length; left += 1) {
    for (let right = left + 1; right < result.placements.length; right += 1) {
      assert.equal(buttonRectsOverlap(result.placements[left], result.placements[right]), false);
    }
  }
});

test("allowLabelResize off preserves geometry and on performs the same deterministic growth", () => {
  const placements = [
    { id: "a", x: 0, y: 0, width: 40, height: 24 },
    { id: "b", x: 48, y: 0, width: 40, height: 24 }
  ];
  const common = {
    placements,
    selectedPlacementId: "a",
    grownWidth: 72,
    grownHeight: 24,
    surface: { width: 160, height: 80 },
    gridSize: 8,
    allowSurfaceExpansion: false
  };
  assert.deepEqual(applyLabelResizePolicy({ ...common, allowLabelResize: false }).placements, placements);
  assert.equal(applyLabelResizePolicy({ ...common, allowLabelResize: true }).movedPlacementIds.includes("b"), true);
});

test("schema-1 loading backfills skin sizing defaults before validation", () => {
  const document = createButtonStateDocument();
  const identity = source("Blender", "Tools", "one.py");
  const record = button("one", "single-script", identity);
  document.buttons.one = record;
  const popout = ensureRegularPopout(document, [record]);
  const placement = document.placements[popout.memberPlacementIds[0]];
  delete placement.matchHitboxToSkin;
  delete placement.allowStretching;
  delete placement.highlightOnHover;
  delete placement.textAlignment;
  delete placement.textOffsetX;
  delete placement.textOffsetY;
  delete placement.textSizeOverride;
  Object.values(document.surfaces).forEach((surface) => {
    delete surface.uniformButtonSize;
  });
  delete popout.windowFitMode;
  delete popout.desktopBoundsFitMode;
  delete popout.desktopBoundsEnvelope;

  const result = parseButtonStateDocumentJson(JSON.stringify(document));
  assert.equal(result.valid, true);
  assert.equal(result.document.placements[placement.id].matchHitboxToSkin, true);
  assert.equal(result.document.placements[placement.id].allowStretching, false);
  assert.equal(result.document.placements[placement.id].highlightOnHover, false);
  assert.equal(result.document.placements[placement.id].textAlignment, "skin");
  assert.equal(result.document.placements[placement.id].textOffsetX, 0);
  assert.equal(result.document.placements[placement.id].textOffsetY, 0);
  assert.equal(result.document.placements[placement.id].textSizeOverride, null);
  Object.values(result.document.surfaces).forEach((surface) => {
    assert.equal(surface.uniformButtonSize, null);
  });
  assert.equal(result.document.popoutUnits[popout.id].windowFitMode, "surface");
  assert.equal(result.document.popoutUnits[popout.id].desktopBoundsFitMode, "surface");
  assert.deepEqual(
    result.document.popoutUnits[popout.id].desktopBoundsEnvelope,
    result.document.popoutUnits[popout.id].canonicalBounds
  );
});

test("window envelope keeps idle visual fit tight and adds allowance only while active", () => {
  const document = createButtonStateDocument();
  const record = button("envelope", "single-script", source("Blender", "Tools", "envelope.py"));
  document.buttons[record.id] = record;
  const popout = ensureRegularPopout(document, [record]);
  const placement = document.placements[popout.memberPlacementIds[0]];
  Object.assign(placement, { x: 100, y: 50, width: 80, height: 30 });
  const idleMeasurement = {
    width: 80,
    height: 30,
    visualOverflow: { top: 3, right: 7, bottom: 4, left: 5 }
  };
  const idle = resolveButtonWindowEnvelope({
    mode: "visual",
    surfaceBounds: { x: 0, y: 0, width: 400, height: 200 },
    placements: [placement],
    idleMeasurements: { [placement.id]: idleMeasurement },
    currentMeasurements: { [placement.id]: idleMeasurement },
    visualStates: {
      [placement.id]: { hovered: false, pressed: false, held: false, play: false, release: false, error: false }
    },
    visualOverflowAllowance: 24
  });
  assert.deepEqual(idle.resting, { x: 95, y: 47, width: 92, height: 37 });
  assert.deepEqual(idle.current, idle.resting);
  assert.equal(idle.transient, false);

  const prepared = resolveButtonWindowEnvelope({
    mode: "visual",
    surfaceBounds: { x: 0, y: 0, width: 400, height: 200 },
    placements: [placement],
    idleMeasurements: { [placement.id]: idleMeasurement },
    visualStates: {
      [placement.id]: { hovered: true, pressed: false, held: false, play: false, release: false, error: false }
    },
    visualOverflowAllowance: 24
  });
  assert.deepEqual(prepared.current, { x: 76, y: 26, width: 128, height: 78 });
  assert.equal(prepared.transient, true);

  const active = resolveButtonWindowEnvelope({
    mode: "visual",
    surfaceBounds: { x: 0, y: 0, width: 400, height: 200 },
    placements: [placement],
    idleMeasurements: { [placement.id]: idleMeasurement },
    currentMeasurements: {
      [placement.id]: {
        width: 80,
        height: 30,
        visualOverflow: { top: 10, right: 30, bottom: 15, left: 20 }
      }
    },
    visualStates: {
      [placement.id]: { hovered: true, pressed: false, held: false, play: false, release: false, error: false }
    },
    visualOverflowAllowance: 24
  });
  assert.deepEqual(active.resting, idle.resting);
  assert.deepEqual(active.current, { x: 76, y: 26, width: 134, height: 78 });
  assert.equal(active.transient, true);
});

test("window envelope transition moves the crop without moving Button screen geometry", () => {
  assert.deepEqual(resolvePhysicalButtonWindowEnvelopeBounds({
    currentBounds: { left: 1000, top: 500, width: 400, height: 200 },
    currentEnvelope: { x: 0, y: 0, width: 400, height: 200 },
    nextEnvelope: { x: 100, y: 50, width: 80, height: 30 },
    contentScale: 1,
    scaleFactor: 1
  }), {
    left: 1100,
    top: 550,
    width: 80,
    height: 30
  });
});

test("fixed Pop and Fan canvases keep hover geometry on the resting semantic frame", () => {
  const pop = readFileSync(
    join(frontendRoot, "src", "button", "popout", "ButtonPopoutWindowPage.tsx"),
    "utf8"
  );
  const fan = readFileSync(
    join(frontendRoot, "src", "button", "fan", "ButtonFanWindowPage.tsx"),
    "utf8"
  );
  for (const source of [pop, fan]) {
    assert.doesNotMatch(source, /queueEnvelope\((?:preparedEnvelope|windowEnvelope)\.current\)/);
    assert.match(source, /queueEnvelope\((?:preparedEnvelope|windowEnvelope)\.resting\)/);
  }
});

test("Space-drag keeps an expanded tool set visible and persists its current mode", () => {
  const pop = readFileSync(
    join(frontendRoot, "src", "button", "popout", "ButtonPopoutWindowPage.tsx"),
    "utf8"
  );
  const dragStart = pop.indexOf("const handlePointerDownCapture");
  const dragEnd = pop.indexOf("const handlePlacementVisualMeasurement", dragStart);
  assert.ok(dragStart >= 0 && dragEnd > dragStart, "Pop Space-drag handler should be extractable");
  const dragHandler = pop.slice(dragStart, dragEnd);
  assert.doesNotMatch(dragHandler, /setDisplayMode\("collapsed"\)/);
  assert.doesNotMatch(dragHandler, /setRenderedToolSetMode\("collapsed"\)/);
  assert.match(dragHandler, /await persistPopoutBounds\(displayMode\)/);
});

test("unsaved Pop starts at one-to-one scale and repeated hover envelopes do not drift", () => {
  const restingEnvelope = { x: -2, y: -2, width: 621, height: 186 };
  const activeEnvelope = { x: -26, y: -26, width: 669, height: 234 };
  const scaleFactor = 1.25;
  const initialBounds = resolveInitialPhysicalButtonWindowEnvelopeBounds({
    currentPosition: { x: 1083, y: 561 },
    nextEnvelope: restingEnvelope,
    scaleFactor
  });
  assert.deepEqual(initialBounds, {
    left: 1083,
    top: 561,
    width: 777,
    height: 233
  });

  let bounds = initialBounds;
  for (let cycle = 0; cycle < 8; cycle += 1) {
    bounds = resolvePhysicalButtonWindowEnvelopeBounds({
      currentBounds: bounds,
      currentEnvelope: restingEnvelope,
      nextEnvelope: activeEnvelope,
      contentScale: 1,
      scaleFactor
    });
    bounds = resolvePhysicalButtonWindowEnvelopeBounds({
      currentBounds: bounds,
      currentEnvelope: activeEnvelope,
      nextEnvelope: restingEnvelope,
      contentScale: 1,
      scaleFactor
    });
    assert.deepEqual(bounds, initialBounds);
  }
});

test("fractional-scale hover envelopes stay anchored to one invariant surface origin", () => {
  const restingEnvelope = { x: -2, y: -2, width: 621, height: 186 };
  const activeEnvelope = { x: -26, y: -26, width: 669, height: 234 };
  const contentScale = 439 / 621;
  const surfaceOrigin = {
    x: 1083 - restingEnvelope.x * contentScale,
    y: 561 - restingEnvelope.y * contentScale
  };
  const restingBounds = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
    surfaceOrigin,
    envelope: restingEnvelope,
    contentScale,
    scaleFactor: 1
  });
  assert.deepEqual(restingBounds, {
    left: 1083,
    top: 561,
    width: 439,
    height: 132
  });

  for (let cycle = 0; cycle < 8; cycle += 1) {
    resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
      surfaceOrigin,
      envelope: activeEnvelope,
      contentScale,
      scaleFactor: 1
    });
    assert.deepEqual(resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
      surfaceOrigin,
      envelope: restingEnvelope,
      contentScale,
      scaleFactor: 1
    }), restingBounds);
  }
});

test("restored Pop content scale comes from physical size and the active monitor DPI", () => {
  assert.equal(resolveUniformSurfaceScale({
    viewportWidth: 750 / 1.25,
    viewportHeight: 250 / 1.25,
    surfaceWidth: 600,
    surfaceHeight: 200
  }), 1);
  assert.equal(resolveUniformSurfaceScale({
    viewportWidth: 375 / 1.25,
    viewportHeight: 125 / 1.25,
    surfaceWidth: 600,
    surfaceHeight: 200
  }), 0.5);
});

test("collapsed visual envelope keeps its Button surface origin fixed", () => {
  assert.deepEqual(resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
    surfaceOrigin: { x: 500, y: 300 },
    envelope: { x: -4, y: -6, width: 108, height: 62 },
    contentScale: 1,
    scaleFactor: 1.25
  }), {
    left: 495,
    top: 292,
    width: 135,
    height: 78
  });
});

test("collapsed visual-frame drag persists the recovered owner origin", () => {
  const liveWindowBounds = { left: 495, top: 292, width: 135, height: 78 };
  assert.deepEqual(resolvePopoutBoundsAfterDrag({
    liveWindowBounds,
    toolSetCollapsed: true,
    canonicalBounds: { x: -24, y: 12, width: 480, height: 260 },
    collapsedOrigin: { x: 500, y: 300 },
    scaleFactor: 1.25
  }), {
    desktopBounds: { left: 470, top: 315, width: 600, height: 325 },
    layoutSnapshotBounds: liveWindowBounds
  });
});

test("window fit normalization backfills missing modes but preserves invalid explicit values", () => {
  const document = createButtonStateDocument();
  const record = button("fit", "single-script", source("Blender", "Tools", "fit.py"));
  document.buttons[record.id] = record;
  const popout = ensureRegularPopout(document, [record]);
  delete popout.windowFitMode;
  const normalized = normalizeLoadedButtonStateDocument(document);
  assert.equal(normalized.popoutUnits[popout.id].windowFitMode, "surface");

  normalized.popoutUnits[popout.id].windowFitMode = "not-a-fit-mode";
  normalized.popoutUnits[popout.id].desktopBounds = {
    left: 40,
    top: 40,
    width: 160,
    height: 0
  };
  const validation = validateButtonStateDocument(normalized);
  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.path === `popoutUnits.${popout.id}.windowFitMode`), true);
  assert.equal(validation.issues.some((issue) => issue.path === `popoutUnits.${popout.id}.desktopBounds`), true);
});

test("matched-core reconciliation discards stale geometry and presentation measurements", () => {
  const document = createButtonStateDocument();
  const record = button("one", "single-script", source("Blender", "Tools", "one.py"));
  document.buttons.one = record;
  const popout = ensureRegularPopout(document, [record]);
  const placement = document.placements[popout.memberPlacementIds[0]];
  const sourceSnapshot = {
    measurement: {
      width: placement.width - 24,
      height: placement.height,
      visualOverflow: { top: 0, right: 0, bottom: 0, left: 0 }
    },
    sourceWidth: placement.width,
    sourceHeight: placement.height,
    sourceAllowStretching: placement.allowStretching,
    sourceTextFitMode: placement.textFitMode,
    sourceTextAlignment: placement.textAlignment,
    sourceMinimumFontSize: placement.minimumFontSize,
    sourceTextSizeOverride: placement.textSizeOverride,
    sourceSkinId: record.defaultSkinId,
    sourceLabel: record.label
  };

  assert.equal(shouldApplyMatchedButtonMeasurement(placement, record, sourceSnapshot), true);
  assert.equal(shouldApplyMatchedButtonMeasurement(
    { ...placement, width: placement.width - 8 },
    record,
    sourceSnapshot
  ), false);
  assert.equal(shouldApplyMatchedButtonMeasurement(
    placement,
    { ...record, label: "Changed" },
    sourceSnapshot
  ), false);
  assert.equal(shouldApplyMatchedButtonMeasurement(
    { ...placement, textSizeOverride: 18 },
    record,
    sourceSnapshot
  ), false);
  assert.equal(shouldApplyMatchedButtonMeasurement(
    { ...placement, textFitMode: "shrink-and-stack" },
    record,
    sourceSnapshot
  ), false);
  assert.equal(shouldApplyMatchedButtonMeasurement(
    { ...placement, textAlignment: "center" },
    record,
    sourceSnapshot
  ), false);
  assert.equal(shouldApplyMatchedButtonMeasurement(
    { ...placement, minimumFontSize: placement.minimumFontSize + 1 },
    record,
    sourceSnapshot
  ), false);
});

test("text-fit modes shrink and stack only whole words", () => {
  assert.equal(buttonTextFitAllowsMultipleLines("shrink"), false);
  assert.equal(buttonTextFitAllowsMultipleLines("stack-whole-words"), true);
  assert.equal(buttonTextFitAllowsMultipleLines("shrink-and-stack"), true);

  const measure = (fontSize, lines) => ({
    width: Math.max(...lines.map((line) => line.length * fontSize * 0.6)),
    height: lines.length * fontSize * 1.2
  });
  const shrink = computeButtonTextFitPlan({
    label: "Long Button Label",
    mode: "shrink",
    maximumWidth: 80,
    maximumHeight: 30,
    naturalFontSize: 16,
    minimumFontSize: 8,
    measure
  });
  assert.equal(shrink.lines.length, 1);
  assert.ok(shrink.fontSize < 16);

  const stack = computeButtonTextFitPlan({
    label: "Long Button Label",
    mode: "stack-whole-words",
    maximumWidth: 60,
    maximumHeight: 80,
    naturalFontSize: 14,
    minimumFontSize: 8,
    measure
  });
  assert.ok(stack.lines.length > 1);
  assert.deepEqual(stack.lines.join(" "), "Long Button Label");

  const renderer = readFileSync(
    join(frontendRoot, "src", "button", "skins", "ButtonSkinRenderer.tsx"),
    "utf8"
  );
  assert.match(renderer, /buttonTextFitAllowsMultipleLines\(mode\)/);
  assert.match(renderer, /previewStackWords && allowsMultipleLines/);
  assert.match(renderer, /setProperty\("white-space", "nowrap", "important"\)/);
  assert.match(renderer, /readLabelTextMeasurement\(labelNode\)/);
  assert.doesNotMatch(renderer, /Math\.max\(core\.clientWidth, core\.scrollWidth\)/);
});

test("mixed Pop, regular layouts, fan setups, panel owners, and tool-set owners resolve exactly", () => {
  const document = createButtonStateDocument();
  const oneIdentity = source("Blender", "Tools", "one.py");
  const twoIdentity = source("Blender", "Tools", "two.py");
  document.buttons.one = button("one", "single-script", oneIdentity);
  document.buttons.two = button("two", "single-script", twoIdentity);
  document.buttons.owner = button("owner", "tool-set-owner");
  document.buttons.panel = { ...button("panel", "panel-owner"), metadata: { programName: "Blender", panelName: "Tools" } };
  const selectionKey = deriveRegularPopoutSelectionKey([oneIdentity, twoIdentity]);
  document.popoutUnits.regular = {
    id: "regular", name: "Two", kind: "regular", surfaceId: "surface-button-editor-main",
    canonicalBounds: { x: 0, y: 0, width: 100, height: 100 }, desktopBounds: null,
    memberPlacementIds: [], openRule: "toggle", closeRule: "escape", transparency: 1,
    pinnedDefault: false, memberSourceIdentities: [oneIdentity, twoIdentity], selectionKey
  };
  document.popoutUnits.tool = {
    id: "tool", name: "Tool", kind: "tool-set", surfaceId: "surface-button-editor-main",
    canonicalBounds: { x: 0, y: 0, width: 100, height: 100 }, desktopBounds: null,
    childPlacementIds: [], openRule: "toggle", closeRule: "toggle", transparency: 1,
    pinnedDefault: false, ownerButtonId: "owner", childButtonIds: [], fields: []
  };
  document.fanSetups.fan = {
    id: "fan", name: "Fan", programName: "Blender", panelName: "Tools",
    panelOwnerButtonId: "panel", fanMemberButtonIds: ["one"], selectedToolSetOwnerButtonIds: ["owner"],
    fanSurfaceId: "surface-button-editor-main", fanMemberPlacementIds: [], toolSetOwnerAnchors: {},
    collapsedPanelOwnerBounds: { left: 0, top: 0, width: 40, height: 20 },
    openRule: "hover", closeRule: "hover-out", pinnedDefault: false,
    animation: { durationMs: 100, easing: "linear", staggerMs: 0 }
  };

  const split = splitMixedButtonPopSelection(document, ["owner", "one", "two"]);
  assert.deepEqual(split.singleScriptButtons.map((item) => item.id), ["one", "two"]);
  assert.deepEqual(split.toolSetOwners.map((item) => item.id), ["owner"]);
  assert.equal(resolveRegularButtonPopout(document, [twoIdentity, oneIdentity])?.id, "regular");
  assert.equal(resolveButtonFanSetups(document, "blender", "tools")[0]?.id, "fan");
  assert.equal(resolvePanelOwnerButton(document, "blender", "tools")?.id, "panel");
  assert.equal(resolveToolSetOwnerPopout(document, "owner")?.id, "tool");
});

test("shared document operations normalize duplicate selections deterministically", () => {
  const document = createButtonStateDocument();
  const one = button("one", "single-script", source("Blender", "Tools", "one.py"));
  const owner = button("owner", "tool-set-owner", source("Blender", "Tools", "tool.flowcell.toolset.json"));
  document.buttons.one = one;
  document.buttons.owner = owner;

  const popout = ensureRegularPopout(document, [one, one]);
  assert.equal(popout.memberPlacementIds.length, 1);
  assert.equal(document.placements[popout.memberPlacementIds[0]].allowLabelResize, false);
  assert.equal(document.placements[popout.memberPlacementIds[0]].matchHitboxToSkin, true);
  assert.equal(document.placements[popout.memberPlacementIds[0]].allowStretching, false);
  assert.deepEqual(Object.keys(popout).sort(), [
    "canonicalBounds", "closeRule", "desktopBounds", "desktopBoundsEnvelope",
    "desktopBoundsFitMode", "id", "kind",
    "memberPlacementIds", "memberSourceIdentities", "name", "openRule",
    "pinnedDefault", "selectionKey", "surfaceId", "transparency", "windowFitMode"
  ]);

  const first = ensureFanSetup({
    document,
    programName: "Blender",
    panelName: "Tools",
    buttons: [one, owner, one, owner]
  });
  const second = ensureFanSetup({
    document,
    programName: "Blender",
    panelName: "Tools",
    buttons: [owner, one]
  });
  assert.equal(second.id, first.id);
  assert.deepEqual(first.fanMemberButtonIds, ["one"]);
  assert.deepEqual(first.selectedToolSetOwnerButtonIds, ["owner"]);
});

test("new Fan subsets receive unique names in the same panel", () => {
  const document = createButtonStateDocument();
  const firstButton = button("first-fan-member", "single-script", source("Windows", "Utility", "first.ps1"));
  const secondButton = button("second-fan-member", "single-script", source("Windows", "Utility", "second.ps1"));
  Object.assign(document.buttons, {
    [firstButton.id]: firstButton,
    [secondButton.id]: secondButton
  });
  const first = ensureFanSetup({
    document,
    programName: "Windows",
    panelName: "Utility",
    buttons: [firstButton]
  });
  const second = ensureFanSetup({
    document,
    programName: "Windows",
    panelName: "Utility",
    buttons: [secondButton]
  });
  assert.equal(first.name, "Utility Fan");
  assert.equal(second.name, "Utility Fan 2");
  assert.notEqual(first.id, second.id);
  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
});

test("frontend macros attach idempotently as canonical core-action Buttons", () => {
  const document = createButtonStateDocument();
  const descriptor = {
    id: "macro-123",
    label: "Center Art",
    programName: "Illustrator",
    panelName: "Layout"
  };
  const first = attachCanonicalFrontendMacroButton(document, descriptor);
  const canonical = document.buttons[first.buttonId];
  const placement = document.placements[first.placementId];
  assert.equal(first.changed, true);
  assert.equal(canonical.role, "single-script");
  assert.equal(canonical.sourceIdentity.displayFileName, "macro:macro-123");
  assert.deepEqual(canonical.executionTarget, {
    kind: "core-action",
    actionId: FRONTEND_MACRO_CORE_ACTION_ID,
    payload: { macroId: "macro-123" }
  });
  assert.equal(document.surfaces[first.surfaceId].kind, "panel");
  assert.equal(placement.buttonId, canonical.id);
  assert.equal(placement.surfaceId, first.surfaceId);
  assert.equal(isCanonicalFrontendMacroButton(canonical, "macro-123"), true);
  const counts = {
    buttons: Object.keys(document.buttons).length,
    placements: Object.keys(document.placements).length,
    surfaces: Object.keys(document.surfaces).length
  };

  const second = attachCanonicalFrontendMacroButton(document, descriptor);
  assert.deepEqual(second, { ...first, changed: false });
  assert.deepEqual({
    buttons: Object.keys(document.buttons).length,
    placements: Object.keys(document.placements).length,
    surfaces: Object.keys(document.surfaces).length
  }, counts);
  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
});

test("frontend macro deletion removes every canonical graph without backend uninstall work", () => {
  const document = createButtonStateDocument();
  const attached = attachCanonicalFrontendMacroButton(document, {
    id: "macro-delete",
    label: "Delete Me",
    programName: "Blender",
    panelName: "Tools"
  });
  const macroButton = document.buttons[attached.buttonId];
  const regular = ensureRegularPopout(document, [macroButton]);
  const fan = ensureFanSetup({
    document,
    programName: "Blender",
    panelName: "Tools",
    buttons: [macroButton]
  });

  const removed = removeCanonicalFrontendMacroButtonGraphs(document, "macro-delete");
  assert.equal(removed.changed, true);
  assert.equal(removed.removedButtonIds.includes(attached.buttonId), true);
  assert.deepEqual(removed.uninstallOwnerButtonIds, []);
  assert.equal(document.buttons[attached.buttonId], undefined);
  assert.equal(document.popoutUnits[regular.id], undefined);
  assert.equal(document.fanSetups[fan.id], undefined);
  assert.equal(document.surfaces[attached.surfaceId], undefined);
  assert.equal(Object.values(document.placements).some((placement) => placement.buttonId === attached.buttonId), false);
  assert.equal(removeCanonicalFrontendMacroButtonGraphs(document, "macro-delete").changed, false);
  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
});

test("source-owning core-action Buttons uninstall their owned package", () => {
  const document = createButtonStateDocument();
  const installed = button(
    "example-page",
    "single-script",
    source("Example", "Tools", "example-page.flowcell-source.json")
  );
  installed.executionTarget = {
    kind: "core-action",
    actionId: "open-installed-page",
    payload: {
      ownerButtonId: "example-page",
      programName: "Example",
      panelName: "Tools",
      fileName: "example-page.flowcell-source.json",
      pageId: "example.page"
    }
  };
  document.buttons[installed.id] = installed;

  const removed = removeOwnedButtonGraph(document, installed.id);
  assert.deepEqual(removed.uninstallOwnerButtonIds, [installed.id]);
  assert.equal(document.buttons[installed.id], undefined);
});

test("pressDown owns activation and complete hover-aware pairs support keyboard sessions", () => {
  const regular = button("regular-press", "single-script");
  assert.deepEqual(resolveButtonPressEventPlan(regular), {
    dispatchPressDown: false,
    dispatchPressUp: false,
    runClickOnRelease: true,
    synthesizeHoverSessionForKeyboard: false
  });

  const paired = button("paired-press", "single-script");
  paired.executionTarget.events = {
    hoverEnter: { type: "blenderBridge", action: "cycle_collection_hover_save_visibility" },
    hoverLeave: { type: "blenderBridge", action: "cycle_collection_hover_clear_visibility" },
    pressDown: { type: "blenderBridge", action: "cycle_collection" },
    pressUp: { type: "blenderBridge", action: "cycle_collection_hover_restore_visibility" }
  };
  assert.deepEqual(resolveButtonPressEventPlan(paired), {
    dispatchPressDown: true,
    dispatchPressUp: true,
    runClickOnRelease: false,
    synthesizeHoverSessionForKeyboard: true
  });

  const incomplete = button("incomplete-press", "single-script");
  incomplete.executionTarget.events = {
    pressDown: { type: "blenderBridge", action: "cycle_collection" }
  };
  assert.deepEqual(resolveButtonPressEventPlan(incomplete), {
    dispatchPressDown: true,
    dispatchPressUp: false,
    runClickOnRelease: false,
    synthesizeHoverSessionForKeyboard: false
  });
});

test("tool-set child activation uses the functional host and applies only declared response fields", async () => {
  let receivedPath = "";
  const unregister = registerButtonCoreAction("test-field-service", async (_target, context) => {
    receivedPath = context.fieldValues.source_path;
    return { fieldPatch: { sampled_color: "#AABBCC", undeclared: "blocked" } };
  });
  try {
    const child = {
      ...button("browse", "tool-set-child"),
      executionTarget: { kind: "core-action", actionId: "test-field-service" },
      toolSetParentId: "owner",
      toolSetBehavior: { activateField: "source_path", execute: true }
    };
    const fields = [
      {
        id: "source_path", kind: "path", label: "Source", payloadKey: "source_path",
        defaultValue: "", pathKind: "file", x: 0, y: 0, width: 100, height: 20, zIndex: 0
      },
      {
        id: "sampled_color", kind: "color", label: "Color", payloadKey: "sampled_color",
        defaultValue: "#000000", x: 0, y: 24, width: 100, height: 20, zIndex: 0
      }
    ];
    const patches = [];
    const result = await executeButtonRecord(child, "click", {
      fields,
      fieldValues: { source_path: "", sampled_color: "#000000" },
      onFieldActivate: async () => "C:\\images\\sample.png",
      onFieldPatch: (patch) => patches.push({ ...patch })
    });
    assert.equal(result.executed, true);
    assert.equal(receivedPath, "C:\\images\\sample.png");
    assert.equal(result.fieldValues.source_path, "C:\\images\\sample.png");
    assert.equal(result.fieldValues.sampled_color, "#AABBCC");
    assert.equal("undeclared" in result.fieldValues, false);
    assert.deepEqual(patches, [
      { source_path: "C:\\images\\sample.png" },
      { sampled_color: "#AABBCC" }
    ]);
  } finally {
    unregister();
  }
});

test("Illustrator Ill Align supports none or one selected mode independently on each axis", async () => {
  const manifestPath = join(
    frontendRoot,
    "..",
    "Programs",
    "Illustrator",
    "Illustrator Git Scripts",
    "Toolsets",
    "ill-align",
    "flowcell.toolset.json"
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.execution.programKey, "illustrator_process");
  const fields = manifest.layout.fields;
  const initialValues = Object.fromEntries(fields.map((field) => [field.id, field.defaultValue]));
  const childFor = (slot) => {
    const childManifest = manifest.children.find((candidate) => candidate.slot === slot);
    return {
      ...button(slot, "tool-set-child"),
      executionTarget: {
        kind: "core-action",
        actionId: "test-ill-align",
        payload: childManifest.payload
      },
      toolSetParentId: "ill-align-owner",
      toolSetBehavior: manifest.layout.childBehaviors[slot]
    };
  };
  const xOrigin = childFor("x_geo");
  const xSurface = childFor("x_surface");
  const xMax = childFor("x_max");
  const yOrigin = childFor("y_geo");
  const ySurface = childFor("y_surface");
  assert.equal(initialValues.x_surface_active, false);
  assert.equal(initialValues.x_origin_active, false);
  assert.equal(initialValues.y_surface_active, false);
  assert.equal(initialValues.y_origin_active, false);
  assert.equal(isToolSetChildStateSelected(xOrigin, initialValues), false);
  assert.equal(isToolSetChildStateSelected(xSurface, initialValues), false);
  assert.equal(isToolSetChildStateSelected(yOrigin, initialValues), false);
  assert.equal(isToolSetChildStateSelected(ySurface, initialValues), false);

  let dispatchCount = 0;
  let receivedPayload;
  const unregister = registerButtonCoreAction("test-ill-align", async (target) => {
    dispatchCount += 1;
    receivedPayload = target.payload;
    return {};
  });
  try {
    const surfaceOn = await executeButtonRecord(xSurface, "click", {
      fields,
      fieldValues: initialValues
    });
    assert.equal(surfaceOn.executed, false);
    assert.equal(dispatchCount, 0);
    assert.equal(surfaceOn.fieldValues.x_surface_active, true);
    assert.equal(surfaceOn.fieldValues.x_origin_active, false);
    assert.equal(surfaceOn.fieldValues.y_surface_active, false);
    assert.equal(surfaceOn.fieldValues.y_origin_active, false);
    assert.equal(isToolSetChildStateSelected(xSurface, surfaceOn.fieldValues), true);
    assert.equal(isToolSetChildStateSelected(xOrigin, surfaceOn.fieldValues), false);

    const surfaceOff = await executeButtonRecord(xSurface, "click", {
      fields,
      fieldValues: surfaceOn.fieldValues
    });
    assert.equal(surfaceOff.fieldValues.x_surface_active, false);
    assert.equal(surfaceOff.fieldValues.x_origin_active, false);
    assert.equal(isToolSetChildStateSelected(xSurface, surfaceOff.fieldValues), false);
    assert.equal(isToolSetChildStateSelected(xOrigin, surfaceOff.fieldValues), false);

    await executeButtonRecord(xMax, "click", {
      fields,
      fieldValues: surfaceOff.fieldValues
    });
    assert.equal(dispatchCount, 1);
    assert.deepEqual(receivedPayload.modifier, { surface: false, origin: false });
    assert.equal(receivedPayload.mode, "MAX");

    const originOn = await executeButtonRecord(xOrigin, "click", {
      fields,
      fieldValues: surfaceOff.fieldValues
    });
    assert.equal(originOn.fieldValues.x_surface_active, false);
    assert.equal(originOn.fieldValues.x_origin_active, true);
    assert.equal(isToolSetChildStateSelected(xOrigin, originOn.fieldValues), true);
    assert.equal(isToolSetChildStateSelected(xSurface, originOn.fieldValues), false);

    const ySurfaceOn = await executeButtonRecord(ySurface, "click", {
      fields,
      fieldValues: originOn.fieldValues
    });
    assert.equal(ySurfaceOn.fieldValues.x_origin_active, true);
    assert.equal(ySurfaceOn.fieldValues.y_surface_active, true);
    assert.equal(ySurfaceOn.fieldValues.y_origin_active, false);
    assert.equal(isToolSetChildStateSelected(ySurface, ySurfaceOn.fieldValues), true);
    assert.equal(isToolSetChildStateSelected(yOrigin, ySurfaceOn.fieldValues), false);

    const surfaceSwitch = await executeButtonRecord(xSurface, "click", {
      fields,
      fieldValues: ySurfaceOn.fieldValues
    });
    assert.equal(surfaceSwitch.fieldValues.x_surface_active, true);
    assert.equal(surfaceSwitch.fieldValues.x_origin_active, false);
    assert.equal(surfaceSwitch.fieldValues.y_surface_active, true);
    await executeButtonRecord(xMax, "click", {
      fields,
      fieldValues: surfaceSwitch.fieldValues
    });
    assert.equal(dispatchCount, 2);
    assert.deepEqual(receivedPayload.modifier, { surface: true, origin: false });

    const originSwitch = await executeButtonRecord(xOrigin, "click", {
      fields,
      fieldValues: surfaceSwitch.fieldValues
    });
    assert.equal(originSwitch.fieldValues.x_surface_active, false);
    assert.equal(originSwitch.fieldValues.x_origin_active, true);
    await executeButtonRecord(xMax, "click", {
      fields,
      fieldValues: originSwitch.fieldValues
    });
    assert.equal(dispatchCount, 3);
    assert.deepEqual(receivedPayload.modifier, { surface: false, origin: true });

    const originOff = await executeButtonRecord(xOrigin, "click", {
      fields,
      fieldValues: originSwitch.fieldValues
    });
    assert.equal(originOff.fieldValues.x_surface_active, false);
    assert.equal(originOff.fieldValues.x_origin_active, false);
    assert.equal(originOff.fieldValues.y_surface_active, true);
    assert.equal(isToolSetChildStateSelected(xOrigin, originOff.fieldValues), false);
    assert.equal(isToolSetChildStateSelected(xSurface, originOff.fieldValues), false);
  } finally {
    unregister();
  }
});

test("Illustrator Rotate keeps instant presets beside one inline-value Button", async () => {
  const manifestPath = join(
    frontendRoot,
    "..",
    "Programs",
    "Illustrator",
    "Illustrator Git Scripts",
    "Toolsets",
    "rotate",
    "flowcell.toolset.json"
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.execution.programKey, "illustrator_process");
  assert.deepEqual(
    manifest.children.map((child) => child.slot),
    [
      "center_world",
      "center_cursor",
      "preset_30",
      "preset_45",
      "preset_90",
      "mode_transform",
      "mode_distribute",
      "apply_negative",
      "apply_positive",
      "value_input"
    ]
  );
  assert.equal(manifest.layout.fields.every((field) => field.hidden === true), true);
  assert.deepEqual(manifest.layout.childBehaviors.value_input, {
    inlineEditField: "value",
    execute: false
  });

  const fields = manifest.layout.fields;
  const initialValues = Object.fromEntries(fields.map((field) => [field.id, field.defaultValue]));
  const childFor = (slot) => {
    const childManifest = manifest.children.find((candidate) => candidate.slot === slot);
    return {
      ...button(slot, "tool-set-child"),
      executionTarget: {
        kind: "core-action",
        actionId: "test-illustrator-rotate",
        payload: childManifest.payload ?? {}
      },
      toolSetParentId: "illustrator-rotate-owner",
      toolSetBehavior: manifest.layout.childBehaviors[slot]
    };
  };
  const transform = childFor("mode_transform");
  const distribute = childFor("mode_distribute");
  assert.equal(initialValues.operation_mode, "TRANSFORM");
  assert.equal(initialValues.value, 90);
  assert.equal(isToolSetChildStateSelected(transform, initialValues), true);

  const distributeResult = await executeButtonRecord(distribute, "click", {
    fields,
    fieldValues: initialValues
  });
  assert.equal(distributeResult.executed, false);
  assert.equal(distributeResult.fieldValues.operation_mode, "DISTRIBUTE");
  assert.equal(distributeResult.fieldValues.value, 3);
  assert.equal(isToolSetChildStateSelected(distribute, distributeResult.fieldValues), true);
  assert.equal(isToolSetChildStateSelected(transform, distributeResult.fieldValues), false);

  const editedValues = { ...distributeResult.fieldValues, value: 11 };
  assert.equal(isToolSetChildStateSelected(distribute, editedValues), true);
  const transformResult = await executeButtonRecord(transform, "click", {
    fields,
    fieldValues: editedValues
  });
  assert.equal(transformResult.fieldValues.operation_mode, "TRANSFORM");
  assert.equal(transformResult.fieldValues.value, 90);
  assert.equal(isToolSetChildStateSelected(transform, transformResult.fieldValues), true);

  let receivedPayload;
  const unregister = registerButtonCoreAction("test-illustrator-rotate", async (target) => {
    receivedPayload = target.payload;
    return {};
  });
  try {
    const presetResult = await executeButtonRecord(childFor("preset_45"), "click", {
      fields,
      fieldValues: distributeResult.fieldValues
    });
    assert.equal(presetResult.executed, true);
    assert.equal(presetResult.fieldValues.operation_mode, "TRANSFORM");
    assert.equal(presetResult.fieldValues.value, 45);
    assert.equal(receivedPayload.command, "apply");
    assert.equal(receivedPayload.angle_deg, 45);
    assert.equal(receivedPayload.operation_mode, "TRANSFORM");
    assert.equal(receivedPayload.value, 45);

    await executeButtonRecord(childFor("apply_positive"), "click", {
      fields,
      fieldValues: editedValues
    });
    assert.equal(receivedPayload.operation_mode, "DISTRIBUTE");
    assert.equal(receivedPayload.value, 11);
    assert.equal("angle_deg" in receivedPayload, false);
    assert.equal("distribute_count" in receivedPayload, false);
  } finally {
    unregister();
  }

  const helperSource = readFileSync(
    join(frontendRoot, "..", "Programs", "Illustrator", "HelperScripts", "FlowCell_Illustrator_Rotate.jsx"),
    "utf8"
  );
  assert.match(helperSource, /mode === "WORLD" \|\| mode === "ARTBOARD"/);
  assert.match(helperSource, /mode === "CURSOR" \|\| mode === "ANCHOR"/);
  assert.match(helperSource, /operationMode === "DISTRIBUTE" \? 3 : 90/);
  assert.match(helperSource, /command === "preset_30"/);
  assert.match(helperSource, /command === "preset_45"/);
  assert.match(helperSource, /command === "preset_90"/);
  assert.match(helperSource, /operationMode = presetAngle === null/);

  const buttonHostSource = readFileSync(
    join(frontendRoot, "src", "button", "ButtonHost.tsx"),
    "utf8"
  );
  assert.match(buttonHostSource, /const inlineEditorElement = inlineEditorElementRef\.current/);
  assert.match(buttonHostSource, /await requestInlineEditorFocus\(\)/);
  assert.match(buttonHostSource, /focusAndSelectInlineEditor\(inlineEditorElement\)/);
  assert.match(buttonHostSource, /onFieldPatchRef\.current\?\.\(/);

  const popoutPageSource = readFileSync(
    join(frontendRoot, "src", "button", "popout", "ButtonPopoutWindowPage.tsx"),
    "utf8"
  );
  assert.match(popoutPageSource, /const requestInlineEditorFocus = useCallback/);
  assert.match(popoutPageSource, /\(\) => getCurrentWindow\(\)\.setFocus\(\)/);
  assert.match(popoutPageSource, /onRequestInlineEditorFocus=\{requestInlineEditorFocus\}/);
});

test("Illustrator Ill Align normalizes none, origin, and surface modes with exact geometry", () => {
  const helperPath = join(
    frontendRoot,
    "..",
    "Programs",
    "Illustrator",
    "HelperScripts",
    "FlowCell_Illustrator_Anchor.jsx"
  );
  const source = readFileSync(helperPath, "utf8");
  const modifierStart = source.indexOf("function enabledMode(");
  const modifierEnd = source.indexOf("function combinedBounds(", modifierStart);
  assert.ok(modifierStart >= 0 && modifierEnd > modifierStart, "Illustrator modifier normalizer should be extractable");
  const alignmentModifier = Function(`${source.slice(modifierStart, modifierEnd)}; return alignmentModifier;`)();
  const deltaStart = source.indexOf("function delta(");
  const deltaEnd = source.indexOf("function alignAxis(", deltaStart);
  assert.ok(deltaStart >= 0 && deltaEnd > deltaStart, "Illustrator delta function should be extractable");
  const delta = Function(`${source.slice(deltaStart, deltaEnd)}; return delta;`)();
  const selected = {
    left: 10,
    right: 30,
    centerX: 20,
    bottom: 40,
    top: 80,
    centerY: 60
  };
  const anchor = {
    left: 100,
    right: 200,
    centerX: 150,
    bottom: 300,
    top: 500,
    centerY: 400
  };

  assert.equal(alignmentModifier({ surface: false, origin: false }), "");
  assert.equal(alignmentModifier({ surface: true, origin: false }), "SURFACE");
  assert.equal(alignmentModifier({ surface: false, origin: true }), "GEOCENTER");
  assert.equal(alignmentModifier("SURFACE"), "SURFACE");
  assert.deepEqual(delta("X", "MIN", "", selected, anchor), { dx: 90, dy: 0 });
  assert.deepEqual(delta("X", "CENTER", "", selected, anchor), { dx: 130, dy: 0 });
  assert.deepEqual(delta("X", "MAX", "", selected, anchor), { dx: 170, dy: 0 });
  assert.deepEqual(delta("X", "MIN", "GEOCENTER", selected, anchor), { dx: 80, dy: 0 });
  assert.deepEqual(delta("X", "CENTER", "GEOCENTER", selected, anchor), { dx: 130, dy: 0 });
  assert.deepEqual(delta("X", "MAX", "GEOCENTER", selected, anchor), { dx: 180, dy: 0 });
  assert.deepEqual(delta("X", "MIN", "SURFACE", selected, anchor), { dx: 70, dy: 0 });
  assert.deepEqual(delta("X", "CENTER", "SURFACE", selected, anchor), { dx: 130, dy: 0 });
  assert.deepEqual(delta("X", "MAX", "SURFACE", selected, anchor), { dx: 190, dy: 0 });
  assert.deepEqual(delta("Y", "MIN", "", selected, anchor), { dx: 0, dy: 260 });
  assert.deepEqual(delta("Y", "CENTER", "", selected, anchor), { dx: 0, dy: 340 });
  assert.deepEqual(delta("Y", "MAX", "", selected, anchor), { dx: 0, dy: 420 });
  assert.deepEqual(delta("Y", "MIN", "GEOCENTER", selected, anchor), { dx: 0, dy: 240 });
  assert.deepEqual(delta("Y", "CENTER", "GEOCENTER", selected, anchor), { dx: 0, dy: 340 });
  assert.deepEqual(delta("Y", "MAX", "GEOCENTER", selected, anchor), { dx: 0, dy: 440 });
  assert.deepEqual(delta("Y", "MIN", "SURFACE", selected, anchor), { dx: 0, dy: 220 });
  assert.deepEqual(delta("Y", "CENTER", "SURFACE", selected, anchor), { dx: 0, dy: 340 });
  assert.deepEqual(delta("Y", "MAX", "SURFACE", selected, anchor), { dx: 0, dy: 460 });
});

test("per-click payload overrides win over mapped and manifest payload values", async () => {
  let receivedPayload;
  const unregister = registerButtonCoreAction("test-payload-override", async (target) => {
    receivedPayload = target.payload;
    return {};
  });
  try {
    const child = {
      ...button("apply-role", "tool-set-child"),
      executionTarget: {
        kind: "core-action",
        actionId: "test-payload-override",
        payload: { bucket: "manifest", bucket_hex: "#111111" }
      },
      toolSetParentId: "owner",
      toolSetBehavior: {
        execute: true,
        payloadTemplate: { bucket_hex: { $field: "color" } }
      }
    };
    await executeButtonRecord(child, "click", {
      fields: [{
        id: "color", kind: "color", label: "Color", payloadKey: "bucket_hex",
        defaultValue: "#000000", x: 0, y: 0, width: 100, height: 20, zIndex: 0
      }],
      fieldValues: { color: "#222222" },
      payloadOverride: { bucket: "tabs", bucket_hex: "#ABCDEF" }
    });
    assert.deepEqual(receivedPayload, { bucket: "tabs", bucket_hex: "#ABCDEF" });
  } finally {
    unregister();
  }
});

test("stored tool-package fields map declaratively and coerce unit-bearing numbers", () => {
  const patch = mappedToolPackageFields({
    format: "example-tool-package-v1",
    values: {
      StoredColor: "#ABCDEF",
      StoredSpacing: "1 m",
      StoredDistance: "5 m",
      StoredFarDistance: "1 m"
    },
    assets: {
      sourceImage: "C:/packages/Example/source.png",
      backdropImage: "C:/packages/Example/backdrop.png"
    }
  }, {
    legacyFormats: ["example-tool-package-v1"],
    fieldMap: {
      StoredColor: "color_hex",
      StoredSpacing: "spacing_m",
      StoredDistance: "distance_m",
      StoredFarDistance: "far_distance_m"
    },
    assetMap: {
      sourceImage: "source_image_path",
      backdropImage: "backdrop_image_path"
    },
    fieldTransforms: {
      StoredSpacing: "parse-number",
      StoredDistance: "parse-number",
      StoredFarDistance: "parse-number"
    }
  });

  assert.deepEqual(patch, {
    color_hex: "#ABCDEF",
    spacing_m: 1,
    distance_m: 5,
    far_distance_m: 1,
    source_image_path: "C:/packages/Example/source.png",
    backdrop_image_path: "C:/packages/Example/backdrop.png"
  });
});

test("cancelling a tool-field activation does not execute the child", async () => {
  let calls = 0;
  const unregister = registerButtonCoreAction("test-cancel-service", async () => {
    calls += 1;
  });
  try {
    const child = {
      ...button("browse-cancel", "tool-set-child"),
      executionTarget: { kind: "core-action", actionId: "test-cancel-service" },
      toolSetParentId: "owner",
      toolSetBehavior: { activateField: "source_path", execute: true }
    };
    const field = {
      id: "source_path", kind: "path", label: "Source", payloadKey: "source_path",
      defaultValue: "", pathKind: "file", x: 0, y: 0, width: 100, height: 20, zIndex: 0
    };
    const result = await executeButtonRecord(child, "click", {
      fields: [field],
      fieldValues: { source_path: "" },
      onFieldActivate: async () => undefined
    });
    assert.equal(result.executed, false);
    assert.equal(calls, 0);
    assert.deepEqual(result.fieldPatch, {});
  } finally {
    unregister();
  }
});

test("fan validation enforces identity, exact membership, anchors, and bounds", () => {
  const document = createButtonStateDocument();
  const one = button("one", "single-script", source("Blender", "Tools", "one.py"));
  const owner = button("owner", "tool-set-owner", source("Blender", "Tools", "tool.flowcell.toolset.json"));
  Object.assign(document.buttons, { one, owner });
  const fan = ensureFanSetup({
    document,
    programName: "Blender",
    panelName: "Tools",
    buttons: [one, owner]
  });
  const valid = validateButtonStateDocument(document);
  assert.equal(valid.valid, true, valid.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));

  const invalid = structuredClone(document);
  invalid.fanSetups[fan.id].name = " ";
  invalid.fanSetups[fan.id].fanMemberButtonIds.push("one");
  invalid.fanSetups[fan.id].fanMemberPlacementIds = [];
  invalid.fanSetups[fan.id].selectedToolSetOwnerButtonIds.push("owner");
  invalid.fanSetups[fan.id].toolSetOwnerAnchors.owner.width = 0;
  invalid.fanSetups[fan.id].collapsedPanelOwnerBounds = {
    left: 40,
    top: 40,
    width: 160,
    height: 44
  };
  invalid.fanSetups[fan.id].collapsedPanelOwnerBounds.height = 0;
  const rejected = validateButtonStateDocument(invalid);
  const rejectedPaths = new Set(rejected.issues.map((issue) => issue.path));
  assert.equal(rejected.valid, false);
  assert.equal(rejectedPaths.has(`fanSetups.${fan.id}`), true);
  assert.equal(rejectedPaths.has(`fanSetups.${fan.id}.fanMemberButtonIds`), true);
  assert.equal(rejectedPaths.has(`fanSetups.${fan.id}.fanMemberPlacementIds`), true);
  assert.equal(rejectedPaths.has(`fanSetups.${fan.id}.selectedToolSetOwnerButtonIds`), true);
  assert.equal(rejectedPaths.has(`fanSetups.${fan.id}.toolSetOwnerAnchors.owner`), true);
  assert.equal(rejectedPaths.has(`fanSetups.${fan.id}.collapsedPanelOwnerBounds`), true);

  const duplicate = structuredClone(document);
  duplicate.fanSetups.copy = {
    ...structuredClone(duplicate.fanSetups[fan.id]),
    id: "copy",
    name: duplicate.fanSetups[fan.id].name.toUpperCase()
  };
  const duplicateResult = validateButtonStateDocument(duplicate);
  assert.equal(duplicateResult.issues.some((issue) => issue.path === "fanSetups.copy.name"), true);

  const wrongSurfaceKind = structuredClone(document);
  wrongSurfaceKind.surfaces[fan.fanSurfaceId].kind = "main";
  const wrongSurfaceResult = validateButtonStateDocument(wrongSurfaceKind);
  assert.equal(
    wrongSurfaceResult.issues.some((issue) => issue.path === `fanSetups.${fan.id}.fanSurfaceId`),
    true
  );

  const wrongOwnerIdentity = structuredClone(document);
  wrongOwnerIdentity.fanSetups[fan.id].panelName = "Elsewhere";
  const wrongOwnerResult = validateButtonStateDocument(wrongOwnerIdentity);
  assert.equal(
    wrongOwnerResult.issues.some((issue) => issue.path === `fanSetups.${fan.id}.panelOwnerButtonId`),
    true
  );
});

test("shared owner-graph removal cleans children, surfaces, popouts, fans, anchors, and uninstall IDs", () => {
  const document = createButtonStateDocument();
  const oneIdentity = source("Blender", "Tools", "one.py");
  const twoIdentity = source("Blender", "Tools", "two.py");
  const ownerIdentity = source("Blender", "Tools", "tool.flowcell.toolset.json");
  const one = button("one", "single-script", oneIdentity);
  const two = button("two", "single-script", twoIdentity);
  const owner = button("owner", "tool-set-owner", ownerIdentity);
  const child = {
    ...button("child", "tool-set-child"),
    toolSetParentId: "owner",
    executionTarget: {
      kind: "tool-set-action",
      programName: "Blender",
      panelName: "Tools",
      ownerFileName: "owner.flowcell-source.json",
      command: "child"
    }
  };
  Object.assign(document.buttons, { one, two, owner, child });

  const regular = ensureRegularPopout(document, [one, two]);
  const fan = ensureFanSetup({
    document,
    programName: "Blender",
    panelName: "Tools",
    buttons: [one, owner]
  });
  document.surfaces.toolSurface = {
    id: "toolSurface",
    name: "Tool",
    kind: "tool-set-popout",
    width: 120,
    height: 60,
    placementIds: ["childPlacement"],
    visualOverflowAllowance: 0
  };
  document.placements.childPlacement = {
    id: "childPlacement",
    buttonId: "child",
    surfaceId: "toolSurface",
    x: 0,
    y: 0,
    width: 80,
    height: 32,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink",
    textAlignment: "skin",
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    resizeAnchor: "top-left"
  };
  document.popoutUnits.tool = {
    id: "tool",
    name: "Tool",
    kind: "tool-set",
    surfaceId: "toolSurface",
    canonicalBounds: { x: 0, y: 0, width: 120, height: 60 },
    desktopBounds: null,
    childPlacementIds: ["childPlacement"],
    openRule: "toggle",
    closeRule: "toggle",
    transparency: 1,
    pinnedDefault: false,
    ownerButtonId: "owner",
    childButtonIds: ["child"],
    fields: []
  };

  const singleRemoval = removeOwnedButtonGraph(document, "one");
  assert.deepEqual(singleRemoval.uninstallOwnerButtonIds, ["one"]);
  assert.equal(document.buttons.one, undefined);
  assert.equal(Object.values(document.placements).some((placement) => placement.buttonId === "one"), false);
  assert.deepEqual(document.popoutUnits[regular.id].memberSourceIdentities, [twoIdentity]);
  assert.equal(
    document.popoutUnits[regular.id].selectionKey,
    deriveRegularPopoutSelectionKey([twoIdentity])
  );
  assert.deepEqual(document.fanSetups[fan.id].fanMemberButtonIds, []);
  assert.deepEqual(document.fanSetups[fan.id].selectedToolSetOwnerButtonIds, ["owner"]);

  const ownerRemoval = removeOwnedButtonGraph(document, "owner");
  assert.deepEqual(new Set(ownerRemoval.removedButtonIds), new Set(["owner", "child", fan.panelOwnerButtonId]));
  assert.deepEqual(ownerRemoval.uninstallOwnerButtonIds, ["owner"]);
  assert.equal(document.popoutUnits.tool, undefined);
  assert.equal(document.surfaces.toolSurface, undefined);
  assert.equal(document.fanSetups[fan.id], undefined);
  assert.equal(document.buttons[fan.panelOwnerButtonId], undefined);
  assert.equal(Object.values(document.placements).some((placement) => ["owner", "child"].includes(placement.buttonId)), false);
});

test("Undo after import separates discarded staged packages from committed uninstall work", () => {
  const document = createButtonStateDocument();
  document.buttons.one = button("one", "single-script", source("Blender", "Tools", "one.py"));
  assert.deepEqual(resolveDiscardedStagedOwnerButtonIds(document, [" one ", "one"]), []);
  assert.deepEqual(resolveUninstallOwnerButtonIds(document, [" one ", "one"]), []);

  removeOwnedButtonGraph(document, "one");
  assert.deepEqual(resolveDiscardedStagedOwnerButtonIds(document, [" one ", "one"]), ["one"]);
  assert.deepEqual(resolveUninstallOwnerButtonIds(document, [" one ", "one"], ["one"]), ["one"]);
});
