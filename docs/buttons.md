# FlowCell Button System Owner Map

This is the concise navigation map for the current Button system. It describes
the completed architecture only.

## Non-Negotiable Contracts

- `flowcellbackend/local/button-system/button-state.json` is the canonical
  Button state. It owns Button records, placements, surfaces, skins, regular
  popouts, tool-set popouts, fan setups, per-Button activation animations, and
  editor settings.
- A script-owning Button owns one installed package under
  `Programs/<Program>/<Program> Local Scripts/<ownerButtonId>/` and one active
  record under `Programs/<Program>/Panels/<Panel>/<ownerButtonId>.flowcell-source.json`.
- Immutable installed code and assets live under the package's `source/` folder.
  Per-Button mutable settings live under `runtime/`; Update preserves that
  folder and Delete recycles it with the owner package.
- `<Program> Git Scripts` is a catalog only. Installing copies from the selected
  source into the owned Local Scripts package; later Git changes do not mutate
  the installed Button.
- A page-enabled Button is an ordinary single-script owner whose
  `flowcell.script.json` declares a `page`. It installs, updates, executes, and
  deletes through the same Local Scripts and canonical-state transactions as
  every other script Button; the page does not create a Core-owned product
  feature or alternate source lifecycle.
- The functional host owns behavior, state, accessibility, validation, command
  dispatch, and lifecycle. A skin is render-only.
- A skin must contain exactly one measurable `[data-core]` element and may
  contain one `{{label}}` token inside it. After optional label injection, that
  exact `[data-core]` geometry is the Button hitbox. A textless or
  animation-only skin receives no synthesized label, fallback face, or
  rectangular compatibility hitbox.
- A newly authored painted `[data-core]` is the resting clickable body footprint
  and uses neutral render-only markup. Browser controls and invented exterior
  gutters are forbidden authoring patterns. A literal conversion is different:
  the source control's own padding and transparent depth space remain part of
  its box model when they establish the original face, base, or press travel;
  only outer demo/page spacing is removed. Core font metrics freeze the source
  host's resolved size and line height instead of inheriting from each runtime,
  so the same authored geometry reaches Editor/Main/Pop/Fan.
- A Button activation animation stores the sprite's semantic maximum-size
  desktop rectangle, not its transient travel canvas. `Plus Rise` setup renders
  the PNG statically at 100%, locks app-managed edge and corner resizing to the
  source's 283:295 ratio, and saves whole physical pixels. Playback derives a
  larger cursor-ignored transparent canvas without changing the saved rectangle.
- Each placement defaults to matching its hitbox to the skin: the host scales
  the complete authored skin root from the measured `[data-core]`, normalizes
  authored core offsets to the placement origin, and reconciles the saved
  Editor rectangle to that transformed core. Stretching is off by default, so
  width and height stay aspect-locked unless the user explicitly enables
  independent-axis stretching.
