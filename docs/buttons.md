# FlowCell Button System Owner Map

This is the concise navigation map for the current Button system. It describes
the completed architecture only.

## Non-Negotiable Contracts

- `flowcellbackend/local/button-system/button-state.json` is the canonical
  Button state. It owns Button records, placements, surfaces, skins, regular
  popouts, tool-set popouts, fan setups, and editor settings.
- A script-owning Button owns one installed package under
  `Programs/<Program>/<Program> Local Scripts/<ownerButtonId>/` and one active
  record under `Programs/<Program>/Panels/<Panel>/<ownerButtonId>.flowcell-source.json`.
- Immutable installed code and assets live under the package's `source/` folder.
  Per-Button mutable settings live under `runtime/`; Update preserves that
  folder and Delete recycles it with the owner package.
- `<Program> Git Scripts` is a catalog only. Installing copies from the selected
  source into the owned Local Scripts package; later Git changes do not mutate
  the installed Button.
- The functional host owns behavior, state, accessibility, validation, command
  dispatch, and lifecycle. A skin is render-only.
- A skin must contain exactly one `[data-core]` element and exactly one
  `{{label}}` token inside it. After the label is injected, that exact
  `[data-core]` geometry is the Button hitbox. No rectangular compatibility
  hitbox is placed over it.
- Each placement defaults to matching its hitbox to the skin: the host scales
  the complete authored skin root from the measured `[data-core]`, normalizes
  authored core offsets to the placement origin, and reconciles the saved
  Editor rectangle to that transformed core. Stretching is off by default, so
  width and height stay aspect-locked unless the user explicitly enables
  independent-axis stretching.
- Deleting a source-owning Button removes its entire Button graph, removes its
  owned bindings, cleans program runtime artifacts, and sends the owned Local
  package and active record to the Recycle Bin. The Git Scripts catalog entry is
  untouched.
- Every real `Programs/<Program>/Panels/<Panel>/` folder has one source-free
  `panel-owner` Button on that program's main panel-rail surface. That record is
  the actual selectable main-page panel control, including Utility, and is
  created, renamed, or removed with the panel/program folder lifecycle.
- A saved panel Fan reuses the same `panel-owner` Button and adds an exact Fan
  placement. Main and Fan occurrences may keep distinct placement geometry and
  skin overrides. Selecting `Fan — Default grid` creates a real draft setup
  from the panel's single-script Buttons; merely opening the Editor never
  creates an empty fan setup.
- Legacy program-script records and comment directives are migration input only.
  `FlowCellFrontend/src-tauri/src/program_sources/migrate.rs` is their sole
  reader; it wraps raw legacy sources in owned packages so label, tooltip,
  events, execution target, and bridge data survive. Normal install, list,
  execute, delete, state, and rendering paths do not know those formats.

## Owner/File Map

| Concern | Owner |
| --- | --- |
| Canonical TypeScript schema | `FlowCellFrontend/src/button/types.ts` |
| Default document and validation | `FlowCellFrontend/src/button/state/buttonDefaults.ts`, `buttonStateValidation.ts` |
| Load, install, update, uninstall, and revisioned save client | `FlowCellFrontend/src/button/state/ButtonStateRepository.ts` |
| Draft editing and graph operations | `FlowCellFrontend/src/button/state/ButtonEditorStore.ts`, `ButtonDraftBus.ts`, `buttonDocumentOperations.ts` |
| Canonical panel-rail owner reconciliation and folder lifecycle | `FlowCellFrontend/src/button/state/panelOwnerButtonOperations.ts` |
| Button rendering and interaction | `FlowCellFrontend/src/button/ButtonHost.tsx`, `ButtonRenderer.tsx`, `ButtonSurface.tsx` |
| Main-window Button integration | `FlowCellFrontend/src/pages/main/MainButtonHost.tsx`, `MainPage.tsx` |
| Action dispatch and tool-field payloads | `FlowCellFrontend/src/button/runtime/ButtonRuntimeAdapter.ts` |
| Skin format, parsing, validation, compilation, and rendering | `FlowCellFrontend/src/button/skins/` |
| Exact geometry, label growth, and text fitting | `FlowCellFrontend/src/button/geometry/`, `FlowCellFrontend/src/button/text/` |
| Buttons Editor | `FlowCellFrontend/src/button/editor/` |
| Regular popout runtime | `FlowCellFrontend/src/button/popout/` |
| Fan runtime | `FlowCellFrontend/src/button/fan/` |
| Button window creation and native hit testing | `FlowCellFrontend/src/button/windows/` |
| Window routing and layout restore | `FlowCellFrontend/src/AppBase.tsx`, `FlowCellFrontend/src/lib/windowContext.ts`, `FlowCellFrontend/src/lib/layoutSnapshots.ts` |
| Native canonical-state transaction | `FlowCellFrontend/src-tauri/src/button_state.rs` |
| Program package schema | `Programs/<Program>/flowcell.program.json`, `FlowCellFrontend/src-tauri/src/program_sources/manifest.rs` |
| Source install/update | `FlowCellFrontend/src-tauri/src/program_sources/install.rs` |
| Active record schema and atomic writes | `FlowCellFrontend/src-tauri/src/program_sources/records.rs` |
| Active-source resolution and execution | `FlowCellFrontend/src-tauri/src/program_sources/execute.rs` |
| Owned-source deletion and rollback | `FlowCellFrontend/src-tauri/src/program_sources/delete.rs` |
| One-time migration | `FlowCellFrontend/src-tauri/src/program_sources/migrate.rs` |

