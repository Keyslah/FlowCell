# FlowCell AI Skills

This file embeds the FlowCell Codex skills directly so prompts can reference this repository doc instead of any local skill-install path.

## Skill Links

- [flowcell](#flowcell)
- [layout](#layout)
- [toolsets](#toolsets)
- [flowcell-fanout-buttons](#flowcell-fanout-buttons)
- [svgtools](#svgtools)
- [blender-theme](#blender-theme)
- [react-tauri-button-skin-contract](#react-tauri-button-skin-contract)
- [skin-author](#skin-author)

## Copy/Paste Prompt

```text
Use the FlowCell AI skills in docs/ai-skills.md. For Blender Add Script/toolset work, use flowcell and toolsets; add svgtools for exact SVG layouts, blender-theme for theme/HDRI work, and react-tauri-button-skin-contract when button skins, hitboxes, or imported visual code are involved.
```

## flowcell

**Use when:** Use when updating, fixing, or extending the FlowCell desktop app under <repo root>, especially the active Tauri v2 + React + TypeScript frontend in FlowCellFrontend, the FlowCell command/backend host under FlowCell, FlowCell logs and state under flowcellbackend\local, Blender Add Button or bridge flows, Illustrator/Photoshop scripts or buttons routed through FlowCell actions, popouts, layouts, style-group rendering, or any task that must preserve the State Layer / Functional Host Layer / Visual Skin Layer split.


### FlowCell

Work in the live repo at `<repo root>`.

Keep `FlowCell` behavior aligned with this repo unless the user explicitly asks it to diverge.

#### Freshness First

1. Read `<repo root>\PROGRAM_SUMMARY.txt` first for the current runtime architecture and recent behavior changes.
2. Inspect narrow live files before broad reads:
   - `<repo root>\FlowCellFrontend\src\...`
   - `<repo root>\FlowCellFrontend\src-tauri\...`
   - `<repo root>\flowcellbackend\FlowCellCommandBackend.ps1`
   - `<repo root>\flowcellbackend\FlowCellBackend.ahk`
   - `<repo root>\FlowCell\FlowCellUI.ps1` only when the issue is explicitly about the legacy WPF shell
   - `<repo root>\flowcellbackend\local\flowcell_state.json`
   - `<repo root>\flowcellbackend\local\bindings.ini`
3. Check current logs before guessing about runtime failures:
   - `<repo root>\flowcellbackend\local\logs\ui.log`
   - `<repo root>\flowcellbackend\local\logs\frontend-tauri.log`
   - `<repo root>\flowcellbackend\local\logs\command_host.log`
   - `<repo root>\flowcellbackend\local\logs\controller.log`
   - `<repo root>\flowcellbackend\local\logs\last_action_status.txt`
   - relevant launcher logs such as `flowcell_launcher.log`, `frontend-launcher.log`, or `ui-launcher.log`
4. If the user says something "still" fails, trust the current files and fresh logs over thread memory.
5. Verify process state and log timestamps before assuming a restart, reload, or rebuild already happened.

#### Repo Guardrails

- Make the smallest maintainable change that solves the request.
- Prefer existing patterns over new abstractions.
- Avoid broad refactors and speculative helpers.
- Use `rg`, imports, and references before opening broad files.
- Cap command output.
- Move deleted files and folders to the Recycle Bin. Do not permanently delete anything unless the user explicitly asks.
- Update `PROGRAM_SUMMARY.txt` in the same change whenever `FlowCell` is updated, fixed, reorganized, or extended.
- Keep final summaries short and factual, and always state changed files, validation run, skipped validation reasons, and remaining risks.

#### Architecture Guardrails

- Preserve the three-layer split: `State Layer`, `Functional Host Layer`, `Visual Skin Layer`.
- State owns identity, persistence, bindings, script targets, panel membership, popout state, selected tabs, and `style_group_id`.
- Functional Host owns command execution, selection, drag/reorder, context menus, popouts, validation, and dispatch.
- Visual Skin owns appearance only.
- Visual Skin must never execute actions, mutate state, own bindings, own script targets, or control behavior.
- `style_group_id` is the only saved/internal style assignment field. Do not rename it or invent alternate state fields.
- Imported HTML/CSS/React/JSX/TSX/Tailwind/SVG visual code must stay render-only and sandboxed inside host surfaces.
- Do not create visual preview systems unless the user explicitly asks.
- Do not merge visual code with functional button logic.

#### Active Runtime Map

- The active shell is the Tauri v2 + React + TypeScript frontend under `<repo root>\FlowCellFrontend`.
- The normal launcher path goes through:
  - `<repo root>\run.cmd`
  - `<repo root>\flowcellbackend\run.cmd`
  - `<repo root>\flowcellbackend\helpers\Start-FlowCellFrontend.ps1`
- The active backend command host is `<repo root>\flowcellbackend\FlowCellCommandBackend.ps1`.
- The AutoHotkey controller is `<repo root>\flowcellbackend\FlowCellBackend.ahk`.
- Mutable runtime data lives under `<repo root>\flowcellbackend\local`.
- The legacy WPF shell `<repo root>\FlowCell\FlowCellUI.ps1` still exists on disk but is not the default live shell.

#### Common Workflows

##### Frontend or host-surface changes

1. Inspect the narrow `FlowCellFrontend\src` or `src-tauri` files that own the behavior.
2. Keep behavior in the host/state layers and appearance in the visual layer.
3. Validate frontend edits with `npm run build` in `<repo root>\FlowCellFrontend`.
4. If runtime behavior changed, inspect fresh `frontend-tauri.log`, `ui.log`, and `command_host.log`.

##### PowerShell command-host or helper changes

1. Patch `FlowCellCommandBackend.ps1` or the relevant helper script instead of adding frontend-only workarounds.
2. Parse-check every changed PowerShell file with `[System.Management.Automation.Language.Parser]::ParseFile(...)`.
3. Verify the result in `command_host.log` and `last_action_status.txt` when execution behavior is involved.

##### AutoHotkey or launcher changes

1. Inspect `FlowCellBackend.ahk`, `flowcellbackend\run.cmd`, and the launcher/helper scripts first.
2. Use current launcher logs before assuming the launch path is wrong.
3. Keep launch, focus, and restart behavior aligned with the current Tauri frontend model.

##### State, layout, or popout issues

1. Inspect `flowcellbackend\local\flowcell_state.json`, `flowcellbackend\local\layouts`, and `flowcellbackend\local\panel_saves`.
2. Keep popout/layout persistence in the state layer, not in visual code.
3. Do not wipe `flowcell_state.json` unless the user explicitly asks.

##### Blender Add Button, bridge, or generated-action changes

1. Inspect:
   - `<repo root>\Blender\FlowCellButtons`
   - `<repo root>\Blender\SupportScripts`
   - `<repo root>\Blender\ManagedActions`
   - relevant config or bridge files in the repo
   - the installed FlowCell Blender add-on only when the issue is runtime-specific
2. Prefer fixing the sync/generation/bridge path instead of hand-maintaining generated wrappers one by one.
3. After changes affecting Blender add-ons, configs, generated actions, wrappers, or bridge files, state the required reload, restart, or resync step explicitly.

##### Illustrator, Photoshop, or external script-button integrations

Use these rules only when Adobe scripts, launcher buttons, or imported script actions are being created, debugged, migrated, or invoked through FlowCell.

1. Keep external app execution in the Functional Host Layer and persisted script targets, labels, tooltips, and bindings in the State Layer. Visual skins must only render the button.
2. Default script install targets:
   - Illustrator JSX: `C:\Program Files\Adobe\Adobe Illustrator 2026\Presets\en_US\Scripts`
   - Photoshop JSX: `C:\Program Files\Adobe\Adobe Photoshop 2026\Presets\Scripts`
3. When importing or reconciling the older Photoshop launcher, treat `%USERPROFILE%\Documents\codexapp\photoshop\config.json` as the source for existing button labels, tooltips, and `scriptPath` values. Prefer updating an existing button when the target `scriptPath` already matches, reject duplicate labels, and keep labels/tooltips short.
4. For JSX/ExtendScript, prefer the application's native DOM over UI automation. Handle the no-document case with a clear `alert(...)` and early return when a document is required.
5. Preserve unrelated document state. Temporarily unlock/show only what is needed, restore state afterward, and iterate removable Illustrator collections from the end to avoid index-shift bugs. In Photoshop, prefer native DOM and `layerSets` for top-level groups instead of carrying over Illustrator-specific patterns.
6. When debugging script failures, identify the exact failing call or assumption before broad rewrites. Check FlowCell logs plus app-specific logs when relevant, such as `%USERPROFILE%\Documents\codexapp\photoshop\PhotoshopLayers.log` or script-specific temp logs.
7. Protected `Program Files` installs may need an elevated/manual install step. Do not report an Adobe script as installed until the target file actually exists.

#### Validation

- Choose the smallest validation that meaningfully covers the risk.
- Frontend TypeScript or CSS changes: run `npm run build` in `FlowCellFrontend`.
- PowerShell changes: parse-check changed files with `[System.Management.Automation.Language.Parser]::ParseFile(...)`.
- Blender Python/add-on changes: run `python -m py_compile` on the changed Python files.
- Runtime regressions: inspect the latest relevant files in `flowcellbackend\local\logs`.
- If a useful automated validation is unavailable, say so plainly and leave a targeted manual verification note.

## layout

**Use when:** Use when debugging FlowCell layout save/load failures, Pop/Fan windows, tool-set/toolbox popouts, wrong window size or position, restore races, closed popouts reopening, native topmost/thumbnail-preview issues, or persisted bounds not matching the live desktop.


### Layout

Use this skill for layout persistence, popout/toolbox restore, Pop/Fan, native window placement, scale, and topmost bugs in the current FlowCell Tauri frontend.

Work in the current workspace first. Common roots:
- `<repo root>`
- `<repo root>`

Do not switch repos just because an older path appears in memory or logs. Let the current `cwd`, `AGENTS.md`, and files on disk decide.

#### Quick Start

1. Read `PROGRAM_SUMMARY.txt` first when present.
2. Check fresh runtime evidence before guessing:
   - `flowcellbackend\local\layouts\`
   - `flowcellbackend\local\logs\frontend-tauri.log`
   - `flowcellbackend\local\logs\frontend-launcher.log`
   - `flowcellbackend\local\logs\` and panel-fan debug dumps when Pop/Fan is involved
   - `flowcellbackend\local\flowcell_state.json` only if the current repo still uses it
3. Inspect the current ownership files first:
   - `FlowCellFrontend\src\pages\main\MainPage.tsx`
   - `FlowCellFrontend\src\lib\windowing.ts`
   - `FlowCellFrontend\src\lib\windowContext.ts`
   - `FlowCellFrontend\src\lib\layoutSnapshots.ts`
   - `FlowCellFrontend\src\lib\programRails.ts`
   - `FlowCellFrontend\src\App.tsx`
   - `FlowCellFrontend\src-tauri\src\main.rs`
4. Compare three truths when a saved layout disagrees with the desktop:
   - saved layout file contents
   - registered/saved managed window state
   - actual live FlowCell window bounds on desktop

Use `rg` to find current owners before opening broad files. Do not rely on older fanout/toolset assumptions when the current code already has a concrete path.

#### Current Architecture

##### Main ownership

- `MainPage.tsx` owns selected program/panel/scripts, save/load, `LayoutSnapshot.Windows`, and the restore switch for managed windows.
- `windowing.ts` owns native `WebviewWindow` creation, window labels, default placement, saved-bounds placement via `applyWindowPlacement` (position first, then size), scoped topmost registration, and `registerLayoutWindow`.
- `windowContext.ts` serializes each window kind into query-string context and parses it back.
- `App.tsx` routes parsed window contexts to the correct page and registers scoped topmost for non-main windows.
- `layoutSnapshots.ts` stores the managed-window registry in browser storage; this is the current source for windows that need to be captured.
- `main.rs` owns Tauri commands such as `save_layout_snapshot`, `load_layout_snapshot`, `set_host_window_bounds`, scoped topmost, and Windows taskbar preview exceptions.

##### Managed window kinds

The current `LayoutSnapshot.Windows` path includes window kinds such as:
- `generic-toolbox`
- `flatten-revolve-toolbox`
- `dimensions-toolbox`
- `theme-toolbox`
- `rotate-toolbox`
- `alignment-toolbox`
- `boolean-toolbox`
- `remesh-toolbox`
- `tri-poly-toolbox`
- `smart-axis-toolbox`
- `panel-fan`
- `panel-fan-options`
- `script-group-popout`
- `codex-usage-popout`

When adding or fixing a window kind, check all of these surfaces together: type union, context type/parse, `App.tsx` route, `windowing.ts` opener, `registerLayoutWindow`, restore switch in `MainPage.tsx`, backend allowlist/capability if needed, and runtime page.

##### Tool sets and Pop/Fan

Tool sets are panel records with `children`; special toolsets are identified by `kind`, `bridgeAction`, or child-slot signatures. Generic toolsets are records with children that are not one of the special toolboxes.

Critical rule: Pop/Fan selection splits tool-set records away from regular scripts. Tool sets open their toolbox windows first; regular scripts go into `script-group-popout` or `panel-fan`.

For a generic toolset, inspect:
- `programRails.ts`: `PanelScriptFileRecord.children`, `runToolsetAction`
- `MainPage.tsx`: `isToolPopoutRecord`, `isGenericToolboxRecord`, `handleOpenToolPopout`
- `GenericToolboxWindowPage.tsx`: child buttons and `runToolsetAction`
- `main.rs`: `parse_flowcell_children`, `validate_toolset_child_slot`, `run_toolset_action`

For a dedicated toolbox, check classifier, context kind, window opener, page route, layout restore, and backend command dispatch.

##### Scale and bounds

Keep the coordinate systems separate:
- Main page design space: `ExactPageFrame` scales the fixed `1225 x 721` canvas.
- Button skin scale: `ButtonHost` and `HostSkinButton` measure host/skin size and compute imported-skin scale.
- Popout/toolbox surface scale: `ScriptGroupPopoutWindowPage` and `GenericToolboxWindowPage` use CSS transform scale to fit canonical or measured content.
- Native window scale: Tauri window positions/sizes, layout snapshot bounds (Version 7), and `set_host_window_bounds` are all physical desktop pixels. Only DOM-measured geometry is logical; convert at the native boundary with `window.scaleFactor()`.

Layout snapshots save the live physical bounds verbatim and restore them verbatim. Never divide or multiply saved layout bounds by `scaleFactor`, and never add monitor-guessing conversions or "migrations" on load — a heuristic that reinterpreted saved coordinates against monitor rects moved the user's toolsets to the wrong monitor. Save what is on screen; restore it byte-for-byte. Do not compare DOM `getBoundingClientRect()` values directly to screen cursor coordinates. Convert DOM viewport rects to physical screen rects with `outerPosition + rect * scaleFactor` for hit testing.

Placement order is a hard rule: set position before size. All restore placement goes through `applyWindowPlacement` (`windowing.ts`) and `applyWindowBounds` (`MainPage.tsx`), which park the window on its final monitor first and only then apply `PhysicalSize`. A size applied while the window can still move across monitors gets rescaled by Windows (WM_DPICHANGED) when the move happens — on the 100%/150%/175% mixed-DPI setup every restored toolset came back at exactly 2/3 size at the correct position. Never reintroduce a size-then-position sequence, including in new `open*Window` functions. Exact-ratio size errors (x2/3, x1.5, x1.75) are DPI-transit bugs, not saved-data bugs; diagnose by enumerating the live `flowcell_frontend` window rects with a per-monitor-DPI-aware process (SetProcessDpiAwareness(2) + EnumWindows/GetWindowRect) and comparing against the saved layout JSON.

##### Panel Fan

Panel Fan is a native-window geometry problem, not just a visual component.

- `FanOutButtonCluster.tsx` measures owner/child footprints with stable DOM sizes and `ResizeObserver`, computes `FanClusterPanelMetrics`, and emits owner/child rects.
- `PanelFanToolPopoutWindowPage.tsx` uses metrics to switch the native window between collapsed owner bounds and expanded fan bounds.
- Collapsed owner bounds are written with `writeRegisteredLayoutWindowSnapshotBounds`; layout save should capture the collapsed owner, not an accidental expanded frame.
- `setIgnoreCursorEvents` is driven by live interactive rects so transparent fan windows do not block the desktop outside real button hitboxes.
- Space-drag collapses to the owner before moving and then resyncs the saved collapsed anchor.

##### Taskbar thumbnail / preview handling

Windows taskbar previews are handled in `main.rs`, not in React. The scoped-topmost worker checks whether the cursor is over taskbar/preview classes such as `TaskListThumbnailWnd`, `TaskListOverlayWnd`, and `TaskbarGlimpseWnd`. When true, popouts/toolboxes/fans stop forcing topmost and do not bind ownership to the foreground app.

If taskbar previews are covered, missing, or flickering, inspect:
- `is_taskbar_or_preview_window`
- `is_cursor_over_taskbar_or_preview_surface`
- `apply_scoped_window_state`
- `register_scoped_window_topmost`
- `refresh_scoped_window_topmost`

#### Workflow

##### 1. Classify the failure

- Save failure: layout file is missing expected `ToolPopouts` or `PanelPopouts`.
- Current save failure: `LayoutSnapshot.Windows` is missing a registered managed window.
- State race: saved file, registered windows, or local state gets overwritten after one popout updates.
- Close regression: a popout is closed, but a stale sibling snapshot or reconcile path immediately recreates it.
- Restore failure: saved file and state are correct, but windows do not reopen.
- Placement failure: window reopens, but at the wrong size or position.
- Scale failure: layout looks correct in design space but actual native bounds or hitboxes drift.
- Topmost/thumbnail failure: windows cover taskbar previews or fail to stay scoped to the owning program.

Do not assume the user mis-clicked. If they say it is still broken, trust current files and logs over thread memory.

##### 2. Check persistence first

- Inspect the newest layout file in `flowcellbackend\local\layouts`.
- Inspect registered managed windows via `layoutSnapshots.ts` behavior and `LayoutSnapshot.Windows`.
- In older FlowCell paths, inspect `flowcell_state.json` for `ToolPopouts`, `PanelPopouts`, `IsPoppedOut`, and saved bounds.
- If persistence is correct, the bug is in reopen, placement, scale conversion, or native topmost.

##### 3. Check live restore behavior

- Read the latest `frontend-tauri.log` entries for:
  - `Saved layout to`
  - `Loaded layout from`
  - `Opening tool popout`
  - `Tool popout opened`
  - move-save or collapsed-bounds persistence events
- Check panel-fan debug dumps for owner rects, child rects, scale factor, collapsed origin, and native bounds.
- Verify the running process and launcher timestamps before assuming the patched build is live.
- When needed, enumerate live desktop `FlowCell*` windows and compare their bounds with the saved bounds in state/layout JSON.

##### 4. Inspect the main restore owners

- In `MainPage.tsx`, inspect layout capture/restore, Pop/Fan selected-record splitting, and the managed-window restore switch.
- In `windowing.ts`, inspect the specific `open*Window` helper, label generation, default placement, saved-bounds application, duplicate window behavior, and `registerLayoutWindow`.
- In `windowContext.ts` and `App.tsx`, verify the restored window kind reaches the expected page.
- In `main.rs`, inspect `set_host_window_bounds`, layout load/save, scoped topmost, and taskbar preview logic.
- In fan issues, inspect `PanelFanToolPopoutWindowPage.tsx` and `FanOutButtonCluster.tsx`.
- In toolset issues, inspect `GenericToolboxWindowPage.tsx`, dedicated toolbox page, and backend `run_toolset_action`.

##### 5. Fix the smallest real source of truth

- Keep persistence logic in the state layer.
- Keep reopen/reposition logic in the functional host layer.
- Do not move layout behavior into visual render code.
- Prefer narrow fixes over new abstractions.
- Watch for these common failure modes:
   - sanitized window labels not mapping back to real IDs
   - stale disk reload wiping sibling popouts
   - stale local popout snapshots being blindly unioned back into disk state after a close
   - window kind added without context parse, App route, restore switch, or layout kind union
   - toolset record treated as a regular script inside Pop/Fan
   - generic toolset missing `children` or a valid backend child slot
   - layout-picker broadcasts not identifying their source window
   - existing popouts not getting forced placement reapplied
   - saved bounds being rejected by overly strict minimum-size checks
   - move/resize listeners immediately overwriting restored bounds
   - size applied before position, letting a cross-monitor move DPI-rescale the window
   - scale-factor conversions or monitor-guessing applied to saved layout bounds
   - DOM viewport rects compared directly to physical cursor coordinates
   - panel-fan expanded bounds captured instead of collapsed owner bounds
   - scoped topmost covering Windows taskbar preview thumbnails

#### Validation

- Run `npm run build` in the current repo's `FlowCellFrontend` after frontend changes.
- If the running frontend uses the compiled Tauri binary, restart through:
   - `flowcellbackend\helpers\Start-FlowCellFrontend.ps1` when present
- After restart, verify the new process start time and launcher log entries.
- If you cannot run a live click-through, say so plainly and leave a targeted manual retest note.

#### Guardrails

- Keep FlowCell behavior aligned with this repo unless the task explicitly says otherwise.
- Update `PROGRAM_SUMMARY.txt` whenever repo behavior changes.
- Never wipe `flowcell_state.json` or delete layout files unless the user explicitly asks.
- Move deleted files or folders to the Recycle Bin, never permanently delete them unless explicitly requested.

## toolsets

**Use when:** Use when adding, fixing, or updating FlowCell toolsets, including Add Script owner-button import, Pop/Fan routing, SVG-based toolset windows, resizable SVG scaling, dropdown fanouts, selected-state highlights, program execution blocks, and program-scoped topmost behavior.


### Toolsets

Work in `<repo root>`.

Use this skill when a FlowCell toolset must import as one owner button, open as its own tool window, use SVG-driven geometry, resize correctly, stay scoped to its owning program, show selected states, or handle dropdown choices inside the toolset window.

#### Core Toolset Rules

- Keep behavior host-owned. Do not edit imported skin or source script code unless the user explicitly asks.
- A toolset imports as one owner button with child controls, not as separate main-surface buttons.
- `Pop` opens the toolset window. Panel `Fan` separates toolset owners from regular panel scripts before grouping regular scripts.
- Tool-specific behavior comes from the script/toolset being worked on. Inspect that source instead of hardcoding a list of known tools into this skill.
- Generic toolset UI calls the generic frontend action API. The backend dispatcher validates the child slot and then hands execution to the selected program section.
- Each program section owns only execution details. General window, SVG, resize, highlight, and dropdown behavior stays in the shared toolset rules.
- Update `PROGRAM_SUMMARY.txt` only when the repo behavior changes. Skill-only edits do not require it.

#### SVG Geometry Source

The SVG is the geometry map. Canonical SVG size and rects are the source of truth for art, hitboxes, labels, highlights, and dropdown anchors.

```ts
export const TOOLBOX_CANONICAL_WIDTH = 315.526316;
export const TOOLBOX_CANONICAL_HEIGHT = 70.726316;

export type ToolsetRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
};

export const TOOLBOX_SVG_RECTS: readonly ToolsetRect[] = [
  { x: 0.5, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 }
] as const;
```

Overlay controls must use the SVG rect directly:

```tsx
<button
  style={{
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: `${Math.min(rect.rx, rect.ry)}px`
  }}
/>
```

#### Resizable SVG Surface

Resize scales one canonical surface. The SVG, labels, overlay buttons, selected highlights, and dropdown fanout positions scale together.

```ts
const contentWidth = Math.max(TOOLBOX_CANONICAL_WIDTH, 1);
const contentHeight = Math.max(TOOLBOX_CANONICAL_HEIGHT, 1);
const availableWidth = Math.max(1, windowSize.width);
const availableHeight = Math.max(1, windowSize.height);
const surfaceScale = Math.max(
  0.1,
  Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
);
const frameWidth = contentWidth * surfaceScale;
const frameHeight = contentHeight * surfaceScale;
```

```tsx
<div style={{ width: `${frameWidth}px`, height: `${frameHeight}px` }}>
  <div
    style={{
      width: `${TOOLBOX_CANONICAL_WIDTH}px`,
      height: `${TOOLBOX_CANONICAL_HEIGHT}px`,
      transform: `scale(${surfaceScale})`,
      transformOrigin: "top left"
    }}
  >
    <ToolsetSurface />
  </div>
</div>
```

Native resize handles start Tauri resize dragging:

```ts
const startResizeDrag =
  (direction: ResizeDirection) =>
  (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void getCurrentWindow().startResizeDragging(direction);
  };
```

#### Toolset Window Rules

Toolset windows are frameless, transparent, resizable Tauri windows. Never fall back to a normal browser or OS-framed popup.

```ts
const placement = resolveSavedBoundsPlacement(await resolveToolsetWindowOptions(), args.bounds);
const window = new WebviewWindow(windowLabel, {
  url: buildWindowContextUrl({ kind: "generic-toolbox", ...args }),
  width: placement.width,
  height: placement.height,
  x: placement.x,
  y: placement.y,
  resizable: true,
  decorations: false,
  transparent: true,
  shadow: false,
  visible: true,
  focus: false,
  alwaysOnTop: false
});

await waitForWindowCreated(window);
await applyToolsetWindowChrome(window);
await applyProgramScopedTopmost(windowLabel, args.programName);
await showWindowWithoutFocus(window);
```

```ts
await window.setDecorations(false).catch(() => {});
await window.setShadow(false).catch(() => {});
await window.setResizable(true).catch(() => {});
await window.setMinSize(null).catch(() => {});
await window.setMaxSize(null).catch(() => {});
await window.setAlwaysOnTop(false).catch(() => {});
await window.setBackgroundColor([0, 0, 0, 0]).catch(() => {});
```

Hard rules:

- No `window.open(...)` fallback for toolsets.
- No native titlebar, min/max buttons, or close button.
- No white root, shell, page, or viewport background under transparent SVG windows.
- Do not rebuild the window type when an existing toolset window path already has the needed behavior.

#### Scoped Topmost

Toolset windows stay on top only while their owning program process is the actual foreground process. Owner binding may keep a clicked toolset above its owning app, but owner binding is not a topmost match rule.

```rust
let matches_target_process = matches_process_token(&entry.process_names, &foreground_name)
    || matches_process_token(&entry.process_names, &foreground_path_token);
let matches_target = matches_target_process;
let should_stay_on_top = matches_target;
```

Do not count the toolset window itself, FlowCell sibling windows, Codex, or unrelated apps as foreground matches.

#### Selected/Highlighted Buttons

Selected visuals come from explicit host state. Hover CSS is not enough, and selected state must scale with the SVG surface because it sits on the same rect-based overlay.

```ts
type ToolsetState = {
  mode: string;
  toggles: Record<string, boolean>;
};

function selectedForSlot(state: ToolsetState, slot: string): boolean {
  return state.mode === slot || state.toggles[slot] === true;
}
```

```tsx
<button
  data-selected={selectedForSlot(toolsetState, slot) ? "true" : "false"}
  aria-pressed={selectedForSlot(toolsetState, slot) ? true : undefined}
  style={{
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  }}
/>
```

```css
.toolset-button[data-selected="true"] {
  background: rgba(71, 214, 94, 0.92);
  color: #061108;
}
```

#### Dropdown Fanout Inside Toolsets

Use this only for dropdown-style controls inside a toolset window. This is not panel `Fan`.

Rules:

- The main dropdown button always shows the current selection.
- Options open as an in-window overlay/fanout positioned from the dropdown button rect.
- Options render above the SVG surface when needed so they are not hidden under nearby buttons.
- Selecting an option updates host state, dispatches the child action if needed, and closes the fanout.
- The fanout lives inside the same scaled surface so it resizes with the SVG and hitboxes.

```tsx
const [menuOpen, setMenuOpen] = useState(false);
const activeOption = options.find((option) => option.value === state.value) ?? options[0];

<button
  style={{
    left: `${dropdownRect.x}px`,
    top: `${dropdownRect.y}px`,
    width: `${dropdownRect.width}px`,
    height: `${dropdownRect.height}px`
  }}
  aria-expanded={menuOpen}
  aria-haspopup="menu"
  onClick={() => setMenuOpen((open) => !open)}
>
  {activeOption.label}
</button>

{menuOpen ? (
  <div
    role="menu"
    style={{
      left: `${dropdownRect.x}px`,
      bottom: `${TOOLBOX_CANONICAL_HEIGHT - dropdownRect.y + 4}px`,
      minWidth: `${dropdownRect.width}px`,
      position: "absolute",
      zIndex: 20
    }}
  >
    {options.map((option) => (
      <button
        key={option.value}
        role="menuitemradio"
        aria-checked={state.value === option.value}
        data-selected={state.value === option.value ? "true" : "false"}
        onClick={() => {
          setMenuOpen(false);
          setState((current) => ({ ...current, value: option.value }));
          void runOption(option.value);
        }}
      >
        {option.label}
      </button>
    ))}
  </div>
) : null}
```

#### Program Sections

##### Blender Tool Set

- Use the existing Blender import, child metadata, bridge action, and execution path already present in the repo.
- Do not rewrite Blender execution to fit a new generic idea. The generic layer delegates to Blender.
- When behavior is tool-specific, inspect that toolset source and preserve its existing script behavior.

##### Illustrator Tool Set

- JSX toolsets may use child metadata and shared helper scripts.
- Child clicks pass intent through the tested command payload pattern for that toolset.
- Do not hardcode a default command in a wrapper if it overwrites real child-button commands.
- If a synchronous controller path hangs the app, use the tested nonblocking process path for that toolset's button actions.
- For anchor-style helpers, resolve live object bounds on each command before falling back to cached bounds.

###### Illustrator Freeze-Safe Runner Pattern

For Illustrator toolsets that can hang through COM `DoJavaScriptFile`, do not use `illustrator_direct` for button actions. Use the nonblocking process path:

```rust
let message = run_flowcell_controller_script(&script_path, "illustrator_process")?;
```

Each Illustrator toolset should use its own command payload file, not a shared generic file. Example:

```rust
let command_path = resolve_flowcell_local_root()?.join("illustrator_rotate_command.json");
fs::write(&command_path, serde_json::to_string_pretty(&payload)?)?;
let message = run_flowcell_controller_script(&script_path, "illustrator_process")?;
```

The JSX backend must remove the command file immediately after reading it and log the command before doing Illustrator DOM work:

```jsx
var commandFile = getLocalPath("illustrator_rotate_command.json");
var raw = readTextFile(commandFile);
if (!raw) {
    return { command: "status", payload: {} };
}
try {
    commandFile.remove();
} catch (ignoredRemove) {
}
var record = eval("(" + raw + ")");
writeLog("command requested: " + String(record.command || "status"));
```

Do not route Illustrator Rotate, Anchor, or other freeze-prone Illustrator toolset button actions through synchronous COM unless the tool has been explicitly proven safe.

##### Photoshop Tool Set Placeholder

- Placeholder only until there is a tested Photoshop toolset pattern.
- Do not copy another program's execution rules into Photoshop.
- When a tested Photoshop toolset exists, add only its source paths, command payload pattern, controller path, and safety rules here.

#### Validation

- Skill-only edits: inspect this file and do not run app builds.
- Runtime toolset edits: run the repo's normal frontend/backend checks and restart only when native window behavior or capabilities changed.
- Manual acceptance:
  - `Add Script` imports one owner button.
  - `Pop` opens the toolset window.
  - Panel `Fan` separates toolset owners from regular script groups.
  - Toolset SVG, labels, hitboxes, selected highlights, and dropdown fanouts resize together.
  - Toolset windows are frameless, transparent, and resizable.
  - Toolset windows stay topmost only for their owning foreground program.

## flowcell-fanout-buttons

**Use when:** Use when creating, fixing, or extending fanout buttons and panel Fan popout windows in FlowCell React/Tauri workspaces, especially when adding a new program fanout, keeping fan windows scoped to their owning program, wiring hover-open or click-pin behavior, or preserving collapsed owner-bounds persistence and skin-driven hitboxes.


### FlowCell Fanout Buttons

Work in the active FlowCell repo, especially `<repo root>`.

#### Quick Start

1. Read `PROGRAM_SUMMARY.txt` in the active repo.
2. If behavior is failing at runtime, check fresh logs before guessing:
   - `flowcellbackend\local\logs\frontend-launcher.log`
   - `flowcellbackend\local\logs\frontend-tauri.log`
3. Inspect only the narrow files that own fanout behavior:
   - `FlowCellFrontend\src\components\FanOutButtonCluster.tsx`
   - `FlowCellFrontend\src\pages\fan\PanelFanToolPopoutWindowPage.tsx`
   - `FlowCellFrontend\src\lib\windowing.ts`
   - `FlowCellFrontend\src\App.tsx`
   - `FlowCellFrontend\src-tauri\src\main.rs`
   - `FlowCellFrontend\src\lib\tauri.ts`
   - `FlowCellFrontend\src-tauri\capabilities\default.json`
   - `FlowCellFrontend\src\types.ts` only when the data shape is unclear
4. If the bug appears when a fan child action executes, inspect the native runner before changing fan geometry:
   - `FlowCellFrontend\src-tauri\src\main.rs`
   - `Programs\Blender\SupportScripts\Invoke-BlenderFlowCellAction.ps1`
   - the generated wrapper under `Programs\Blender\FlowCellButtons\`

#### Use This Skill For

- "make a fan out button"
- "add fan outs for a new program"
- "fix panel fan"
- "fix hover-open / click-pin / drag persistence"
- "keep a fanout only on its own program"
- "make the fanout window anchor correctly"
- "make the child fanout buttons match the owner"
- "fix fanout assignment, scope, or persistence"

#### Core Contract

- Use one dedicated transparent undecorated Tauri `WebviewWindow` per fanout with `shadow:false`.
- A fan label must never have two native windows in flight at once. If the click-open path and a state-driven reopen path can both call the same window open helper, serialize by label or otherwise gate the second caller before Tauri registers the first window.
- The skin code determines the interactive node and measured hitbox. The host owns fan logic, placement, hover retention, and persistence.
- The collapsed native window must equal the exact owner-pill footprint.
- Measure owner and child pill sizes from hidden untransformed DOM only.
- Do not use transform bounds, transient animation frames, or resize events from the fanout window as measurement input.
- Compute a deterministic child grid rectangle before resizing the native window.
- Resize and reposition the native window once per changed target bounds.
- Move the native window origin as needed for direction support, but do not visually move the owner pill after hover-open starts.
- Animate only the child pills inside the already-sized expanded window.
- Transparent empty space must be pointer-inert; only the visible owner and child pills should keep hover/click behavior.
- Persist only collapsed owner bounds.
- Never persist the expanded grid rectangle as the saved dropped anchor.
- Child pills should use the same visual skin path as the owner unless the user explicitly asks for a different style.
- Hover-open is transient open/close. Literal owner click is the pinned-open lock.

#### Program-Scoped Topmost

- Every fanout must stay scoped to its owning program, not globally topmost and not hardcoded to Blender.
- For panel fan windows, register scoped topmost with the real `windowContext.programName`.
- Keep the frontend `resolveProgramProcessNames(...)` and Rust `resolve_program_process_names(...)` rules in sync.
- Default to the normalized program name as a valid process token.
- Add explicit aliases only when the visible program name and real foreground process differ.
- Keep these exceptions unless the runtime changes:
  - `Blender` also needs `blender-launcher`
  - `Windows` maps to `explorer`
- When a new program does not foreground under its own name, update both maps in the same change.

#### Direction And Layout Guardrails

- Support `up`, `down`, `left`, `right`, `center`, `up-left`, `up-right`, `down-left`, and `down-right`.
- Large vertical or grid fanouts should keep the owner anchored instead of centering the owner over a wider child grid.
- If a user reports that the owner "moves right" or "moves off the mouse," inspect owner-centering math first.
- If a user reports collapse during open on large fans, inspect hover retention during the native expand, not just the close delay.

#### Layer Ownership

- State Layer: fanout assignment, child button ids, persisted bounds, layout mode, selected owner identity.
- Functional Host Layer: hover-open/collapse, deterministic measurement, native window placement, hit-testing, child activation.
- Visual Skin Layer: pill appearance only.

Do not move fanout behavior into skin code.

#### Common Edit Map

- `FanOutButtonCluster.tsx`: intrinsic measurement layer, deterministic child layout, owner/child hover handling, child-only animation.
- `PanelFanToolPopoutWindowPage.tsx`: hover-open/click-pin flow, drag persistence, native bounds sync, collapsed-owner anchoring.
- `windowing.ts`: panel-fan label lifecycle, native open defaults, persisted collapsed owner bounds.
- `App.tsx`: scoped-topmost registration target, immediate foreground/topmost sync, program-process alias rules.
- `main.rs`: scoped-topmost registry, owner HWND binding, program-process alias rules, host-side resize helpers.
- `main.rs`: also owns regular fan-child execution for non-toolset Blender buttons; check wrapper launch flags before assuming a transient window is a fan popout bug.
- `tauri.ts`: fanout window creation defaults, transparent appearance, initial open bounds, permission-sensitive native APIs.
- `app.css`: pointer inertness for transparent areas, owner/child positioning, child animation only.
- `default.json`: verify `setSize`, `setPosition`, `setShadow`, `setDecorations`, and `setIgnoreCursorEvents`.

#### New Program Checklist

1. Wire the owner selection and child ids through the existing fan state path.
2. Reuse the current panel-fan window contract instead of creating a second fan implementation.
3. Keep measurement in `FanOutButtonCluster.tsx` and host behavior in `PanelFanToolPopoutWindowPage.tsx`.
4. Register scoped topmost to the owning program in both `App.tsx` and `main.rs`.
5. If the target app process name differs from the program label, add the alias in both process-name resolvers.
6. If a duplicate-label or reopen race appears, serialize by the final fan window label instead of changing persistence first.
7. Add narrow temporary diagnostics only around the suspected edge, then remove them after the fix lands.
8. Update `PROGRAM_SUMMARY.txt` whenever FlowCell fanout behavior changes.

#### Known Failure Patterns

- Duplicate fan windows:
  The usual cause is not saved-state duplication. It is often two callers racing to open the same fan label before `WebviewWindow.getByLabel(...)` can see the first one. Check all open callers before changing persistence code.

- Instant open then collapse:
  Inspect hover retention and the owner/child hover handoff in `FanOutButtonCluster.tsx` before changing geometry math. A good native bounds sync can still collapse immediately if the visible-pill hover contract breaks during expand.

- Wrong collapsed anchor after move:
  First verify whether move/resize persistence is reading live anchored metrics and open-state refs rather than stale closure values. Do not patch drag behavior blindly if the persisted collapsed bounds are wrong.

- Fan stays above the wrong app:
  Check program-scoped topmost registration first. Confirm the fan uses the real program name, then confirm both frontend and Rust process-name resolvers contain the same alias set.

- A fan child click flashes a weird window or feels slow before the action runs:
  Do not assume the fan is opening another popout. First confirm whether the child click routes straight to `runPanelScript(...)`, then inspect the native launcher path in `main.rs` plus the generated Blender wrapper and `Invoke-BlenderFlowCellAction.ps1`. Regular Blender panel buttons may flash a transient PowerShell host window if the wrapper launch is not hidden.

#### Validation

- Run `npm run build` in the active repo's `FlowCellFrontend`.
- Restart with `flowcellbackend\helpers\Start-FlowCellFrontend.ps1` after Tauri/native changes.
- Recheck `frontend-launcher.log` and `frontend-tauri.log` when the issue is runtime-specific.
- Leave a manual smoke note for:
  - large fanouts opening without the owner jumping off the cursor
  - hover-open staying alive without mouse chase
  - owner click pinning the fan open and second click force-closing it
  - `Space` drag keeping the dropped collapsed owner anchor
  - the fan staying above only its owning target app
  - `Escape` and hover-out collapse
  - child pills matching owner style
  - transparent gaps staying pointer-inert

## svgtools

**Use when:** Use when building or updating an exact SVG-driven FlowCell toolset popout from a provided SVG, especially when the user wants literal geometry, no styling interpretation, no auto layout, fixed hitboxes, fixed window bounds, or row-level sizing controls. Trigger on requests like "make this toolset from this SVG", "exactly like the SVG", "no interpretation", "use the current hitboxes", or "make the popout match this SVG exactly."


### SVG Tools

Work in `<repo root>` unless the user explicitly points to a different FlowCell workspace.

Use this skill when the job is not "design something similar." Use it when the SVG itself is the geometry contract.

#### Non-Negotiables

- Treat the SVG as the only geometry source.
- Do not infer spacing, padding, alignment, or styling.
- Do not route exact SVG toolsets through generic grid/fan/grow layouts.
- Keep the visual rect and clickable rect matched.
- Keep window size derived from the SVG bounds, not measured content.
- Reject or flag ambiguous SVGs instead of guessing.

If the user says "exact," the result is binary: exact or wrong.

#### Trigger Patterns

Use this skill when the user:

- provides an SVG for a tool window or button strip
- asks for "exact dimensions"
- says "no interpretation"
- wants a FlowCell toolbox to match an SVG literally
- wants a toolset generated from capsule/button geometry
- wants top-level scale or per-row text-size controls for an exact SVG toolbox

#### Workflow

##### 1. Classify the toolbox path

First decide whether this must be a dedicated exact toolbox.

Use a dedicated exact toolbox path when:

- the SVG defines explicit window bounds and button capsules
- the user wants literal positioning
- the user wants fixed hitboxes
- the user wants row-specific text sizing

Do not use `GenericToolboxWindowPage.tsx` for exact SVG toolsets.

##### 2. Lock one geometry owner

Pick one geometry file for the toolset and put the tuning constants at the top.

Preferred pattern:

- `<tool>ToolboxGeometry.ts`
- top-level scale constant first
- row-level text-size constants next if text needs manual control
- canonical width and height from the SVG
- per-button rects from the SVG
- input rects from the SVG if present

Example responsibilities:

- geometry file: dimensions, rects, scale, row text sizes
- surface file: render the SVG and overlay host-owned hitboxes
- window page: host shell, scaling wrapper, drag behavior
- shared windowing: fixed bounds, no generic owner/focus surprises

##### 3. Read the SVG literally

Extract:

- window width and height
- `viewBox`
- button rect `x`, `y`, `width`, `height`
- corner radii
- any exact input field bounds

Do not reinterpret the SVG into a grid if the SVG already defines explicit capsule positions.

If the SVG has more capsules than actions, keep the unused capsules decorative unless the user provides a mapping.

##### 4. Render with host-owned hitboxes

Use the SVG as the visual source and overlay transparent or host-owned interactive controls on the same rects.

Required rules:

- hitbox rect must equal the SVG rect
- label must sit inside the same rect
- text alignment must be centered structurally, not by guesswork
- no imported skin sizing for exact SVG toolsets
- no label-measured width decisions

For text alignment:

- center labels with flex on the label span
- use explicit row text-size constants when needed
- keep one constant per row if the rows differ

##### 5. Window behavior rules

For exact SVG toolsets:

- fixed window width and height from the SVG
- non-resizable unless the user explicitly asks otherwise
- ignore saved width and height from old layouts
- saved position is okay if still wanted
- no native owner binding for exact toolbox families
- do not force global focus on open

If scoped-on-top behavior is required:

- keep it scoped to the owning program only
- never leave a fallback global-topmost path behind
- keep opener behavior and mounted-page behavior consistent

##### 6. File map in this workspace

The usual edit owners in this FlowCell workspace are:

- `FlowCellFrontend\src\pages\<tool>\<tool>ToolboxGeometry.ts`
- `FlowCellFrontend\src\pages\main\<Tool>ToolboxSurface.tsx`
- `FlowCellFrontend\src\pages\<tool>\<Tool>ToolboxWindowPage.tsx`
- `FlowCellFrontend\src\pages\<tool>\<tool>ToolboxWindowPage.css`
- `FlowCellFrontend\src\lib\windowing.ts`

Only touch these extra owners if behavior actually requires it:

- `FlowCellFrontend\src\App.tsx`
- `FlowCellFrontend\src-tauri\src\main.rs`

Update `PROGRAM_SUMMARY.txt` whenever FlowCell behavior changes in the repo.

#### Required code patterns in this workspace

Do not leave these as vague intentions. For FlowCell, exact SVG toolsets should carry the concrete host code that makes the behavior real.

##### Geometry owner pattern

Put the tuning constants at the top of the geometry file.

Preferred pattern:

```ts
export const TOOLBOX_SCALE = 1;
export const TOOLBOX_TOP_ROW_TEXT_SIZE = 9;
export const TOOLBOX_CENTER_ROW_TEXT_SIZE = 10.5;
export const TOOLBOX_MODE_ROW_TEXT_SIZE = 12;
export const TOOLBOX_APPLY_ROW_TEXT_SIZE = 12;
export const TOOLBOX_INPUT_TEXT_SIZE = 18;
```

Then derive:

- canonical width and height
- window width and height
- exact rects from the SVG

##### Surface render pattern

The surface should:

- render the literal SVG outlines
- place the field and buttons with exact `left`, `top`, `width`, `height`
- apply row text size from the geometry constants
- keep labels structurally centered

Centering pattern:

```css
.toolbox-button-label {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}
```

##### Program-scoped-on-top pattern

Do not forget this. Exact toolbox popouts must stay on top of their owning program only.

In `FlowCellFrontend\src\lib\windowing.ts`, exact toolbox openers should:

- create the window with `alwaysOnTop: false`
- create the window with `focus: false`
- call `applyProgramScopedTopmost(windowLabel, args.programName, false)`
- use `showWindowWithoutFocus(window)` instead of `focusExistingWindow(window)`

Required opener shape:

```ts
const window = new WebviewWindow(windowLabel, {
  ...,
  focus: false,
  alwaysOnTop: false
});

await waitForWindowCreated(window);
await applyProgramScopedTopmost(windowLabel, args.programName, false);
await showWindowWithoutFocus(window);
```

For already-open exact toolbox windows:

```ts
await applyProgramScopedTopmost(windowLabel, args.programName, false);
await showWindowWithoutFocus(existing);
```

##### Mounted page / native guardrails

Keep the mounted-page and native layers aligned with the opener.

In `FlowCellFrontend\src\App.tsx`:

- exact toolbox kinds must return `false` from `shouldBindScopedNativeOwner(...)`
- scoped topmost should be based on the owning program only

Required rule:

```ts
const shouldStayOnTop = matchesTarget;
await applyTopmost(shouldStayOnTop, { promote: matchesTarget });
```

In `FlowCellFrontend\src-tauri\src\main.rs`:

- scoped topmost should be based on `matches_target`
- do not reintroduce a focused-window fallback for exact toolboxes

Required rule:

```rust
let should_stay_on_top = matches_target;
set_window_topmost_impl(window, should_stay_on_top, should_promote)?;
```

##### Regression checks

If an exact toolbox still stays above VS Code or another unrelated app until clicked:

- check for any exact toolbox opener still using `focus: true`
- check for any exact toolbox opener still calling `focusExistingWindow(...)`
- check for any exact toolbox opener still calling `applyProgramScopedTopmost(..., true)`
- check `App.tsx` for a focused-window fallback in scoped topmost
- check `main.rs` for a focused-window fallback in `apply_scoped_window_state`

#### What Not To Do

- Do not use imported skin measurement as the geometry owner.
- Do not use generic toolbox grid layout for exact SVG toolsets.
- Do not keep separate visual and clickable sizes.
- Do not open exact toolbox popouts with forced focus if the user is working in another app.
- Do not leave first-open behavior different from steady-state behavior.
- Do not patch symptoms one by one if multiple geometry owners still exist.

#### Validation

After changes:

- run `npm run build` in `<repo root>\FlowCellFrontend`
- if window-host behavior changed, rebuild the packaged Tauri app
- restart the actual `flowcell_frontend.exe` that the user is running

Manual verification for exact SVG toolsets should include:

- the visible capsule matches the SVG
- the hitbox matches the capsule
- the window bounds match the SVG
- the row text sizes reflect the top-level constants
- the tool window does not stay above unrelated apps unless the owning program is the active target

#### Output Expectations

When finishing work under this skill, report:

- which file owns the geometry constants
- whether the SVG was treated literally or whether ambiguity was found
- whether the toolset uses a dedicated exact toolbox path
- whether any top-level scale or row text-size constants were added
- what validation was actually run

## blender-theme

**Use when:** Use when diagnosing, fixing, or extending Blender UI theme color mapping, especially when a FlowCell theme bucket is not hitting the expected Blender surface, when Blender 5.x theme RNA paths differ from older assumptions, or when a user reports that a visible header, panel, highlight, tab, widget, or outliner color is not following the intended theme bucket.


### Blender Theme

Use this skill when a user wants Blender theme buckets mapped correctly, when a screenshot shows the wrong Blender surface color after `Apply`, or when FlowCell theme code under `Blender/ManagedActions/custom_hdri_world_tools.py` needs to be debugged.

#### Quick Workflow

1. Read the narrow live files first:
   - `<repo root>\Blender\ManagedActions\custom_hdri_world_tools.py`
   - `<repo root>\FlowCellFrontend\src\App.tsx`
   - `<repo root>\FlowCellFrontend\src\components\ToolSurfaces.tsx`
   - `<repo root>\PROGRAM_SUMMARY.txt`
2. Check current runtime evidence before guessing:
   - `<repo root>\flowcellbackend\local\logs\frontend-tauri.log`
   - `<repo root>\flowcellbackend\local\logs\command_host.log`
   - `<repo root>\flowcellbackend\local\logs\last_action_status.txt`
3. Separate the problem:
   - If the frontend sampled or staged the wrong hex, fix the FlowCell theme-tool payload or preset builder.
   - If the frontend sent the right hex but Blender still shows the wrong surface, fix the Blender managed action mapping.
4. Validate with the smallest useful test:
   - `python -m py_compile <repo root>\Blender\ManagedActions\custom_hdri_world_tools.py`
   - If needed, send one direct bridge request with `Blender\SupportScripts\Invoke-BlenderFlowCellAction.ps1` instead of repeatedly testing only through the UI.
5. After any managed-action or bridge-path change, tell the user to reload/resync the live Blender add-on/custom-action runtime and re-apply the theme.

#### Verified Blender 5.0 Facts

- Do not assume old nested panel theme paths.
- On this Blender 5.0 install, `theme.user_interface.panel` is not the live panel RNA path.
- The real User Interface panel swatches are direct `ThemeUserInterface` fields such as:
  - `panel_header`
  - `panel_back`
  - `panel_sub_back`
  - `panel_active`
  - `panel_text`
  - `panel_title`
  - `panel_outline`
- Visible accordion-style section headers in Preferences/Themes also use the widget selected-fill path, so `wcol_box.inner_sel` can matter in addition to `panel_header`.
- A fix that only writes older nested `panelcolors.header`-style fields can appear logically correct in code review while still missing the real visible Blender 5.x surface.

Read [references/blender-5-theme-notes.md](./references/blender-5-theme-notes.md) when you need the exact verified RNA fields, bridge paths, or direct diagnostic commands.

#### FlowCell Bridge Model

- The theme tool UI lives in:
  - `FlowCellFrontend\src\App.tsx`
  - `FlowCellFrontend\src\components\ToolSurfaces.tsx`
- The Blender theme mapper lives in:
  - `Blender\ManagedActions\custom_hdri_world_tools.py`
- The command host forwards theme applies through:
  - `flowcellbackend\FlowCellCommandBackend.ps1`
- The direct bridge helper is:
  - `Blender\SupportScripts\Invoke-BlenderFlowCellAction.ps1`
- The configured live Blender bridge root for this sandbox is:
  - `%APPDATA%\Blender Foundation\Blender\5.0\scripts\addons\blender_bridge_flowcell`

#### Troubleshooting Rules

- Trust fresh logs and live bridge responses over memory.
- If a user says a visible surface still did not change, prove whether the wrong value was sent or the wrong Blender field was written.
- Verify the running Blender version and theme RNA before making assumptions about field names.
- Prefer a direct bridge apply when isolating Blender-side mapping. It removes frontend noise and tells you whether Blender accepted the payload.
- If the visible UI still looks wrong after a Blender-side patch, look for a second overlapping path:
  - direct theme-space fields
  - `ThemeUserInterface.panel_*`
  - widget paths such as `wcol_box.inner_sel`
  - editor-specific space or preferences fields
- Keep fixes narrow. Do not rewrite the whole theme mapper when only one surface family is wrong.

#### Validation

- Managed Blender Python changes:
  - `python -m py_compile <repo root>\Blender\ManagedActions\custom_hdri_world_tools.py`
- Useful runtime checks:
  - confirm the sampled/staged hexes in `frontend-tauri.log`
  - confirm the bridge request succeeded in `command_host.log`
  - if needed, use the direct bridge helper and inspect the returned JSON

#### User-Facing Reminder

After changes affecting Blender managed actions, bridge files, or generated runtime paths, explicitly tell the user the required reload step:

- reload/resync the live Blender FlowCell add-on/custom actions
- reopen the `theme` tool if needed
- press `Apply` again

## react-tauri-button-skin-contract

**Use when:** Use when implementing, importing, debugging, or resizing button skins in React/Tauri apps that split functional host logic from render-only button skins, especially for imported HTML/CSS/JS skins, host-vs-skin boundaries, hitbox sizing, label-driven measurement, row-fit rules, or cases where the visual source must remain unchanged.


### React Tauri Button Skin Contract

#### Overview

Use this skill for button systems where a React/Tauri host owns behavior and layout while the skin owns the visual button source. Apply it when a user pastes a button component or imported HTML/CSS/JS and expects that visual source to stay literal while the host handles sizing, hit-testing, persistence, and row placement.

Do not guess on visual behavior. If the exact hover, press, shadow, animation, or sizing rule is unclear, stop and ask.

#### Contract

- State owns identity, persistence, bindings, script targets, labels, selected/active/highlighted/disabled truth, and style assignment.
- Functional host owns behavior, command dispatch, hitboxes, row placement, scaling policy, persistence participation, keyboard routing, and window/popup behavior.
- Visual skin owns visual interpretation only: markup, CSS, animations, glow, shadows, press feel, hover feel, typography, and decorative structure.
- Imported visual source is sacred. Do not rewrite, simplify, normalize, or visually "fix" imported HTML/CSS/JS unless the user explicitly asked for a visual-code edit.

#### When To Use

Use this skill when the task involves any of the following:

- importing a button skin into a React/Tauri app
- keeping pasted visual button code visually identical
- separating host logic from skin visuals
- fixing button hitboxes, shadows, glow, or pointer targets
- label-driven button width measurement
- shared-height rows with variable-width buttons
- JS bridges between a skin and a host
- debugging why a host fix changed hover, press, or animation behavior

#### Required Pipeline

For label-driven buttons, the order matters:

1. Inject the real label into the literal skin.
2. Let the skin render at its native proportions.
3. Measure the core interactive element only.
4. Derive host width from that measured core width.
5. Keep the row on a shared Y height unless the row cap forces uniform downscaling.
6. Use the same core element for the hitbox.

Do not do these in the wrong order:

- do not fix host width first and then shrink text to cram it in
- do not measure wrapper glow or shadow and call that the button
- do not change skin font size or animation just to make layout fit unless the user explicitly asked for that visual change

#### Measurement Rules

- Measure the core button node only, such as `.button`.
- Do not measure decorative wrappers like `.button-wrap`, shadow containers, blur/glow extents, or demo-page wrappers.
- If the imported snippet includes a demo wrapper such as `.body`, neutralize only the outer demo behavior needed to mount it safely. Do not restyle the internal button.
- If width depends on text, insert the real text first and then measure.
- If the row has a hard max span, shrink the shared Y value uniformly for the whole row before mutating text or changing the skin look.

#### Hitbox Rules

- The hitbox should match the core interactive button only.
- Glow, shadow, blur, spread, and outer decorative containers are non-interactive.
- Host wrappers should not steal pointer hits if the bridge target is the actual button.
- Non-interactive wrappers should usually be `pointer-events: none`; only the bridged interactive target should be pointer-active.

#### Row Layout Rules

- Buttons in the same row may vary in X width from their measured label-driven skin width.
- Buttons in the same row should share a common Y height.
- Spacing between buttons should be even.
- If the row exceeds its capped width, reduce the shared Y height uniformly and re-measure.
- Keep multi-word labels on one line by default unless the user explicitly wants wrapping.
- Do not split words or inject line breaks unless the user asked for that behavior.
- Only shrink text inside a fixed-width button when the user explicitly wants fixed-width buttons.

#### JS Bridge Rules

Use a skin bridge when the imported skin needs to talk to the host.

Host to skin inputs:

- label
- active
- highlighted
- selected
- disabled
- target or max height
- placement context

Skin to host outputs:

- measured native width
- measured native height
- core interactive element or hit target
- hover
- press
- focus
- activate

If the skin already has native `:hover` and `:active` visuals, do not mirror host hover/press back into the skin in a way that changes its look.

#### Non-Negotiable Guardrails

- Never "improve" imported visual source during a behavior or layout fix.
- Never change hover/press/rest animations as collateral damage.
- Never use host CSS to reinterpret the skin's visual states unless the user explicitly asked for host-owned fallback visuals.
- Never guess which layer owns the bug. Resolve state vs host vs skin first.
- If the user says the pasted button should look exactly the same, treat that as literal.

#### Debug Workflow

1. Identify the owner layer: state, host, or skin.
2. Verify the real interactive target being measured and clicked.
3. Verify whether the host is sizing from the skin, or cramming the skin into a fixed box.
4. Check whether wrappers are intercepting pointer events.
5. Check row cap logic before changing text or visuals.
6. Validate visually after the change.

#### Output Expectations

When using this skill, explicitly state:

- which layer owned the issue
- whether imported visual source changed
- what node was used for measurement and hit-testing
- whether width came from text-first skin measurement or fixed host constraints
- what validation was run

## appearance-hub-skin-author

**Use when:** Use when producing a button skin to paste into the FlowCell Appearance Hub window (the skin bench opened by the main-page Appearance button). The output is a single text block the user pastes into the hub's "Paste skin" box. This format is defined by `FlowCellFrontend/src/pages/appearance-hub/slotSpec.ts` — if that file and this skill disagree, the spec file wins and this skill must be updated.

### Appearance Hub Skin Author

Produce one paste-ready text block made of `=== slot ===` sections. The hub splits it into slots, sanitizes it, and compiles it into scoped CSS that renders only inside the hub preview. Skins made here follow the same label-first pipeline as live FlowCell buttons (see react-tauri-button-skin-contract): label first, then the skin's own size, and the measured core IS the hitbox.

#### Output Format

```text
=== structure ===
<skin HTML>
=== keyframes ===
<@keyframes blocks only>
=== base ===
<CSS declarations>
=== hover ===
<CSS declarations>
=== pressed ===
<CSS declarations>
=== held ===
<CSS declarations>
=== release ===
<CSS declarations>
=== disabled ===
<CSS declarations>
=== error ===
<CSS declarations>
```

Only `structure` is required. Omit sections the skin does not need. Section names must be exactly: structure, keyframes, base, hover, play, pressed, held, release, disabled, error.

#### Structure Rules

- Must contain `{{label}}` exactly where the label text renders. The hub injects the real label (and handles word-stacking) — never hardcode label text.
- Must contain exactly one element marked `data-core`. That element is the measured button and the hitbox. The paste is rejected with zero or multiple `data-core` markers.
- The `data-core` element should size itself from its content (`display: inline-flex`, padding, `white-space: nowrap`) so the label drives the width. Do not give it a fixed width.
- Decorative parts (glow, shadow casings, outer wrappers) go OUTSIDE the core element and style themselves with inline `style="..."` attributes. They are not clickable.
- No `<script>` tags, no `on*=` event handlers, no `<style>` blocks — they are stripped or rejected.
- No inline `animation:` declarations anywhere in structure — the hub strips them at render time. Motion may ONLY come from `data-anim` tags plus `--anim-*` state-slot rules.
- Use CSS custom properties (`var(--name, fallback)`) in inline styles for anything a state should change, and give every var a fallback.
- Put `transition: ...` on the core's inline style so state changes animate.

#### State Slot Rules

- CSS declarations only, separated by semicolons. NO selectors, NO braces, NO at-rules, NO markup. The hub writes every selector itself.
- Normal declarations (e.g. `background: #123;`) are applied to the `data-core` element.
- Custom-property declarations (e.g. `--fx-edge: #fff;`) are applied to the instance root and cascade into the whole structure — this is how you restyle decorative wrappers per state.
- Forbidden anywhere: `position: fixed`, `javascript:`, `expression(`.
- State meanings: base = resting, hover = pointer over, play = one-shot triggered by click that always runs to completion, pressed = pointer down, held = pointer held down (~400ms), release = just released (brief flash), disabled = not runnable, error = action failed.

#### Keyframes Rules (animation, gated per state)

- The `keyframes` section may contain ONLY `@keyframes` (or `@-webkit-keyframes`) blocks — any other rule gets the section rejected. Prefix names with something skin-specific (e.g. `lsb-spin`) to avoid clashes.
- Animations must never run unconditionally, and must NEVER be wired through CSS variables (`animation: var(--x, none)` is forbidden — Chromium restarts var()-referenced animations whenever any state attribute flips, which shows as glitchy multi-starts). The pattern:
  1. In structure, tag each animated child with `data-anim="<token>"` (lowercase letters/digits/hyphens) and give it NO inline `animation`.
  2. In the state slot that should trigger the motion, write `--anim-<token>: <animation shorthand>;`. The hub compiles this into a real rule: `[state] [data-anim="<token>"] { animation: <shorthand>; }`. Two choices of state:
     - `hover` slot: loops while the pointer stays over the button, cancels instantly on leave (use `infinite`). Good for ambient motion.
     - `play` slot: ONE-SHOT. Use iteration count `1` (e.g. `--anim-spin: lsb-spin 2s ease-in-out 1;`). The host sets `data-play` on pointer-down (click) and holds it until every started animation fires `animationend` — releasing or leaving fast cannot cut it short or restart it, and it cannot re-trigger until it finishes. This is the default choice for "do the animation once per click".
  3. When the state ends, the rule stops matching and the element snaps back to its resting inline pose.
- Never use `infinite` in the `play` slot — an animation that never ends holds the latch until a ~15s safety cap.
- One `data-anim` token per animated element; a single state slot can switch many tokens at once.
- Pseudo-elements (`:before`/`:after`) cannot be styled from inline styles — convert them to real child elements in the structure.
- Keyframes may animate `left`/`right`/`bottom`/`transform`/`max-height`/etc.; CSS animations override inline styles while running, so the base inline values are the resting pose.

#### Sizing Rules

- The label is injected first, the skin renders at natural size, the core is measured, and the measured core rect becomes the hitbox and drives row/fan geometry. Design for variable width; never assume a fixed box.
- In a popout row the whole row downscales uniformly when it exceeds the cap — never shrink text per-button to fit.
- In a fan the same skin renders the owner pill and every child pill, and the collapsed native window equals the owner footprint. Keep decorative overflow (glow) modest.

#### Known-Good Example

```text
=== structure ===
<div style="display:inline-block; padding: 8px;">
  <div data-core style="display:inline-flex; align-items:center; justify-content:center;
    padding: 10px 22px; border-radius: 999px; white-space: nowrap; text-align:center;
    background: var(--fx-bg, rgba(44, 56, 82, 0.9));
    border: 1px solid var(--fx-edge, rgba(126, 150, 210, 0.55));
    color: var(--fx-ink, #e2e9ff);
    font: 600 13px 'Segoe UI', system-ui, sans-serif; letter-spacing: 0.04em;
    transform: scale(var(--fx-push, 1));
    box-shadow: 0 4px 18px var(--fx-halo, rgba(0, 0, 0, 0.35));
    transition: transform 120ms ease, background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, color 160ms ease;">
    {{label}}
  </div>
</div>
=== base ===
--fx-bg: rgba(44, 56, 82, 0.9);
--fx-edge: rgba(126, 150, 210, 0.55);
--fx-ink: #e2e9ff;
=== hover ===
--fx-bg: rgba(56, 72, 108, 0.95);
--fx-edge: rgba(150, 176, 240, 0.9);
--fx-halo: rgba(90, 120, 220, 0.35);
=== pressed ===
--fx-push: 0.94;
--fx-bg: rgba(36, 46, 70, 0.95);
=== held ===
--fx-edge: rgba(255, 196, 110, 0.9);
--fx-halo: rgba(255, 170, 60, 0.25);
=== release ===
--fx-push: 1.03;
=== disabled ===
--fx-bg: rgba(40, 44, 54, 0.6);
--fx-ink: rgba(190, 198, 214, 0.45);
--fx-edge: rgba(120, 128, 150, 0.3);
=== error ===
--fx-edge: rgba(240, 90, 90, 0.9);
--fx-halo: rgba(240, 80, 80, 0.3);
```

#### Guardrails

- The hub is a sandboxed bench: skins pasted there never touch live FlowCell buttons, ImportedSkins, style groups, or flowcell_state.json. Do not try to wire hub skins into live surfaces from this skill.
- Output ONLY the paste block when asked for a skin — no surrounding explanation inside the block.
- Toolsets are out of scope: exact-SVG toolsets forbid imported-skin sizing and use a different geometry contract.