- Deleting a source-owning Button removes its entire Button graph, removes its
  owned bindings, cleans program runtime artifacts, and sends the owned Local
  package, `runtime/` state, active record, and managed page window to the
  Recycle Bin lifecycle. The Git Scripts catalog entry and any explicitly
  declared shared program data are untouched because neither is Button-owned.
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
| Script and Tool Set Button binding persistence | `FlowCellFrontend/src-tauri/src/commands/bindings.rs`, `flowcellbackend/local/bindings.ini` |
| Running Tool Set hotkey registration and owner/child delivery | `FlowCellFrontend/src-tauri/src/commands/button_hotkeys.rs`, `FlowCellFrontend/src/button/runtime/toolSetOwnerHotkeyBridge.ts`, `toolSetChildHotkeyBridge.ts` |
| Skin format, parsing, validation, compilation, and rendering | `FlowCellFrontend/src/button/skins/` |
| Exact geometry, label growth, and text fitting | `FlowCellFrontend/src/button/geometry/`, `FlowCellFrontend/src/button/text/` |
| Buttons Editor | `FlowCellFrontend/src/button/editor/` |
| Regular popout runtime | `FlowCellFrontend/src/button/popout/` |
| Fan runtime | `FlowCellFrontend/src/button/fan/` |
| Activation animation presets, sprite assets, and presenter window | `FlowCellFrontend/src/button/animations/`, `FlowCellFrontend/src/assets/button-animations/` |
| Button window creation and native hit testing | `FlowCellFrontend/src/button/windows/` |
| Window routing and layout restore | `FlowCellFrontend/src/AppBase.tsx`, `FlowCellFrontend/src/lib/windowContext.ts`, `FlowCellFrontend/src/lib/layoutSnapshots.ts` |
| Native canonical-state transaction | `FlowCellFrontend/src-tauri/src/button_state.rs` |
| Program package schema | `Programs/<Program>/flowcell.program.json`, `FlowCellFrontend/src-tauri/src/program_sources/manifest.rs` |
| Source install/update | `FlowCellFrontend/src-tauri/src/program_sources/install.rs` |
| Active record schema and atomic writes | `FlowCellFrontend/src-tauri/src/program_sources/records.rs` |
| Versioned bundled-source synchronization | `FlowCellFrontend/src-tauri/src/program_sources/synchronize.rs`, `FlowCellFrontend/src/button/state/ButtonStateRepository.ts` |
| Active-source resolution and execution | `FlowCellFrontend/src-tauri/src/program_sources/execute.rs` |
| Owned-source deletion and rollback | `FlowCellFrontend/src-tauri/src/program_sources/delete.rs` |
| Recoverable JSON source transactions | `FlowCellFrontend/src-tauri/src/program_sources/transaction.rs` |
| Pending install/canonical crash reconciliation | `FlowCellFrontend/src-tauri/src/program_sources/pending_install.rs` |
| Generic installed-page manifest, resource, action, state, and generated-stage validation | `FlowCellFrontend/src-tauri/src/program_sources/installed_page.rs` |
| Installed-page sandbox and trusted host broker | `FlowCellFrontend/src/pages/installed-page/InstalledPageWindowPage.tsx`, `FlowCellFrontend/src/pages/installed-page/installedPageCoreBroker.ts` |
| Managed Add Program/Add Panel plans and durable transactions | `FlowCellFrontend/src/pages/program-setup/`, `FlowCellFrontend/src-tauri/src/commands/programs.rs` |
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
failure rolls the transaction back. A durable journal records the pre-commit
and post-commit phases so startup can roll back interrupted pre-commit work or
finish recycling committed quarantine. Canonical and source JSON writes retain
recoverable staged/backup artifacts until the replacement is proven valid.

An import remains staged until the Editor saves the canonical Button document.
Cancel, Reset, and native Editor close discard every staged Local Scripts
package sequentially so shared bindings cannot race. If any uninstall fails,
that owner remains tracked and the Editor stays
open so cleanup can be retried instead of silently orphaning local files.
Before a normal Add Button source install can cross into canonical state, native
code writes an exact pending-canonical intent. Startup clears it only when the
canonical owner and installed source identity agree; otherwise it uninstalls
that exact active source through the normal durable deletion path. This closes
the crash interval between a successful Local Scripts install and the canonical
Button commit without scanning or deleting unrelated owners.

## Binding Boundary

Existing single-script binds keep their original numbered INI shape:
`Shortcut`, `ScriptPath`, and optional `ProgramTabId`. The resident AutoHotkey
backend registers and executes those paths, so they continue working while the
FlowCell frontend is closed.

A tool-set owner bind uses the same numbered namespace but stores
`TargetKind=tool-set-owner`, its canonical owner as both `ButtonId` and
`OwnerButtonId`, and optional `ProgramTabId`. It never stores `ScriptPath`.
While FlowCell is running, a press is delivered to the Main frontend and uses
the same canonical owner activation as clicking the owner on Main: the first
press opens its managed popout and the next closes it. OS key repeat is ignored
until release so one physical press produces one toggle.

