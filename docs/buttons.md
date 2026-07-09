# FlowCell Button, Layout, Fan, Popout, Skin, and Toolset File Map

This is the navigation map for FlowCell button-related work. Use it before broad
file reads. It lists the files that own layouts, fans, popouts, button skins, and
toolsets.

## Architecture Boundaries

- State Layer owns identity, persistence, bindings, script targets, panel membership, popout state, selected tabs, and `style_group_id`.
- Functional Host Layer owns command execution, selection, drag/reorder, context menus, popouts, validation, and dispatch.
- Visual Skin Layer owns appearance only.
- Visual skins must not execute actions, mutate state, own bindings, own script targets, or control behavior.
- Imported visual code must stay render-only and sandboxed inside host surfaces.

## Core Layout, Window, and State Files

- `FlowCellFrontend/src/pages/main/MainPage.tsx`
- `FlowCellFrontend/src/lib/windowing.ts`
- `FlowCellFrontend/src/lib/layoutSnapshots.ts`
- `FlowCellFrontend/src/lib/windowContext.ts`
- `FlowCellFrontend/src/AppBase.tsx`
- `FlowCellFrontend/src/types.ts`
- `FlowCellFrontend/src/lib/state.ts`
- `FlowCellFrontend/src/lib/tauri.ts`
- `FlowCellFrontend/src-tauri/src/main.rs`
- `FlowCellFrontend/src-tauri/capabilities/default.json`

Key symbols and responsibilities:

- `MainPage.tsx`: program rails, panel records, Pop/Fan splitting, layout capture/restore, managed-window restore switch, `isToolPopoutRecord`, `isGenericToolboxRecord`, `handleOpenToolPopout`.
- `windowing.ts`: managed Tauri window creation, labels, placement, saved bounds, scoped topmost registration, popouts, fans, toolboxes, layout picker, settings, and utility windows.
- `layoutSnapshots.ts`: browser-side managed-window registry and saved bounds.
- `windowContext.ts`: window-kind context serialization and parsing.
- `AppBase.tsx`: routes parsed window contexts to the correct React page.
- `main.rs`: native commands, layout save/load, host bounds, scoped topmost, taskbar-preview exceptions, script execution, toolset dispatch, and child-slot validation.
- `default.json`: Tauri capability allowlist for managed windows and native window APIs.

## Layout Runtime Evidence

Inspect these when layout, restore, bounds, or runtime state is involved:

- `flowcellbackend/local/layouts/`
- `flowcellbackend/local/logs/frontend-tauri.log`
- `flowcellbackend/local/logs/frontend-launcher.log`
- `flowcellbackend/local/logs/controller.log`
- `flowcellbackend/local/logs/command_host.log`
- `flowcellbackend/local/flowcell_state.json`
- `flowcellbackend/local/panel_saves/`
- `flowcellbackend/local/bindings.ini`

## Fan Files

- `FlowCellFrontend/src/pages/fan/PanelFanToolPopoutWindowPage.tsx`
- `FlowCellFrontend/src/pages/fan/PanelFanOptionsWindowPage.tsx`
- `FlowCellFrontend/src/components/FanOutButtonCluster.tsx`
- `FlowCellFrontend/src/components/PanelFanOptionsWindow.tsx`
- `FlowCellFrontend/src/lib/panelFanSettings.ts`
- `FlowCellFrontend/src/lib/panelFanDiagnostics.ts`
- `FlowCellFrontend/src/pages/main/mainLayout.ts`
- `FlowCellFrontend/src/components/ShapesPanelFanCluster.tsx`
- `FlowCellFrontend/src/lib/shapesPanelFanSkins.ts`
- `FlowCellFrontend/src-tauri/capabilities/default.json`

Key responsibilities:

- `FanOutButtonCluster.tsx`: owner/child measurement, deterministic child layout, hover handling, child-only animation, measured hitboxes.
- `PanelFanToolPopoutWindowPage.tsx`: hover-open, click-pin, native bounds sync, transparent hit-testing, drag persistence, collapsed-owner anchoring.
- `panelFanSettings.ts`: fan direction, layout, and persistence settings.
- `panelFanDiagnostics.ts`: narrow diagnostics for fan geometry and collapse behavior.
- `mainLayout.ts`: main surface geometry that interacts with panel-fan placement.
- `main.rs`: scoped topmost, owner HWND binding, host-side resize helpers, program-process alias rules, and regular fan-child execution.

## Popout Files