## Canonical State Boundary

`button-state.json` stores presentation and interaction state. Program source
records do not store skin, placement, popout, fan, or editor state. Conversely,
Button state identifies an installed source through `sourceIdentity`; it does
not make Git Scripts or a raw path executable.

Native commits are revision checked and atomic. If a save removes a
source-owning Button, the commit must include the exact owner IDs to uninstall.
FlowCell quarantines the owned sources, removes bindings and program runtime
artifacts, writes the new Button document, then recycles the quarantine. A
failure rolls the transaction back.

An import remains staged until the Editor saves the canonical Button document.
Cancel, Reset, and native Editor close discard every staged Local Scripts
package sequentially so shared bindings cannot race. If any uninstall fails,
that owner remains tracked and the Editor stays
open so cleanup can be retried instead of silently orphaning local files.

Buttons Editor addresses one exact occurrence at a time through dependent
Program, Panel, Button, and Placement selectors. Saved Main, Pop, and Fan
choices resolve stable placement IDs and switch the workspace to that exact
surface, where every sibling Button remains visible and directly selectable in
Edit mode. Tool-set children inherit their Program/Panel identity from their
owner for navigation only; canonical identity ownership is unchanged.
Panel-rail Buttons are grouped with the other Buttons for their panel and can be
selected directly in the workspace. When a panel owner has no saved Fan, the
Placement selector offers `Fan — Default grid`; selecting it creates an
undoable draft setup with the panel's single-script Buttons and focuses the real
Fan owner placement. Run preview honors the setup's saved open, close, and
pinned defaults; a default Fan begins collapsed on that owner, expands on hover,
collapses after hover-out when unpinned, pins on click, and collapses on the next
pinned click. Saved Fan placement keeps the owner's surface origin fixed, while
the collapsed semantic frame follows the applied visual envelope and monitor DPI
inside the fixed native canvas, so skin overflow cannot be clipped or shift the
later expanded frame. Generic
Delete Button remains disabled for a `panel-owner`; deleting its panel or program
owns that lifecycle.

Fan Builder lists the current Program/Panel's single-script Buttons and Tool Set
owners by canonical Button ID. Any exact nonempty subset can build a new Fan or
update the active saved Fan. Updating retains the setup identity, surviving
member placement and skin geometry, open/close/pinned rules, animation, and
surviving Tool Set anchors; the panel owner is supplied automatically. On Main,
a nonempty selection takes precedence over saved-Fan shortcuts and the control
reads `Fan (N)`. With no selection, the existing zero/one/many saved-Fan behavior
remains intact.

