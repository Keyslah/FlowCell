import test from "node:test";
import assert from "node:assert/strict";
import {
  createButtonStateDocument
} from "./.compiled-button-system/button/state/buttonDefaults.js";
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
  parseButtonSkinPaste,
  replaceEntireButtonSkin
} from "./.compiled-button-system/button/skins/skinPasteParser.js";
import {
  createEmptyButtonSkinSections
} from "./.compiled-button-system/button/skins/buttonSkinFormat.js";
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
  buttonRectsOverlap,
  compactButtonPlacements,
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
  computeButtonTextFitPlan
} from "./.compiled-button-system/button/text/textFit.js";
import {
  ensureFanSetup,
  ensureRegularPopout,
  removeOwnedButtonGraph,
  resolveDiscardedStagedOwnerButtonIds,
  resolveUninstallOwnerButtonIds,
  updateFanSetupMembers
} from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import {
  FRONTEND_MACRO_CORE_ACTION_ID,
  attachCanonicalFrontendMacroButton,
  isCanonicalFrontendMacroButton,
  removeCanonicalFrontendMacroButtonGraphs
} from "./.compiled-button-system/button/state/frontendMacroButtonOperations.js";
import {
  attachCanonicalOrganizationProfileButton,
  isCanonicalOrganizationProfileButton,
  organizationProfileOwnerButtonId,
  resolveOrganizationProfileOwnerButtonId
} from "./.compiled-button-system/button/state/organizationProfileButtonOperations.js";
import {
  applyInstalledSourceUpdate
} from "./.compiled-button-system/button/state/sourceUpdateOperations.js";
import {
  removedToolPageWindowIdentities,
  scopedToolPageWindowIdentities
} from "./.compiled-button-system/button/state/toolPageLifecycle.js";
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
  buildButtonEditorFanCandidates,
  buildButtonEditorPanelOptions,
  buildButtonEditorPlacementOptions,
  resolveButtonEditorContextPlacementId,
  resolveButtonEditorDefaultFanMembers,
  resolveButtonEditorIdentity,
  resolveButtonEditorPanelSkinTargetPlacementIds,
  resolveButtonEditorPanelSurfaceId,
  resolvePreferredButtonPlacementId
} from "./.compiled-button-system/button/editor/buttonEditorSelection.js";
import {
  BUTTON_FAN_EDITOR_HOVER_CLOSE_DELAY_MS,
  createInitialButtonFanDisclosureState,
  reduceButtonFanDisclosure
} from "./.compiled-button-system/button/editor/buttonFanDisclosure.js";
import {
  shouldApplyMatchedButtonMeasurement
} from "./.compiled-button-system/button/editor/buttonMeasurementReconciliation.js";
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
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: {}
  };
}