- `FlowCellFrontend/src/pages/script-group/ScriptGroupPopoutWindowPage.tsx`
- `FlowCellFrontend/src/pages/script-group/scriptGroupPopoutWindowPage.css`
- `FlowCellFrontend/src/lib/scriptGroupPopoutSettings.ts`
- `FlowCellFrontend/src/lib/scriptGroupPopoutTemplates.ts`
- `FlowCellFrontend/src/pages/toolbox/GenericToolboxWindowPage.tsx`
- `FlowCellFrontend/src/pages/toolbox/genericToolboxWindowPage.css`
- `FlowCellFrontend/src/lib/windowing.ts`
- `FlowCellFrontend/src/lib/windowContext.ts`
- `FlowCellFrontend/src/AppBase.tsx`
- `FlowCellFrontend/src-tauri/src/main.rs`
- `FlowCellFrontend/src-tauri/capabilities/default.json`

Key responsibilities:

- `ScriptGroupPopoutWindowPage.tsx`: regular script popout rendering and popout row scaling.
- `scriptGroupPopoutSettings.ts`: script-group popout persisted settings.
- `scriptGroupPopoutTemplates.ts`: script-group popout visual templates.
- `GenericToolboxWindowPage.tsx`: generic toolset child buttons and `runToolsetAction`.
- `windowing.ts`: popout and toolbox window lifecycle, labels, saved bounds, and placement.
- `windowContext.ts` and `AppBase.tsx`: restored window context and routing.

## Button Host and Skin Files

- `FlowCellFrontend/src/components/ButtonHost.tsx`
- `FlowCellFrontend/src/components/HostSkinButton.tsx`
- `FlowCellFrontend/src/lib/skins.tsx`
- `FlowCellFrontend/src/lib/theme.ts`
- `FlowCellFrontend/src/lib/state.ts`
- `FlowCellFrontend/src/features/workspace/ButtonGrid.tsx`
- `FlowCellFrontend/src/features/workspace/WorkspaceButtonsPage.tsx`
- `FlowCellFrontend/src/components/ButtonCard.tsx`
- `FlowCellFrontend/src/components/OwnerFanoutOverlay.tsx`
- `FlowCellFrontend/src/components/FanOutButtonCluster.tsx`
- `FlowCellFrontend/src/components/ShapesPanelFanCluster.tsx`
- `FlowCellFrontend/src/lib/shapesPanelFanSkins.ts`

Key responsibilities:

- `ButtonHost.tsx`: functional host wrapper for button behavior, measurement, and dispatch surface.
- `HostSkinButton.tsx`: host-owned adapter for skin rendering.
- `skins.tsx`: skin definitions/rendering helpers.
- `theme.ts`: shared theme values.
- `state.ts`: persistent button/style assignment state, including `style_group_id`.
- `ButtonGrid.tsx`, `WorkspaceButtonsPage.tsx`, and `ButtonCard.tsx`: workspace button surfaces.
- `OwnerFanoutOverlay.tsx`: owner-button fanout overlay surface.

Do not put execution, persistence, bindings, script targets, or command dispatch
inside visual skin code.

## Toolset Shared Plumbing

- `FlowCellFrontend/src/lib/programRails.ts`
- `FlowCellFrontend/src/lib/tauri.ts`
- `FlowCellFrontend/src/pages/main/MainPage.tsx`
- `FlowCellFrontend/src/pages/toolbox/GenericToolboxWindowPage.tsx`
- `FlowCellFrontend/src-tauri/src/main.rs`
- `FlowCellFrontend/src-tauri/capabilities/default.json`

Key symbols and responsibilities:

- `programRails.ts`: `PanelScriptFileRecord`, `children`, `kind`, `bridgeAction`, `runToolsetAction`.
- `MainPage.tsx`: `isToolPopoutRecord`, `isGenericToolboxRecord`, `handleOpenToolPopout`, Pop/Fan selected-record splitting.
- `GenericToolboxWindowPage.tsx`: generic child-button UI and generic action dispatch.
- `main.rs`: `parse_flowcell_children`, `validate_toolset_child_slot`, `run_toolset_action`, `write_illustrator_rotate_command_file`, `clear_illustrator_rotate_command_file`, `run_flowcell_controller_script`.
- `default.json`: allowlists window APIs needed by toolset windows.

Toolsets are panel records with `children`. Pop opens the toolset window first.
Panel Fan separates toolset owners from regular script groups.

## Dedicated Toolbox Windows

Alignment:

- `FlowCellFrontend/src/pages/alignment/AlignmentToolboxWindowPage.tsx`
- `FlowCellFrontend/src/pages/alignment/alignmentToolboxGeometry.ts`
- `FlowCellFrontend/src/pages/alignment/alignmentToolboxWindowPage.css`
- `FlowCellFrontend/src/pages/main/AlignmentToolboxSurface.tsx`

Boolean:

- `FlowCellFrontend/src/pages/boolean/BooleanToolboxWindowPage.tsx`
- `FlowCellFrontend/src/pages/boolean/booleanToolboxGeometry.ts`
- `FlowCellFrontend/src/pages/boolean/booleanToolboxWindowPage.css`
- `FlowCellFrontend/src/pages/main/BooleanToolboxSurface.tsx`

Dimensions:

- `FlowCellFrontend/src/pages/dimensions/DimensionsToolboxWindowPage.tsx`
- `FlowCellFrontend/src/pages/dimensions/dimensionsToolboxGeometry.ts`
- `FlowCellFrontend/src/pages/dimensions/dimensionsToolboxWindowPage.css`
- `FlowCellFrontend/src/pages/main/DimensionsToolboxSurface.tsx`

Flatten/Revolve:

- `FlowCellFrontend/src/pages/flatten-revolve/FlattenRevolveToolboxWindowPage.tsx`
- `FlowCellFrontend/src/pages/flatten-revolve/flattenRevolveToolboxWindowPage.css`

Remesh:

- `FlowCellFrontend/src/pages/remesh/RemeshToolboxWindowPage.tsx`
- `FlowCellFrontend/src/pages/remesh/remeshToolboxGeometry.ts`
- `FlowCellFrontend/src/pages/remesh/remeshToolboxWindowPage.css`
- `FlowCellFrontend/src/pages/main/RemeshToolboxSurface.tsx`

Rotate:

- `FlowCellFrontend/src/pages/rotate/RotateToolboxWindowPage.tsx`
- `FlowCellFrontend/src/pages/rotate/rotateToolboxGeometry.ts`
- `FlowCellFrontend/src/pages/rotate/rotateToolboxWindowPage.css`
- `FlowCellFrontend/src/pages/main/RotateToolboxSurface.tsx`

Smart Axis:

- `FlowCellFrontend/src/pages/smart-axis/SmartAxisToolboxWindowPage.tsx`
- `FlowCellFrontend/src/pages/smart-axis/smartAxisToolboxGeometry.ts`
- `FlowCellFrontend/src/pages/smart-axis/smartAxisToolboxWindowPage.css`
- `FlowCellFrontend/src/pages/main/SmartAxisToolboxSurface.tsx`

Theme:

- `FlowCellFrontend/src/pages/theme/ThemeToolboxWindowPage.tsx`
- `FlowCellFrontend/src/pages/theme/themeToolboxWindowPage.css`

Tri Poly:

- `FlowCellFrontend/src/pages/tri-poly/TriPolyToolboxWindowPage.tsx`
- `FlowCellFrontend/src/pages/tri-poly/triPolyToolboxGeometry.ts`
- `FlowCellFrontend/src/pages/tri-poly/triPolyToolboxWindowPage.css`
- `FlowCellFrontend/src/pages/main/TriPolyToolboxSurface.tsx`

Shared main-surface helper:

- `FlowCellFrontend/src/components/ToolSurfaces.tsx`

For dedicated toolbox work, check the classifier, context kind, window opener,
page route, layout restore path, geometry file, surface file, backend command
dispatch, and Tauri capability allowlist together.

## Blender Toolset Panel Records

- `Programs/Blender/Panels/toolset/alignment_tools.flowcell-panel-item.json`
- `Programs/Blender/Panels/toolset/boolean.flowcell-panel-item.json`
- `Programs/Blender/Panels/toolset/flatten_revolve.flowcell-panel-item.json`
- `Programs/Blender/Panels/toolset/remesh.flowcell-panel-item.json`
- `Programs/Blender/Panels/toolset/rotate.flowcell-panel-item.json`
- `Programs/Blender/Panels/toolset/smart_axis.flowcell-panel-item.json`
- `Programs/Blender/Panels/toolset/theme.flowcell-panel-item.json`
- `Programs/Blender/Panels/toolset/tri_poly.flowcell-panel-item.json`
- `Programs/Blender/Panels/toolset/xyz_dimensions.flowcell-panel-item.json`

These panel records are the button records FlowCell imports and routes through
the frontend and backend toolset paths.

## Blender Toolset Source Scripts

Authoritative Blender toolset sources:

- `Programs/Blender/Blender Git Scripts/toolset/alignment tools.py`
- `Programs/Blender/Blender Git Scripts/toolset/boolean.py`
- `Programs/Blender/Blender Git Scripts/toolset/flatten revolve.py`
- `Programs/Blender/Blender Git Scripts/toolset/remesh.py`
- `Programs/Blender/Blender Git Scripts/toolset/rotate.py`
- `Programs/Blender/Blender Git Scripts/toolset/smart axis.py`
- `Programs/Blender/Blender Git Scripts/toolset/theme.py`
- `Programs/Blender/Blender Git Scripts/toolset/tri poly.py`
- `Programs/Blender/Blender Git Scripts/toolset/xyz dimensions.py`

Local backup/generated copies to inspect only when runtime or sync behavior is
involved:

- `Programs/Blender/Blender Local Scripts/alignment tools.py`
- `Programs/Blender/Blender Local Scripts/boolean.py`
- `Programs/Blender/Blender Local Scripts/flatten revolve.py`
- `Programs/Blender/Blender Local Scripts/remesh.py`
- `Programs/Blender/Blender Local Scripts/rotate.py`
- `Programs/Blender/Blender Local Scripts/smart axis.py`
- `Programs/Blender/Blender Local Scripts/theme.py`
- `Programs/Blender/Blender Local Scripts/tri poly.py`
- `Programs/Blender/Blender Local Scripts/xyz dimensions.py`

Blender bridge/action registry:

- `Programs/Blender/Blender Addons - Copy contents Into Blender/blender_bridge_flowcell/flowcell_custom_actions.json`
- `Programs/Blender/Blender Addons - Copy contents Into Blender/blender_bridge_flowcell/ManagedActions/flowcell_custom_boolean.py`
- `Programs/Blender/Blender Addons - Copy contents Into Blender/blender_bridge_flowcell/ManagedActions/flowcell_custom_theme.py`
- `Programs/Blender/Blender Addons - Copy contents Into Blender/blender_bridge_flowcell/ManagedActions/flowcell_custom_tri_poly.py`

Do not treat generated or local backup copies as the owner unless the issue is
specifically about runtime bridge state, installed add-on behavior, or sync.

## Illustrator Toolset Files

Panel records:

- `Programs/Illustrator/Panels/Toolset/Illustrator Rotate.jsx`
- `Programs/Illustrator/Panels/Toolset/Ill Align.jsx`

Authoritative Illustrator toolset sources:

- `Programs/Illustrator/Illustrator Git Scripts/Toolset/Illustrator Rotate.jsx`
- `Programs/Illustrator/Illustrator Git Scripts/Toolset/Ill Align.jsx`

Local backup/generated copies:

- `Programs/Illustrator/Illustrator Local Scripts/Illustrator Rotate.jsx`
- `Programs/Illustrator/Illustrator Local Scripts/Ill Align.jsx`

Illustrator helpers:

- `Programs/Illustrator/HelperScripts/FlowCell_Illustrator_SetAnchorHotkey.jsx`
- `Programs/Illustrator/HelperScripts/FlowCell_Illustrator_Rotate.jsx`
- `Programs/Illustrator/HelperScripts/FlowCell_Illustrator_Anchor.jsx`

Runtime command payload:

- `flowcellbackend/local/illustrator_rotate_command.json`

Use the nonblocking Illustrator process path for freeze-prone toolset button
actions. Do not route Illustrator Rotate, Anchor, or similar actions through
synchronous COM unless that exact tool has been proven safe.

## Adjacent Program Button Files

Inspect these when a button click or fan child action reaches a program bridge:

- `Programs/Blender/SupportScripts/Invoke-BlenderFlowCellAction.ps1`
- `Programs/Blender/FlowCellButtons/`
- `Programs/Blender/Blender Addons - Copy contents Into Blender/flowcell_actions.py`
- `flowcellbackend/FlowCellBackend.ahk`
- `flowcellbackend/FlowCellCommandBackend.ps1`
- `flowcellbackend/helpers/Start-FlowCellFrontend.ps1`

## Validation Map

- Documentation-only edits: inspect the rendered/file content and `git diff`; no app build is required.
- Frontend/Tauri behavior edits: run `npm run build` in `FlowCellFrontend`.
- PowerShell edits: parse-check changed PowerShell files.
- Blender Python edits: run `python -m py_compile` on changed Python files.
- Runtime behavior changes: inspect fresh relevant logs under `flowcellbackend/local/logs`.
- Blender bridge/add-on changes: state the required Blender add-on reload, Blender restart, or resync step.
- Native window or capability changes: state whether the frontend must restart or rebuild.