The edit outline, snapping, surface bounds, and collision checks all use the
same reconciled core rectangle. In normal Edit drag, pointer movement is
sampled continuously, so a fast drag cannot skip a neighboring edge: the Button
stops flush at the furthest valid position and the workspace does not insert
collision warnings that shift the canvas mid-gesture. Reorder is a separate
toggle mode: every Button becomes a direct drag handle, the grabbed Button
follows the pointer at animation-frame speed, and a stable outlined insertion
slot uses hysteresis so animated targets cannot oscillate under the cursor.
Only neighboring Buttons receive the position transition, so they smoothly
move out of the way into a gap-free, undoable saved order with sequential
z-index. `Snap to top left corner` compacts the current saved order from `(0,
0)`, wrapping by the tallest Button in each row and preserving every Button's
width and height. Both actions fail atomically when the complete layout cannot
fit the surface. The
Inspector's `Font size` is a live, nullable placement override; `Minimum size
when shrinking` remains only the text-fit floor. Inspector Label and Font size
changes also publish into a native Pop/Fan opened through the separate `Open
Pop` or `Open Fan` action. The Skin editor's Text Preview Bench is intentionally
preview-only.

Every regular/tool-set Pop and Fan setup has a window-fit mode: saved `surface`,
the union of all Button hitboxes, or the current measured visual union. Selecting
the fit immediately applies it to the draft and draws that exact labeled frame
over the Editor workspace. `Open Pop` and `Open Fan` remain separate native
previews of the same live draft, and Save persists the resting fit.

The native Pop/Fan window is now a non-resizable transparent canvas covering the
active monitor work area, enlarged only when the visible content would escape it.
It starts in Windows click-through mode. Global cursor polling turns input on only
over placement-owned Button hosts, tool fields, or Pop resize handles, then turns
click-through back on immediately after leaving; the rest of the large invisible
window never blocks Blender, Illustrator, or the desktop underneath it.

The visible Pop/Fan frame is absolutely positioned inside that canvas in physical
desktop coordinates. Cropped fits translate the canonical surface inside this
semantic frame, so hover/press/hold/play overflow, Fan expansion, and tool-set
collapse/expansion no longer resize or move the HWND. The canvas grows or rehomes
only at a capacity or monitor boundary, with spare margin during a drag/resize so
the content remains visible across the edge. A Pop without saved desktop bounds
starts at one design pixel per logical desktop pixel. Restored scale comes from
the destination canvas DPI; skin measurements normalize ancestor content scale
while retaining authored and animated shadow/outline scale. One invariant physical
surface origin prevents fit changes and repeated hover cycles from moving the
Buttons or accumulating fractional drift.

Hold Space and drag any visible Button to move the semantic resting frame. Pop
corner handles restore resting geometry first and preserve the aspect ratio and
opposite corner. On release, Pop `desktopBounds`, Fan
`collapsedPanelOwnerBounds`, and layout snapshots store the visible semantic
physical-pixel frame—not the monitor-sized host. Transient active envelopes are
never saved.

Panel and program renames keep stable Button, placement, skin, Pop, and Fan IDs.
The rename migrates canonical source identities, typed execution targets, active
and install records, owned source paths, catalog manifest identity, panel-owner
metadata, Fan scope, Pop member identities, and default surface names. Native
folder/record/bindings work is rolled back if its transaction fails; if the
following canonical save fails, Main verifies whether it landed and reverses the
native rename when it did not. Panel/program deletion removes the owned canonical
graphs and Local Scripts packages before closing removed windows and recycling
the remaining folder.

## Host and Skin Boundary

`ButtonHost.tsx` attaches pointer, keyboard, hover, hold, release, disabled,
error, and execution behavior directly to the compiled skin's `[data-core]`.
`ButtonSkinRenderer.tsx` injects the label, measures that core, and reports visual
overflow separately. With hitbox-to-skin matching enabled, it transforms the
whole authored root uniformly and normalizes the transformed core to the host
origin; `Allow stretching` permits separate X/Y scale. The imported structure
and visual-state source remain unchanged.

The skin compiler disables pointer events everywhere, then enables them only on
`[data-core]`. Transparent Button windows map the physical cursor into the
webview and confirm it with the shadow root's DOM hit test, so the authored core
shape—not its bounding rectangle—decides whether the native window accepts the
cursor. Tool fields use their own explicit control geometry.

Skins may define only structure and visual state sections:

- `structure`, `keyframes`
- `base`, `hover`, `play`, `pressed`, `held`, `release`, `disabled`, `error`

Ordinary Base declarations style `[data-core]`. Nested literal visual elements
must consume state-controlled custom properties, and their resting values must
be initialized explicitly in Base; the editor never rewrites imported nested
markup to simulate that contract.

They may not run code, own actions, mutate Button state, install sources, create
bindings, or define an alternate hitbox.

## Source Lifecycle

1. Add Script or Add Tool Set selects a source file or manifest package. When a
   selected script is the declared entry beside `flowcell.script.json`, FlowCell
   installs the complete package automatically. Selecting a package companion
   directly is rejected instead of creating a broken partial install.
2. Native install validates the program manifest and source contract.
3. FlowCell copies the source package into the owner Button's Local Scripts
   package and writes `flowcell.install.json` inside it.
4. Program-specific deployment runs only when the program runner requires it.
5. FlowCell writes the owner Button's `.flowcell-source.json` active record.
6. The editor adds the returned owner/children/layout to canonical Button state.
7. Runtime execution resolves the active record, verifies its Local package,
   then dispatches through the runner declared by `flowcell.program.json`.

An explicit script package may route its Button through a registered core
action when a FlowCell utility window consumes that installed source. The core
target receives the validated active identity; it does not bypass the owned
Local package or create a program-specific Button in application code.
Catalog core-action IDs are allowlisted during native install; arbitrary or
frontend-only core actions cannot be smuggled in through a source manifest.

Add creates a new owner. Update transactionally replaces that same owner's Local
package and active record, immediately refreshes the canonical execution
targets, and preserves Button IDs, labels, skins, placements, popout/fan
references, and package `runtime/` state. Update rejects changes between
single-script/tool-set roles and rejects added, removed, or renamed tool-set
slots; use delete/re-add when the Button graph itself must change. Delete removes that owner's entire installed
lifecycle. No filename classifier or pre-baked program action is part of this
flow.

See `docs/repository-layout.md`, `docs/flowcell-program-registry.md`,
`docs/flowcell-toolset-manifest.md`, and `docs/blender-scripts.md` for the package
contracts.

## Validation Map

- Documentation-only changes: path existence, heading/link checks, and targeted
  stale-term searches.
- Frontend changes: `npm run build` in `FlowCellFrontend`.
- Rust changes: `cargo check` and focused unit tests in
  `FlowCellFrontend/src-tauri`.
- Program adapter changes: parse/check the adapter and exercise the narrow
  install, execute, update, or delete path.
- Blender deployment changes: reload the FlowCell Blender add-on or restart
  Blender before runtime verification.