function organizationProfileInstall(profileName) {
  const ownerButtonId = organizationProfileOwnerButtonId(profileName);
  const identity = source("Windows", "Files", `${ownerButtonId}.flowcell-source.json`);
  return {
    ownerButtonId,
    sourceIdentity: identity,
    executionTarget: {
      kind: "panel-script",
      programName: "Windows",
      panelName: "Files",
      fileName: identity.displayFileName
    }
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
      minimumFontSize: document.settings.defaultMinimumFontSize,
      textSizeOverride: null,
      allowLabelResize: false,
      matchHitboxToSkin: true,
      allowStretching: false,
      resizeAnchor: "top-left"
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
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    resizeAnchor: "top-left"
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
  assert.equal(shouldIgnoreButtonWindowCursor(true, false), true);
  assert.equal(shouldIgnoreButtonWindowCursor(true, true), false);
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
  const created = replaceEntireButtonSkin(full);
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
      textFitMode: "shrink", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    },
    "panel-single": {
      id: "panel-single", buttonId: single.id, surfaceId: "panel", x: 8, y: 8,
      width: 160, height: 44, zIndex: 0, skinOverrideId: null,
      textFitMode: "shrink", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    },
    "panel-owner": {
      id: "panel-owner", buttonId: owner.id, surfaceId: "panel", x: 176, y: 8,
      width: 160, height: 44, zIndex: 1, skinOverrideId: null,
      textFitMode: "shrink", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    },
    "toolset-child": {
      id: "toolset-child", buttonId: child.id, surfaceId: "toolset", x: 8, y: 8,
      width: 80, height: 44, zIndex: 0, skinOverrideId: null,
      textFitMode: "shrink", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
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
    resolveButtonEditorPanelSkinTargetPlacementIds(
      document,
      "Blender",
      "Tools",
      "panel-single"
    ),
    ["panel-single", "panel-owner"]
  );
  assert.deepEqual(
    resolveButtonEditorPanelSkinTargetPlacementIds(
      document,
      "Blender",
      "Tools",
      "pop-single"
    ),
    []
  );
  assert.deepEqual(
    resolveButtonEditorPanelSkinTargetPlacementIds(
      document,
      "Blender",
      "Tools",
      "toolset-child"
    ),
    []
  );
  assert.equal(resolvePreferredButtonPlacementId(document, single.id), "panel-single");
  assert.equal(resolvePreferredButtonPlacementId(document, single.id, "pop"), "pop-single");
  assert.deepEqual(
    buildButtonEditorPlacementOptions(document, single.id).map((option) => option.label),
    ["Main page", "Pop — Single Pop"]
  );
  const ownerPlacementOptions = buildButtonEditorPlacementOptions(document, owner.id);
  assert.deepEqual(
    ownerPlacementOptions.map((option) => option.label),
    ["Main page", "Pop — Rotate"]
  );
  assert.equal(ownerPlacementOptions[1].action, "show-tool-set-popout");
  assert.equal(ownerPlacementOptions[1].surfaceId, "toolset");
  assert.deepEqual(
    buildButtonEditorPlacementOptions(document, child.id).map((option) => option.label),
    ["Pop — Rotate"]
  );
  const fanCandidates = buildButtonEditorFanCandidates(document, "Blender", "Tools");
  assert.deepEqual(
    fanCandidates.map(({ id, role }) => ({ id, role })),
    [
      { id: single.id, role: "single-script" },
      { id: owner.id, role: "tool-set-owner" }
    ]
  );
  const options = buildButtonEditorButtonOptions(document, "Blender", "Tools");
  assert.equal(options.some((option) => option.id === child.id && option.label === "X — Rotate"), true);
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
    resolveButtonEditorPanelSkinTargetPlacementIds(
      document,
      "Windows",
      "Utility",
      utilityPlacement.id
    ),
    []
  );
  const initialPlacementOptions = buildButtonEditorPlacementOptions(document, utility.id);
  assert.deepEqual(
    initialPlacementOptions.map((option) => option.label),
    ["Main page", "Fan — Default grid"]
  );
  assert.equal(initialPlacementOptions[1].action, "create-default-fan");

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