A tool-set child bind stores
`TargetKind=tool-set-child`, the canonical `ButtonId`, `OwnerButtonId`, and
optional `ProgramTabId`. It never stores a command, payload, or field snapshot.
The running Tauri process registers these shortcuts and sends each
press to the active expanded owner popout. That popout validates the current
canonical graph and activates the mounted child through its normal ButtonHost
keyboard path, preserving live tool fields, state-only controls, native field
activation, payload templates, core actions, visual/error behavior, and custom
completion behavior. Closing or collapsing the owner makes that child
bind inactive; it never falls back to a raw source or default payload.

Tool Set owner and child binds accept standard keyboard accelerators supported by the Tauri global
shortcut runtime. Binds rejects AHK-only pass-through, wildcard, hook,
side-specific, key-up, custom-combination, mouse, wheel, and joystick forms.
Save and clear synchronize the running registry immediately; if native
registration fails, the INI change is rolled back instead of leaving the UI and
runtime on different bindings.

In Binds, the Button selector starts with top-level single-script and Tool Set
owners. Selecting an owner inserts only that owner's canonical children into
the selector and scopes Current Panel Binds to the same owner/child group;
children from sibling Tool Sets do not leak into either surface. Selecting a
child leaves that exact child visible as the active binding target.

Owner deletion removes its typed owner and child records by `OwnerButtonId`. Normal source updates
retain canonical child IDs by slot, while delete/re-add creates a new graph and
does not silently reattach old bindings.

Buttons Editor addresses one exact occurrence at a time through dependent
Program, Panel, Button, and Placement selectors. Saved Main, Pop, and Fan
choices resolve stable placement IDs and switch the workspace to that exact
surface, where every sibling Button remains visible and directly selectable in
Edit mode. Tool-set children inherit their Program/Panel identity from their
owner for navigation only; canonical identity ownership is unchanged.