test("Button Editor default Fan grid uses every scoped single-script Button", () => {
  const document = createButtonStateDocument();
  reconcileProgramPanelOwners(document, {
    programName: "Windows",
    panels: [{ panelName: "Utility", rect: { x: 20, y: 20, width: 132, height: 37 } }],
    surfaceBounds: { width: 640, height: 480 }
  });
  const first = button("first", "single-script", source("Windows", "Utility", "first.flowcell-source.json"));
  first.executionTarget = { kind: "panel-script", programName: "Windows", panelName: "Utility", fileName: "first.flowcell-source.json" };
  const second = button("second", "single-script", source("Windows", "Utility", "second.flowcell-source.json"));
  second.executionTarget = { kind: "panel-script", programName: "Windows", panelName: "Utility", fileName: "second.flowcell-source.json" };
  const otherPanel = button("other", "single-script", source("Windows", "Files", "other.flowcell-source.json"));
  const toolSetOwner = button("tools", "tool-set-owner", source("Windows", "Utility", "tools.flowcell-toolset.json"));
  Object.assign(document.buttons, { first, second, otherPanel, toolSetOwner });

  const members = resolveButtonEditorDefaultFanMembers(document, "Windows", "Utility");
  assert.deepEqual(members.map((member) => member.id), ["first", "second"]);
  const setup = ensureFanSetup({
    document,
    programName: "Windows",
    panelName: "Utility",
    buttons: members
  });
  assert.deepEqual(setup.fanMemberButtonIds, ["first", "second"]);
  assert.equal(setup.fanMemberPlacementIds.length, 2);
  assert.equal(document.surfaces[setup.fanSurfaceId].placementIds.length, 3);
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
  assert.deepEqual(
    resolveButtonEditorDefaultFanMembers(document, " windows ", "UTILITY")
      .map((button) => button.id),
    [script.id]
  );
  assert.equal(
    resolveButtonEditorContextPlacementId(document, { surfaceId: setup.fanSurfaceId }),
    fanPlacement.id
  );
  assert.deepEqual(
    buildButtonEditorPlacementOptions(document, owner.id).map((option) => option.label),
    ["Main page", "Fan \u2014 Utility Fan"]
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
      textFitMode: "shrink", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    },
    "placement-alpha-sharedtail": {
      id: "placement-alpha-sharedtail", buttonId: firstButton.id,
      surfaceId: "surface-alpha-sharedtail", x: 8, y: 8,
      width: 160, height: 44, zIndex: 0, skinOverrideId: null,
      textFitMode: "shrink", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      resizeAnchor: "top-left"
    },
    "placement-second-button": {
      id: "placement-second-button", buttonId: secondButton.id,
      surfaceId: "surface-alpha-sharedtail", x: 8, y: 60,
      width: 160, height: 44, zIndex: 1, skinOverrideId: null,
      textFitMode: "shrink", minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
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
  assert.equal(new Set(placementLabels).size, placementLabels.length);
  assert.equal(placementLabels.every((label) => label.startsWith("Pop — Same — Same — ")), true);
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
    minimumFontSize: 0,
    textSizeOverride: "large",
    allowLabelResize: "yes",
    matchHitboxToSkin: "yes",
    allowStretching: "yes",
    resizeAnchor: "center"
  };
  const surface = document.surfaces["surface-button-editor-main"];
  surface.placementIds.push("one");
  surface.name = 42;
  surface.kind = "floating";
  surface.visualOverflowAllowance = -1;
  document.skins.malformed = { id: "malformed", name: "Malformed", structure: null };

  let result;
  assert.doesNotThrow(() => { result = validateButtonStateDocument(document); });
  assert.equal(result.structurallyValid, true);
  const paths = new Set(result.issues.map((issue) => issue.path));
  assert.equal(paths.has("buttons.one.defaultTextFitMode"), true);
  assert.equal(paths.has("placements.one.textFitMode"), true);
  assert.equal(paths.has("placements.one.minimumFontSize"), true);
  assert.equal(paths.has("placements.one.textSizeOverride"), true);
  assert.equal(paths.has("placements.one.allowLabelResize"), true);
  assert.equal(paths.has("placements.one.matchHitboxToSkin"), true);
  assert.equal(paths.has("placements.one.allowStretching"), true);
  assert.equal(paths.has("placements.one.resizeAnchor"), true);
  assert.equal(paths.has("surfaces.surface-button-editor-main.name"), true);
  assert.equal(paths.has("surfaces.surface-button-editor-main.kind"), true);
  assert.equal(paths.has("surfaces.surface-button-editor-main.visualOverflowAllowance"), true);
  assert.equal(paths.has("skins.malformed"), true);
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

test("tool-page lifecycle closes only removed page identities", () => {
  const previous = createButtonStateDocument();
  previous.buttons.layers = {
    ...button("layers", "single-script", source("Illustrator", "Layers Builder", "layers.flowcell-source.json")),
    executionTarget: {
      kind: "core-action",
      actionId: "open-tool-page",
      payload: {
        contributionId: "illustrator.layer-tree",
        ownerButtonId: "layers",
        programName: "Illustrator",
        panelName: "Layers Builder"
      }
    }
  };
  previous.buttons.shared = {
    ...button("shared", "single-script", source("Windows", "Utilities", "shared.flowcell-source.json")),
    executionTarget: {
      kind: "core-action",
      actionId: "open-tool-page",
      payload: { contributionId: "shared.page" }
    }
  };

  const next = structuredClone(previous);
  delete next.buttons.layers;
  next.buttons.sharedReplacement = {
    ...next.buttons.shared,
    id: "sharedReplacement"
  };
  delete next.buttons.shared;

  assert.deepEqual(removedToolPageWindowIdentities(previous, next), [{
    contributionId: "illustrator.layer-tree",
    ownerButtonId: "layers"
  }]);
});

test("tool-page lifecycle finds page identities in a renamed program or panel scope", () => {
  const document = createButtonStateDocument();
  document.buttons.layers = {
    ...button("layers", "single-script", source("Illustrator", "Layers Builder", "layers.flowcell-source.json")),
    executionTarget: {
      kind: "core-action",
      actionId: "open-tool-page",
      payload: {
        contributionId: "illustrator.layer-tree",
        ownerButtonId: "layers"
      }
    }
  };
  document.buttons.other = {
    ...button("other", "single-script", source("Illustrator", "Other", "other.flowcell-source.json")),
    executionTarget: {
      kind: "core-action",
      actionId: "open-tool-page",
      payload: { contributionId: "other.page", ownerButtonId: "other" }
    }
  };

  assert.deepEqual(scopedToolPageWindowIdentities(document, "illustrator", "layers builder"), [{
    contributionId: "illustrator.layer-tree",
    ownerButtonId: "layers"
  }]);
  assert.equal(scopedToolPageWindowIdentities(document, "Illustrator").length, 2);
});

test("tool-page lifecycle closes an existing owner window when its page contract changes", () => {
  const previous = createButtonStateDocument();
  previous.buttons.page = {
    ...button("page", "single-script", source("Example", "Tools", "page.flowcell-source.json")),
    executionTarget: {
      kind: "core-action",
      actionId: "open-tool-page",
      payload: {
        contributionId: "example.page",
        ownerButtonId: "page",
        renderer: "tree-inspector",
        capability: "old-capability",
        programName: "Example",
        panelName: "Tools",
        fileName: "page.flowcell-source.json",
        title: "Example"
      }
    }
  };
  const next = structuredClone(previous);
  next.buttons.page.executionTarget.payload.capability = "new-capability";

  assert.deepEqual(removedToolPageWindowIdentities(previous, next), [{
    contributionId: "example.page",
    ownerButtonId: "page"
  }]);
});

test("source updates recover legacy deterministic tool-set slots before applying core actions", () => {
  const document = createButtonStateDocument();
  const ownerId = "legacy-theme-owner";
  const ownerIdentity = source("Blender", "toolset", "legacy-theme-owner.flowcell-source.json");
  const stableSegment = (value) => Array.from(value.trim().toLocaleLowerCase())
    .map((character) => character.codePointAt(0)?.toString(16) ?? "0")
    .join("-") || "item";
  const slots = ["browse_theme", "apply_theme"];
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
        actionId: index === 0 ? "sample-blender-theme-image" : "open-window-grid"
      }
    };
  });
  document.popoutUnits.theme = {
    id: "theme",
    name: "Theme",
    kind: "tool-set",
    surfaceId: "surface-theme",
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
    label: "Theme",
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
        browse_theme: { execute: false },
        apply_theme: { execute: true }
      }
    }
  };

  applyInstalledSourceUpdate(document, update);
  assert.equal(document.buttons[childIds[0]].metadata.toolSetSlot, "browse_theme");
  assert.equal(document.buttons[childIds[1]].metadata.toolSetSlot, "apply_theme");
  assert.equal(document.buttons[childIds[0]].executionTarget.payload.slot, "browse_theme");

  assert.doesNotThrow(() => applyInstalledSourceUpdate(document, update));
});