A Button that executes an action or toggles a structural owner may own one
optional activation animation assignment. The
Inspector's `On run` dropdown offers `None` or a registered preset; assigning a
preset opens a dedicated transparent setup presenter. Its temporary resize hit
regions are invisible, so the plus remains the only rendered
content even while positioning. The Inspector's `Save position and size`
control writes the window's physical desktop bounds into the Editor draft, and
normalizes them to whole native pixels before calling Tauri window placement.
This keeps centered half-pixel defaults and older fractional bounds valid. The
main Editor `Save` commits that draft to canonical Button state. Runtime
playback is cursor-ignored and renders only the transparent PNG sprite. It runs
for one second, rising continuously while it fades and grows in, then shrinks
and fades out without reversing its upward motion. It triggers
only on the Button's primary activation event, not on selection or paired
release/hover events. The
setup and runtime presenters are transient and are not restored as open global layout windows;
its saved bounds travel with the shared Button record across Main, Pop, and Fan
placements.
Panel-rail Buttons are grouped with the other Buttons for their panel and can be
selected directly in the workspace. When a panel owner has no saved Fan, the
Placement selector offers `Fan — Default grid`; selecting it creates an
undoable draft setup with the panel's single-script Buttons and focuses the real
Fan owner placement. Run preview honors the setup's saved open, close, and
pinned defaults; a default Fan begins collapsed on that owner, expands on hover,
collapses after hover-out when unpinned, pins on click, and collapses on the next
pinned click. Saved Fan placement keeps the owner's surface origin fixed, while
the collapsed semantic frame follows the applied visual envelope and effective WebView pixel ratio
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
Reorder derives the current visual wrap width and row top offsets before
generating candidates, so every existing row maps to its visible drop target
even when all Button widths would fit in the surface's top row; variable-width
Buttons still rebalance across rows instead of blocking the move.
Only neighboring Buttons receive the position transition, so they smoothly
move out of the way into a row-aligned, undoable saved order with sequential
z-index. `Snap to top left corner` compacts the current saved order from `(0,
0)`, wrapping by the tallest Button in each row and preserving every Button's
width and height. Both actions fail atomically when the complete layout cannot
fit the surface. The
Inspector's `Font size` is a live, nullable placement override; `Minimum size
when shrinking` remains only the text-fit floor. Inspector Label and Font size
changes also publish into a native Pop/Fan opened through the separate `Open
Pop` or `Open Fan` action. Editing actual skin source while focused on a
program panel immediately assigns that skin to every Button placement on that
panel surface without reassigning placements elsewhere. Because skin records
are shared, any placement already referencing that skin ID also renders the
source edit. The Inspector's `Use this size for every Button on this surface`
checkbox applies the focused placement's width and height to every placement,
switches them to fixed host sizing, disables label-driven growth, and compacts
the complete surface with zero gap in one undoable transaction. The linked size
is saved on the surface, so later numeric or canvas resizing updates every member
atomically and delayed skin/text measurements cannot split the sizes. Unchecking
stops linking future size edits but deliberately keeps the current fixed geometry;
Undo restores the pre-enable layout. The Skin Editor's `Button Text` label field
edits the real saved Button label and updates the live draft; only its stack,
font-size, minimum-size, and measurement controls remain preview-only.

Every regular/tool-set Pop and Fan setup has a window-fit mode: saved `surface`,
the union of all Button hitboxes, or the current measured visual union. Selecting
the fit immediately applies it to the draft and draws that exact labeled frame
over the Editor workspace. `Open Pop` and `Open Fan` remain separate native
previews of the same live draft, and Save persists the resting fit.

The native Pop/Fan window is now a non-resizable transparent canvas covering the
active monitor work area, enlarged only when the visible content would escape it.
It starts in Windows click-through mode. The shared native input stream turns input on only
over placement-owned Button hosts, tool fields, or Pop resize handles, then turns
click-through back on immediately after leaving; the rest of the large invisible
window never blocks Blender, Illustrator, or the desktop underneath it.

That geometry gate is subordinate to the native program-scope gate. Only the
exact foreground executable declared by the owning program manifest may make a
Pop/Fan topmost. Clicking one of its FlowCell controls continues in the normal
window band only while the last proven external foreground belongs to that same
program. A taskbar preview or any unrelated program explicitly places the window
behind the real foreground HWND and forces the whole host back to click-through.
Scope/listener and cursor-style failures retry automatically and remain
click-through until native state is proven active.

The visible Pop/Fan frame is absolutely positioned inside that canvas in physical
desktop coordinates. Cropped fits translate the canonical surface inside this
semantic frame, so hover/press/hold/play overflow, Fan expansion, and tool-set
collapse/expansion no longer resize or move the HWND. The canvas grows or rehomes
only at a capacity or monitor boundary, with spare margin during a drag/resize so
the content remains visible across the edge. A Pop without saved desktop bounds
starts at one design pixel per WebView CSS pixel. Restored physical bounds use
the destination WebView's effective pixel ratio; skin measurements normalize ancestor content scale
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
folder/record/bindings work and the following canonical save share a durable
token. Its stable local journal stores exact pre/post bindings and canonical
Button documents, so startup deterministically rolls back before the canonical
commit or finalizes after it, including a process cut during a case-only folder
rename. Program removal unregisters under an opaque native
rollback snapshot before canonical/source cleanup; canonical failure restores the
registration only while bindings still match the post-unregister state, and the
available program package remains in place. Removed Pop, Fan, and generic
installed-page windows close best-effort after commit; installed-page close
waits out an in-flight open so a stale page cannot appear after deletion or
rename. Panel deletion holds the source quarantine guard and refuses to
recycle a panel if an active source appeared during the canonical/native handoff.

## Host and Skin Boundary

`ButtonHost.tsx` owns pointer, keyboard, hover, hold, release, disabled,
error, selection, and execution behavior. The compiled skin's `[data-core]`
is the measured and accessible geometry and the only node with Button input
listeners. The shadow host remains browser-reachable so its core can receive
events, but unused host gutters perform no activation and add no functional
hitbox.
`ButtonSkinRenderer.tsx` injects the label only when the skin includes
`{{label}}`, measures the core, and reports visual overflow separately. With
hitbox-to-skin matching enabled, it transforms the
whole authored root uniformly and normalizes the transformed core to the host
origin; `Allow stretching` permits separate X/Y scale. The imported structure
and visual-state source remain unchanged.

The skin compiler keeps wrappers, decorative children, shadow, glow, and visual
overflow pointer-inert while enabling only `[data-core]`. Transparent Button
windows map the physical cursor into the webview through the live
`devicePixelRatio` (with native DPI as fallback), discover cores through their
placement hosts, and test each live core rectangle. Unused placement gutters
therefore remain click-through. Tool fields and resize handles use their own
explicit control geometry.

Main-page selection adds no border, outline, or overlay. A selected Button
stays in that skin's existing pressed state until deselected; transient pointer
press state remains separate so native hover-out behavior still completes.

Skins may define only structure and visual state sections:

- `structure`, `keyframes`
- `base`, `hover`, `play`, `pressed`, `held`, `release`, `disabled`, `error`

A new skin, conversion, or complete replacement includes every canonical
header, even when an optional section is empty, so old keyframes and state
declarations are cleared. Omitted headers are reserved for deliberate partial
section updates. React/styled-components conversions remove component code and
replace `button`, anchor, and form-control elements with neutral `div`/`span`
markup before validation, but preserve the source control's visual box model,
stacking, colors, radii, gradients, shadows, transitions, and existing states.
Pseudo-elements become equivalent real decorative children. Missing source
states stay empty, and a requested color-only edit changes no geometry.

Ordinary Base declarations style `[data-core]`. Nested literal visual elements
must consume state-controlled custom properties, and their resting values must
be initialized explicitly in Base; the editor never rewrites imported nested
markup to simulate that contract.

They may not run code, own actions, mutate Button state, install sources, create
bindings, or define an alternate hitbox.

Activation sprites and their motion are host/runtime features, not Button
skins. A sprite preset never changes the authored skin source or core hitbox.

## Source Lifecycle

1. Add Button starts from the selected Program and Panel, opens the Editor in Add
   mode, and locks that destination. The library offers only `Choose Button
   file...` and `Choose Button package folder...`.
2. Native auto-detection treats a raw file as a script, the exact root
   `flowcell.script.json` as a script package, and the exact root
   `flowcell.toolset.json` as a Tool Set package. A folder containing both root
   manifests is ambiguous, and a folder containing neither is invalid. Nested
   manifests do not classify the selected folder.
3. When a selected script is the declared entry beside
   `flowcell.script.json`, FlowCell installs the complete package automatically.
   Selecting a package companion directly is rejected instead of creating a
   broken partial install.
4. Native install validates the program manifest and source contract.
5. FlowCell copies the source package into the owner Button's Local Scripts
   package and writes `flowcell.install.json` inside it.
6. Program-specific deployment runs only when the program runner requires it.
7. FlowCell writes the owner Button's `.flowcell-source.json` active record and
   records the pending canonical intent.
8. The Editor adds the returned owner/children/layout to canonical Button state;
   the successful commit clears the pending intent.
9. Runtime execution resolves the active record, verifies its Local package,
   then dispatches through the runner declared by `flowcell.program.json`.

`flowcell.program.json` may also declare versioned `bundledSources`. Add Program
persists the exact selected contribution IDs, versions, and destination Panels
under `flowcellbackend/local/program-registration/<programId>.json`. Normal
startup synchronizes only registered programs and only contributions in that
enabled set. `installOnAdd` selects a contribution in the default Add Program
plan but does not resurrect it after deletion. An enabled `installIfMissing`
contribution is the only missing source startup repairs. Existing managed
owners update through the normal source transaction, preserving owner ID and
canonical presentation.

Add Button creates a new owner. Update transactionally replaces that same
owner's Local package and active record, immediately refreshes the canonical execution
targets, and preserves Button IDs, labels, skins, placements, popout/fan
references, and package `runtime/` state. Update rejects changes between
single-script/tool-set roles and rejects removed or renamed tool-set slots.
A bundled package may opt into `layout.updatePolicy.appendMissingChildSlots` to
append new release-owned child slots while preserving every existing child ID
and placement; other graph changes still require delete/re-add. Delete removes
that owner's entire installed lifecycle. No filename classifier or pre-baked
program action is part of this flow.

## Page-Enabled Script Packages

A `flowcell.script.json` package may declare one strict `page` object containing
its ID/program/label, entry HTML, explicit script/style/asset paths, window
settings, declared actions and capabilities, owner-state format, optional
shared program-data namespace, supported data formats, refresh events, and
package config. The declaration is part of the immutable installed `source/`
tree. All resource paths are owner-contained and links/reparse points are
rejected. Install assigns only the generic `open-installed-page` execution
target; packages cannot declare that reserved target themselves.

The trusted host mounts a raw WRY child WebView without Tauri initialization
scripts. A package-only custom protocol serves sanitized entry HTML and only
declared resources under a deny-by-default CSP. Native handlers reject
navigation, new windows, downloads, drag/drop, clipboard/browser features,
developer tools, network access, direct filesystem/process access, forms,
nested frames, workers, and undeclared resources. A native default-world probe
must prove that Tauri, Node, and privileged globals are absent before the child
is enabled. The child receives only public page metadata and a nonce-bound
`flowcellPage.request(actionId, payload)` IPC bridge; trusted owner, source, and
path identity remain in the parent/native broker. Requests must match the nonce
and 1 MiB limit and name an exact declared action.

Every action has closed request and response JSON schemas and one handler:

- `program` delegates a declared capability to the program runner adapter;
- `owner-state` reads or writes the strict
  `runtime/installed-page-state.json` envelope for that owner;
- `core` requests one generic allowlisted host service such as file/folder
  selection, palette sampling, declared field/package storage, or authenticated
  generated-Button installation.

Native code re-resolves the exact active installed owner/page/action and
validates capability plus request schema before dispatch. A Core service returns
a plan to the trusted host; native code re-resolves the identity again and
validates the response schema before anything is returned to the child WebView. No
product name, page label, source filename, or catalog path selects behavior.

Blender Theme and Illustrator Layer Tree are ordinary program-owned examples of
this contract. Their UI, assets, configuration, actions, helpers, and runtime
behavior live in their Blender/Illustrator source packages, not in Core. Update
replaces their installed source through the normal owner transaction. Delete
closes the page and removes the canonical graph, bindings, active record,
source-owned program deployment artifacts, complete Local Scripts package, and
owner runtime state; a stale page action then fails active-owner resolution.

For `button.install-generated`, native code derives the only permitted stage
root, namespace, format, program, and import kind from the active page action.
It requires the exact `staging/<token>/source/flowcell.script.json`, rejects
links/reparse points and traversal throughout the bounded stage tree, validates
closed `stage.json` metadata, and verifies both manifest and script SHA-256
digests before the trusted host performs a normal Add Button install. A durable
cleanup journal removes the authorized short-lived stage after success or on
startup after a crash; drift is preserved for inspection instead of being
deleted broadly.

## Managed Program And Panel Setup

Add Program inventories only unregistered `Programs/<Program>` packages whose
`flowcell.program.json` fully validates. The manifest is authoritative for the
host executable suggestion, Panels, contribution versions/types/defaults,
dependencies, destination Panels, support content, reload/restart notes, and
listed install effects. The user confirms the host EXE and chooses one reviewed
plan: `Register program only`, `Add everything`, or `Custom`. Required sources
and dependency closure cannot be deselected. Register-only writes an empty
enabled-contribution set and creates no source Button.

The reviewed plan is one durable transaction across rail registration, enabled
contribution state, selected Panel roots/owners, ordinary source installs, and
the canonical Button commit. Startup finalizes only when exact canonical
Buttons, active records, source identities, Panels, and Tool Set graphs match;
otherwise it rolls the proved transaction back without overwriting unrelated
state.

Add Panel creates either an empty managed Panel or a managed copy of one
external source folder. Preflight reports the exact destination and copy
file/byte count. The external source is read-only, and links/reparse points,
traversal, active/install records, and transaction artifacts are rejected. A
same-name existing Panel is an idempotent owner reconcile. A new Panel is
staged and published with its canonical `panel-owner` in one recoverable
transaction; rollback sends only the transaction-created managed destination to
the Recycle Bin.

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