test("opt-in source updates append child slots without replacing existing Button identities", () => {
  const document = createButtonStateDocument();
  const ownerId = "theme-owner";
  const ownerIdentity = source("Blender", "toolset", "theme.flowcell-source.json");
  document.buttons[ownerId] = button(ownerId, "tool-set-owner", ownerIdentity);
  document.buttons.existing = {
    ...button("existing", "tool-set-child"),
    toolSetParentId: ownerId,
    metadata: { toolSetSlot: "existing" },
    executionTarget: { kind: "core-action", actionId: "open-window-grid" }
  };
  document.surfaces["surface-theme"] = {
    id: "surface-theme",
    name: "Theme",
    kind: "tool-set-popout",
    width: 240,
    height: 120,
    placementIds: ["placement-existing"],
    visualOverflowAllowance: 24
  };
  document.placements["placement-existing"] = {
    id: "placement-existing",
    buttonId: "existing",
    surfaceId: "surface-theme",
    x: 7,
    y: 9,
    width: 111,
    height: 37,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink",
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    resizeAnchor: "top-left"
  };
  document.popoutUnits.theme = {
    id: "theme",
    name: "Theme",
    kind: "tool-set",
    surfaceId: "surface-theme",
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
    label: "Theme",
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

  const appendedId = document.popoutUnits.theme.childButtonIds[1];
  assert.equal(document.popoutUnits.theme.childButtonIds[0], "existing");
  assert.equal(document.buttons.existing.label, "existing");
  assert.equal(document.placements["placement-existing"].x, 7);
  assert.equal(document.buttons[appendedId].metadata.toolSetSlot, "save_package");
  assert.equal(document.buttons[appendedId].executionTarget.actionId, "save-tool-package");
  assert.equal(document.popoutUnits.theme.childPlacementIds[1], `placement-${appendedId}`);
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
      ownerButtonId: "bundled-illustrator-layer-tree",
      sourceIdentity: {
        programName: "Illustrator",
        panelName: "Layers Builder",
        fileName: "layer-tree.flowcell-source.json"
      },
      owner: {
        label: "Layer Tree",
        tooltip: "Open the live layer tree.",
        executionTarget: {
          kind: "core-action",
          actionId: "open-tool-page",
          payload: { renderer: "tree-inspector" }
        }
      },
      children: []
    }
  ]);

  assert.equal(reconciled.buttons.existing.label, "My Archive");
  assert.equal(reconciled.buttons.existing.executionTarget.payload.version, 2);
  assert.equal(reconciled.buttons["bundled-illustrator-layer-tree"].label, "Layer Tree");
  assert.equal(
    reconciled.buttons["bundled-illustrator-layer-tree"].executionTarget.actionId,
    "open-tool-page"
  );
  assert.ok(reconciled.placements["placement-bundled-illustrator-layer-tree"]);
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
  delete placement.textSizeOverride;
  delete popout.windowFitMode;
  delete popout.desktopBoundsFitMode;
  delete popout.desktopBoundsEnvelope;

  const result = parseButtonStateDocumentJson(JSON.stringify(document));
  assert.equal(result.valid, true);
  assert.equal(result.document.placements[placement.id].matchHitboxToSkin, true);
  assert.equal(result.document.placements[placement.id].allowStretching, false);
  assert.equal(result.document.placements[placement.id].textSizeOverride, null);
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
});

test("text-fit modes shrink and stack only whole words", () => {
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

test("Fan setup membership edits preserve the setup and retained presentation", () => {
  const document = createButtonStateDocument();
  const retained = button("retained", "single-script", source("Blender", "Tools", "retained.py"));
  const removed = button("removed", "single-script", source("Blender", "Tools", "removed.py"));
  const added = button("added", "single-script", source("Blender", "Tools", "added.py"));
  const retainedOwner = button("retained-owner", "tool-set-owner", source("Blender", "Tools", "retained.flowcell.toolset.json"));
  const removedOwner = button("removed-owner", "tool-set-owner", source("Blender", "Tools", "removed.flowcell.toolset.json"));
  const addedOwner = button("added-owner", "tool-set-owner", source("Blender", "Tools", "added.flowcell.toolset.json"));
  Object.assign(document.buttons, {
    retained,
    removed,
    added,
    [retainedOwner.id]: retainedOwner,
    [removedOwner.id]: removedOwner,
    [addedOwner.id]: addedOwner
  });

  const setup = ensureFanSetup({
    document,
    programName: "Blender",
    panelName: "Tools",
    buttons: [retained, removed, retainedOwner, removedOwner]
  });
  const surface = document.surfaces[setup.fanSurfaceId];
  surface.name = "Custom Tools Fan Surface";
  surface.width = 720;
  surface.height = 240;
  setup.openRule = "click";
  setup.closeRule = "manual";
  setup.pinnedDefault = true;
  setup.animation = { durationMs: 375, easing: "linear", staggerMs: 17 };
  setup.collapsedPanelOwnerBounds = { left: 1400, top: 220, width: 132, height: 56 };
  setup.toolSetOwnerAnchors[retainedOwner.id] = { left: 1800, top: 300, width: 240, height: 80 };

  const panelOwnerPlacement = surface.placementIds
    .map((placementId) => document.placements[placementId])
    .find((placement) => placement.buttonId === setup.panelOwnerButtonId);
  const retainedPlacement = setup.fanMemberPlacementIds
    .map((placementId) => document.placements[placementId])
    .find((placement) => placement.buttonId === retained.id);
  const removedPlacement = setup.fanMemberPlacementIds
    .map((placementId) => document.placements[placementId])
    .find((placement) => placement.buttonId === removed.id);
  assert.ok(panelOwnerPlacement);
  assert.ok(retainedPlacement);
  assert.ok(removedPlacement);
  retainedPlacement.x = 412;
  retainedPlacement.y = 136;
  retainedPlacement.width = 212;
  retainedPlacement.height = 58;
  retainedPlacement.skinOverrideId = document.settings.defaultSkinId;
  retainedPlacement.textSizeOverride = 21;
  const preservedOwnerPlacement = structuredClone(panelOwnerPlacement);
  const preservedMemberPlacement = structuredClone(retainedPlacement);
  const preservedConfiguration = {
    id: setup.id,
    name: setup.name,
    programName: setup.programName,
    panelName: setup.panelName,
    panelOwnerButtonId: setup.panelOwnerButtonId,
    fanSurfaceId: setup.fanSurfaceId,
    openRule: setup.openRule,
    closeRule: setup.closeRule,
    pinnedDefault: setup.pinnedDefault,
    animation: structuredClone(setup.animation),
    collapsedPanelOwnerBounds: structuredClone(setup.collapsedPanelOwnerBounds)
  };

  const updated = updateFanSetupMembers({
    document,
    setupId: setup.id,
    buttons: [retained, added, addedOwner, retainedOwner]
  });

  assert.deepEqual({
    id: updated.id,
    name: updated.name,
    programName: updated.programName,
    panelName: updated.panelName,
    panelOwnerButtonId: updated.panelOwnerButtonId,
    fanSurfaceId: updated.fanSurfaceId,
    openRule: updated.openRule,
    closeRule: updated.closeRule,
    pinnedDefault: updated.pinnedDefault,
    animation: updated.animation,
    collapsedPanelOwnerBounds: updated.collapsedPanelOwnerBounds
  }, preservedConfiguration);
  assert.deepEqual(document.placements[panelOwnerPlacement.id], preservedOwnerPlacement);
  assert.deepEqual(document.placements[retainedPlacement.id], preservedMemberPlacement);
  assert.equal(document.placements[removedPlacement.id], undefined);
  assert.deepEqual(updated.fanMemberButtonIds, [retained.id, added.id]);
  assert.equal(updated.fanMemberPlacementIds[0], retainedPlacement.id);
  assert.equal(document.placements[updated.fanMemberPlacementIds[1]].buttonId, added.id);
  assert.deepEqual(updated.selectedToolSetOwnerButtonIds, [addedOwner.id, retainedOwner.id]);
  assert.deepEqual(
    updated.toolSetOwnerAnchors[retainedOwner.id],
    { left: 1800, top: 300, width: 240, height: 80 }
  );
  assert.equal(updated.toolSetOwnerAnchors[removedOwner.id], undefined);
  assert.ok(updated.toolSetOwnerAnchors[addedOwner.id]);
  assert.ok(
    updated.toolSetOwnerAnchors[addedOwner.id].left >=
      updated.toolSetOwnerAnchors[retainedOwner.id].left +
      updated.toolSetOwnerAnchors[retainedOwner.id].width + 20
  );
  assert.equal(surface.name, "Custom Tools Fan Surface");
  assert.equal(surface.width, 720);
  assert.equal(surface.height, 240);
  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
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
    "illustrator-layer-tree",
    "single-script",
    source("Illustrator", "Layers", "illustrator-layer-tree.flowcell-source.json")
  );
  installed.executionTarget = {
    kind: "core-action",
    actionId: "open-illustrator-layer-tree",
    payload: {
      programName: "Illustrator",
      panelName: "Layers",
      fileName: "illustrator-layer-tree.flowcell-source.json"
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
      onFieldActivate: async () => "C:\\images\\theme.png",
      onFieldPatch: (patch) => patches.push({ ...patch })
    });
    assert.equal(result.executed, true);
    assert.equal(receivedPath, "C:\\images\\theme.png");
    assert.equal(result.fieldValues.source_path, "C:\\images\\theme.png");
    assert.equal(result.fieldValues.sampled_color, "#AABBCC");
    assert.equal("undeclared" in result.fieldValues, false);
    assert.deepEqual(patches, [
      { source_path: "C:\\images\\theme.png" },
      { sampled_color: "#AABBCC" }
    ]);
  } finally {
    unregister();
  }
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

test("legacy tool-package fields map declaratively and coerce unit-bearing numbers", () => {
  const patch = mappedToolPackageFields({
    format: "flowcell-blender-theme-pack-v1",
    values: {
      ThemeTabsHex: "#ABCDEF",
      GridSpacing: "1 m",
      GridDistance: "5 m",
      GridFarSpacing: "1 m"
    },
    assets: {
      bucketsImage: "C:/packages/Legacy/buckets.png",
      backgroundImage: "C:/packages/Legacy/background.png"
    }
  }, {
    legacyFormats: ["flowcell-blender-theme-pack-v1"],
    fieldMap: {
      ThemeTabsHex: "tabs_hex",
      GridSpacing: "grid_spacing_m",
      GridDistance: "grid_distance_m",
      GridFarSpacing: "grid_far_spacing_m"
    },
    assetMap: {
      bucketsImage: "theme_image_path",
      backgroundImage: "static_background_path"
    },
    fieldTransforms: {
      GridSpacing: "parse-number",
      GridDistance: "parse-number",
      GridFarSpacing: "parse-number"
    }
  });

  assert.deepEqual(patch, {
    tabs_hex: "#ABCDEF",
    grid_spacing_m: 1,
    grid_distance_m: 5,
    grid_far_spacing_m: 1,
    theme_image_path: "C:/packages/Legacy/buckets.png",
    static_background_path: "C:/packages/Legacy/background.png"
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

test("organization profiles install idempotently as owned canonical Windows / Files Buttons", () => {
  const document = createButtonStateDocument();
  const installed = organizationProfileInstall("Project Tree");
  const first = attachCanonicalOrganizationProfileButton(document, "Project Tree", installed);
  const canonical = document.buttons[first.buttonId];
  const placement = document.placements[first.placementId];

  assert.equal(first.changed, true);
  assert.equal(first.buttonId, installed.ownerButtonId);
  assert.equal(canonical.role, "single-script");
  assert.equal(canonical.label, "Project Tree");
  assert.equal(canonical.sourceIdentity.displayFileName, `${installed.ownerButtonId}.flowcell-source.json`);
  assert.deepEqual(canonical.executionTarget, installed.executionTarget);
  assert.deepEqual(canonical.metadata, {
    sourceKind: "organization-profile",
    organizationProfileName: "Project Tree"
  });
  assert.equal(document.surfaces[first.surfaceId].kind, "panel");
  assert.equal(placement.surfaceId, first.surfaceId);
  assert.equal(isCanonicalOrganizationProfileButton(canonical, "project tree"), true);
  assert.equal(resolveOrganizationProfileOwnerButtonId(document, "PROJECT TREE"), canonical.id);

  const counts = {
    buttons: Object.keys(document.buttons).length,
    placements: Object.keys(document.placements).length,
    surfaces: Object.keys(document.surfaces).length
  };
  const second = attachCanonicalOrganizationProfileButton(document, "Project Tree", installed);
  assert.deepEqual(second, { ...first, changed: false });
  assert.deepEqual({
    buttons: Object.keys(document.buttons).length,
    placements: Object.keys(document.placements).length,
    surfaces: Object.keys(document.surfaces).length
  }, counts);
  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
});

test("organization profile refresh preserves Button presentation and rejects owner collisions", () => {
  const document = createButtonStateDocument();
  const installed = organizationProfileInstall("Default");
  const attached = attachCanonicalOrganizationProfileButton(document, "Default", installed);
  const originalPlacement = structuredClone(document.placements[attached.placementId]);
  document.buttons[attached.buttonId].disabled = true;
  document.buttons[attached.buttonId].metadata.note = "keep";

  const refreshedInstall = {
    ...installed,
    executionTarget: {
      ...installed.executionTarget,
      events: { play: { action: "refresh" } }
    }
  };
  const refreshed = attachCanonicalOrganizationProfileButton(
    document,
    "Default",
    refreshedInstall
  );
  assert.equal(refreshed.changed, true);
  assert.equal(document.buttons[attached.buttonId].disabled, true);
  assert.equal(document.buttons[attached.buttonId].metadata.note, "keep");
  assert.deepEqual(document.placements[attached.placementId], originalPlacement);
  assert.deepEqual(document.buttons[attached.buttonId].executionTarget, refreshedInstall.executionTarget);

  const collision = createButtonStateDocument();
  collision.buttons[installed.ownerButtonId] = button(installed.ownerButtonId, "single-script");
  assert.throws(
    () => attachCanonicalOrganizationProfileButton(collision, "Default", installed),
    /already in use/
  );
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
