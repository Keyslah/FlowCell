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
- A placement may own one activation cycle with at least two ordered states.
  Two states are the On/Off toggle; larger counts use the same model. State 1 is
  initial, every state owns one `press`, `hover`, or `release` advance trigger,
  one label, one canonical skin visual, and optional partial-JSON action-response
  matches. Ordinary cycles wrap to State 1. Result-mapped cycles wait for the
  authoritative action response and may be initialized by their Tool Set's
  package-owned read-only state query. The active index remains session-only and
  keyed by placement ID. The host that receives a response updates itself before
  broadcasting the exact index to other mounted copies, so transport success
  without an active Main coordinator cannot leave a Pop at its initial state.
  Neither the live index nor an executable action is stored in the Button settings file.
- Legacy Button-owned `momentary`, `toggle`, and `cycle` records remain a read
  compatibility path only when a placement has no new activation cycle.
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
- Each placement stores one of three host-owned sizing behaviors. Responsive
  gives `[data-core]` the exact independent placement width and height and does
  not scale the authored root; a translation-only normalization aligns any
  authored resting core offset to the placement origin. Proportional uniformly
  scales the complete authored root from its measured natural ratio and
  aspect-locks resizing. Stretch explicitly scales X and Y independently and can
  distort the visual. All three leave skin source literal.
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
  skin overrides. The Editor lists only real saved Fan placements; it has no
  Fan construction or membership controls and never fabricates a default Fan.
  Main's existing selected/generic Fan commands and the complete saved Fan
  runtime remain authoritative.
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
| Finite visual-presentation latching | `FlowCellFrontend/src/button/runtime/buttonVisualLatch.ts`, `FlowCellFrontend/src/button/skins/ButtonSkinRenderer.tsx` |
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
Editor skin, assignment, Button Text, animation, and settings-default writes
retain a frozen requested scope and retry up to three times after the exact
revision-conflict response. Each retry reloads canonical state and rebuilds only
that scope, preserving unrelated commits and concurrent deletions.

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
the canonical managed owner toggle directly: the first press opens its popout
and the next closes it. Main's ordinary owner click remains selection-only and
does not share this hotkey behavior. OS key repeat is ignored until release so
one physical press produces one toggle.

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

Illustrator has one bind-only Core action at `Illustrator / Actions / Set
Anchor`. It is not a canonical Button or tool-set child. Its shortcut lives in
`ActionHotkeys`, is registered by the resident backend only while Illustrator is
foreground, and runs the shipped Set Anchor helper through immediate foreground
Illustrator automation. The helper stores the selected visible-bounds box and
center for the alignment and rotate tools. Its registration is pass-through, so
the same keystroke still reaches Illustrator and retains its native command; the
capture completes before the action returns so a subsequent selection cannot be
mistaken for the anchor.

In Binds, the Button selector starts with top-level single-script and Tool Set
owners. Selecting an owner inserts only that owner's canonical children into
the selector and scopes Current Panel Binds to the same owner/child group;
children from sibling Tool Sets do not leak into either surface. Selecting a
child leaves that exact child visible as the active binding target.

Owner deletion removes its typed owner and child records by `OwnerButtonId`. Normal source updates
retain canonical child IDs by slot, while delete/re-add creates a new graph and
does not silently reattach old bindings.

Buttons Editor is a polished three-pane workspace. The left pane owns dependent
Program, Panel, Button, and Placement selectors plus placement controls; the
center pane shows the complete editable Button surface; the right pane owns the
Skin Editor. Saved Main, Pop, and Fan choices resolve stable concrete surface
identities and switch the workspace to that exact existing surface, where every
sibling Button remains visible and directly selectable in Edit mode. The
Placement selector displays only `Main Page`, `Fan`, or `Pop-out`; a tool-set
child surface is a Pop-out. Tool-set children inherit their Program/Panel identity
from their owner for navigation only; canonical identity ownership is unchanged.
Source/package actions are not exposed as an Editor pane.

`Save Main Page Settings`, `Save Fan Settings`, or `Save Pop-out Settings` opens
a native file-save dialog in the matching `flowcellbackend/local/Button
editor/Main Page`, `Fan`, or `Pop-out` folder. It writes a strict named
`.flowcell-button-settings.json` v1 file containing the selected surface's exact
ordered Button membership and complete presentation: surface frame and optional
uniform size; every placement's rectangle, z-index, text, sizing, hover highlight,
activation cycle, and visual mapping; each effective literal skin; shared labels,
activation behavior, and activation animations; and the applicable Pop/Fan
container behavior. Execution targets, action/source packages, live activation
state, and managed desktop window layout are excluded. The same action performs
the revision-safe scoped canonical commit; it is not Save Layout. The left rail
retains the existing Edit/Run switch for workspace execution and activation
preview.

`Load {type} Settings` is directly below Save and opens the matching type folder.
Load fails closed unless the file matches the settings category and concrete
surface subtype and every saved Button ID is still installed. Cross-surface reuse
must also match the selected Program and Panel; a file tied to the same stable
surface ID remains valid after a Program or Panel rename. It replaces only the
selected surface with the file's exact Button amount, order, frame, presentation,
and container behavior as one undoable Editor draft. Buttons omitted by the file
leave that surface, but their canonical action records and occurrences elsewhere
remain intact. Tool-set settings may reorder and restyle only the exact current
package-owned children; they cannot add or remove actions. `Save {type} Settings`
is still required to commit a loaded draft.

`Load {type} Default` and `Update {type} Default` appear directly below Load.
Defaults are keyed by concrete surface in an internal store under the matching
type folder. If a surface has no default yet, its current committed state is
captured lazily as the initial default. Load stages that snapshot, while Update
atomically replaces it with the current Editor draft after confirming the
canonical revision.

Main places `Open Pop` immediately left of `Pop`. `Open Pop` opens a native
picker in the Pop-out settings folder, validates the chosen regular or Tool Set
file against currently installed Buttons in the selected Program/Panel, and
materializes its ordered presentation in a temporary in-memory Button document.
That document reaches a uniquely owned Pop window through a draft session. It
is never loaded into an Editor surface, saved as Button state, published as a
canonical commit, or registered in Save Layout. Main remembers only the
successful `{ path, choiceId }` locally under the stable panel-owner Button ID.
`Pop` reloads that panel's last-used file independently of Main Button
selection; when none exists it directs the user to `Open Pop`.

A Button that executes an action or toggles a structural owner may own one
optional activation animation assignment. The left-pane `Animation` control
opens a dedicated Animation page. That page preserves the complete feature: its
selector offers `No animation` and every registered preset, Apply clears or assigns the
selection, and an assigned preset retains Position and size setup, Save position
and size, and Close setup controls. A top-right X returns to placement editing and
closes an open setup presenter without clearing the saved assignment. Animation
Apply and bounds saves commit only the Button's animation field, retaining any
unsaved arrangement; full Button Settings also save and restore the current
animation assignment. The transparent setup presenter keeps its
temporary resize hit regions invisible, so the sprite remains the only rendered
content while positioning. Saving bounds writes whole physical desktop pixels
to the Button record before applying native placement, preserving centered
half-pixel defaults and older fractional bounds. Runtime playback remains
cursor-ignored and renders only the transparent sprite. `Plus Rise` rises
continuously while it fades and grows in, then shrinks and fades out without
reversing its upward motion. Playback triggers only on the Button's primary
activation event, not on selection or paired release/hover events. Setup and
runtime presenters are transient and are not restored as global layout windows;
saved bounds travel with the shared Button record across Main, Pop, and Fan
placements.
Panel-rail Buttons are grouped with the other Buttons for their panel and can be
selected directly in the workspace. The Placement selector exposes a Fan only
when that saved Fan placement already exists; there is no synthetic default-Fan
choice and no editor-side Fan creation or membership editor. Existing saved Fan
Run preview still honors its saved open, close, and pinned defaults: it begins
collapsed on the real panel owner, expands on hover, collapses after hover-out
when unpinned, pins on click, and collapses on the next pinned click. The saved
Fan placement keeps the owner's surface origin fixed, while the collapsed
semantic frame follows the applied visual envelope and effective WebView pixel
ratio inside the fixed native canvas, so skin overflow cannot be clipped or
shift the later expanded frame. Panel/program lifecycle still owns removal of a
`panel-owner` and its dependent saved Fans.

The Button Editor neither creates Fans nor changes saved Fan membership. Main
retains its existing selected/generic Fan commands and saved-Fan runtime. On Main,
one ordinary click toggles the exact script, macro, or Tool Set owner selection;
it never executes the Button or opens the Tool Set. Double-clicking runs that
Button's primary action directly on Main, including opening or toggling a Tool
Set owner. A nonempty selection takes precedence over saved-Fan shortcuts and
the control reads `Fan (N)`. `Pop` opens that exact selection. Once popped out,
an ordinary click runs the Button. With no selection, the existing zero/one/many
saved-Fan behavior remains intact.

The edit outline, snapping, surface bounds, and collision checks all use the
same reconciled core rectangle. In normal Edit drag, pointer movement is
sampled continuously, so a fast drag cannot skip a neighboring edge: the Button
stops flush at the furthest valid position and the workspace does not insert
collision warnings that shift the canvas mid-gesture. Reorder is a separate
toggle mode: every Button becomes a direct drag handle, the grabbed Button
follows the pointer at animation-frame speed, and a stable outlined insertion
slot uses lane-scoped, slot-bounded hysteresis so animated targets cannot
oscillate under the cursor without making thin rows or row boundaries unreachable.
Reorder infers exact visual row membership before generating candidates. Every
slot in every existing row is distinct, including end-of-row versus start of the
next row, and explicit row-boundary candidates allow the dragged Button to create
a new row. Buttons that are not being dragged never rebalance into another row;
an over-wide requested row fails atomically.
Only neighboring Buttons receive the position transition, so they smoothly
move out of the way into a row-aligned, undoable saved order with sequential
z-index. `Snap to top left corner` left-packs the Buttons in each existing row and
then stacks those same rows upward from `(0, 0)`. It does not change row count,
membership, order within a row, width, or height. Both actions fail atomically
when the complete layout cannot fit the surface. The right pane's Button Size
section uses a working preview: width, height, and Responsive, Proportional, or
Stretch behavior do not change a placement until an explicit size assignment.
Responsive constrains the core to the exact independent width and height without
root scaling; Proportional uniformly transforms the root and keeps the current
ratio; Stretch transforms X and Y independently. `Assign Size` applies that
working size and rule only to the focused placement. `Assign Size to Panel`
applies that target box once to every Button next to the edited placement on its
current Main, Pop, Fan, or other Button surface, and compacts that same surface
atomically when it fits. Responsive and Stretch use
the exact target dimensions; Proportional keeps each Button's measured natural
aspect when available and otherwise its current aspect inside the target. Both size actions disable later label-driven geometry
growth so text edits cannot silently change the assigned box. They do not set or
update the separate legacy uniform-size field. Existing saved text-size and minimum-shrink values
remain honored by the host. Skin source and paste edits stay in an isolated
working copy until an explicit Save or Assign action. The
left rail's `Same size Buttons` checkbox applies the focused placement's width
and height to every placement, switches them to fixed host sizing, disables
label-driven growth, and compacts the complete surface with zero gap in one
undoable transaction. The linked size is saved on the surface, so later canvas
resizing updates every member atomically and delayed skin/text measurements
cannot split the sizes. Unchecking stops linking future size edits but
deliberately keeps the current fixed geometry. The Skin Editor toolbar is ordered
`Assign Skin`, `Assign Skin to Panel`, `Load skin`, `Save skin`, and `Save as new
skin`. Load offers recent files first, saved library skins second, and `Browse...`
last; every choice changes only the working copy. Recent file paths and their skin
IDs are machine-local and capped at eight. Assign Skin writes only the focused
placement override and forks an edited shared skin, including the document-wide
default skin, first; it never changes the
Button's default skin or sibling placements. Assign Skin to Panel is the explicit
surface-wide action and targets every Button on the focused placement's current
surface, whether that placement is on Main, a regular Pop, a Fan, or a tool-set
Pop. Occurrences of the same Button on other surfaces remain unchanged. A
recognized paste updates an always-visible
working preview even when WebView exposes the paste only through the textarea's
normal input event, then clears the transient Paste Skin field after distributing
the source into its canonical section editors. Unparseable paste remains in the field
for correction. Browse, first-time Save skin, and Save as new skin all default to
`flowcellbackend/local/Button editor/Skins`. Save skin overwrites its associated
file, or opens the picker when it has no file yet, and updates the same library
entry. Save as new skin always opens the picker, writes canonical paste-ready
`.flowcell-button-skin.txt` source, and creates an unassigned library entry named
exactly from the chosen filename stem. Skin saves retain unrelated
draft geometry. Button States & Behavior is one compact cycle editor. `Number of
states` accepts 2 through 64; two is labeled as On/Off but stores no separate mode.
It generates one row per state, with State 1 marked Initial and one `Advance on`
dropdown containing only Press, Hover, and Release. A second compact row selects
one logical State and one skin-dependent Visual state. The actual skin renderer
below it updates immediately to that state label and visual. One press/release
gesture can advance at most once, pointer/key cancellation is not Release, and a
real pointer entry advances Hover only once until the pointer leaves. The session
index is not saved and starts at State 1 after an app restart.
The configured state's visual is the latched resting appearance. For an unchanged
compiled skin, each newly applied visual is held through any finite CSS animation
or transition in its subtree. Hover, Pressed, Held, Play, Release, label, highlight,
and activation-result changes continue updating one latest desired presentation
without replacing or restarting that active motion; the newest presentation is
applied when the finite motion ends. A requested Pressed, Play, or Release
presentation is committed after native window preparation even if pointer-up or
an action response has already requested the next appearance, so a fast result
cannot erase the authored activation before its first painted frame. Finite motion
waits on the Web Animations completion signal rather than interval polling.
Infinite-only motion never blocks. Another
activation while Play is active still executes but does not restart or queue the
Play visual. Error and Disabled remain the highest-priority desired visuals and do
not cut short an already-latched finite presentation. The configured visual also
remains authoritative when the host is merely selected, so selection does not
silently replace it with Pressed.

The deployed host reference is
[buttonVisualLatch.ts](../FlowCellFrontend/src/button/runtime/buttonVisualLatch.ts)
plus
[ButtonSkinRenderer.tsx](../FlowCellFrontend/src/button/skins/ButtonSkinRenderer.tsx);
the exact protected activation/result handoff is executable in
[buttonSystem.test.mjs](../FlowCellFrontend/tests/buttonSystem.test.mjs).

Only nonempty authored transient sections participate in a placement cycle's visual
resolution. An empty Pressed, Held, Play, or Release section falls through to the
next authored input state or the configured resting visual. A completed Hover target
therefore stays continuously applied through such an interaction instead of being
removed and re-entered, so its transition does not replay.
The same section has a placement-only `Highlight on hover` checkbox. It defaults
off and applies a small host brightness lift only while the exact placement is
hovered, without editing skin source or changing `[data-core]` geometry or hit testing.
The raw Base, Hover, Play, Pressed, Held, Release, Disabled, and Error skin code
sections remain author-editable; selecting Hover in a dropdown never replaces or
hides the authored Hover section. The visual-state menu reflects the working skin
and offers Base plus its nonempty canonical visual sections. A saved visual that
is no longer authored remains visibly unavailable until the user chooses another;
it is never silently rewritten. Fit mode, horizontal text alignment (`Use skin`, `Left`, `Center`, or
`Right`), text size override, minimum shrink size, and pixel X/Y text position
are independent focused-placement settings. Every edit immediately updates the
Button Text preview. When a cycle exists, Button Text contains the same State
dropdown and edits only that state's label; otherwise it edits the base Button
label. X/Y moves static host-injected HTML labels with flow-preserving relative
positioning, composes movement without replacing the positioning model of an authored
positioned label, and converts screen-pixel offsets to SVG label-line user units. It remains effective
if a visual state switches the core among inline, block, flex, or grid layout, without
rewriting authored skin source, authored transforms, core geometry, or hit testing.
Text offset composition is refreshed during visual transitions so authored translation
or SVG scaling cannot leave a stale X/Y result. The single `Apply All`
at the bottom of Button Text commits only the base/state labels and those
focused-placement text settings; it does not apply cycle IDs, triggers, visuals,
skin code, Button Size, or placement geometry. Changed cycle IDs must first be
persisted with Save Settings. Save Settings retains the complete placement-owned
hover highlight, cycle, and text policy. `Use skin` removes the alignment override and restores the authored
alignment. There are no Apply Named Sections or Replace Entire Skin buttons.
For a configured cycle, Apply All preserves the shared base Button label. Without a
placement cycle, it mirrors the edited base label into legacy activation-state labels
so the compatibility runtime matches the preview.
Pasting a recognized payload automatically validates and applies its named
sections to the isolated working copy.

Cycle structure, triggers, state labels, and visual selections all belong to the
focused placement because both the desired behavior and available visuals may
differ between placements of the same Button. Save skin continues to save only
authored visual source to its portable file and library entry; it never saves or
mutates the placement cycle.
Changing shared skin source can affect every inheriting placement and tool-set
child. The safe default is to fork and assign a placement override; a panel-wide or
global change must be explicit and show its blast radius before it is applied.

Every regular/tool-set Pop and saved Fan setup retains its stored window-fit
mode: surface, hitbox union, or measured visual union. The runtime continues to
honor those persisted values; the streamlined Editor adds no separate native
preview or fit controls.

The native Pop/Fan window is now a non-resizable transparent canvas covering the
active monitor work area, enlarged only when the visible content would escape it.
It starts in Windows click-through mode. The shared native input stream turns input on only
over placement-owned Button hosts, tool fields, or Pop resize handles, then turns
click-through back on immediately after leaving; the rest of the large invisible
window never blocks Blender, Illustrator, or the desktop underneath it. Once a
Button receives pointer-down, native input stays enabled through pointer-up even
if its authored animation moves or shrinks the live core away from the cursor.
That preserves the release event that dispatches the click, after which ordinary
live-core gating resumes.

That geometry gate is subordinate to the native program-scope gate. Only the
exact foreground executable declared by the owning program manifest may make a
Pop/Fan topmost. An explicit open from FlowCell is reapplied after the window is
shown at the front of the normal band with input entitlement. That grant follows
the opening FlowCell window and then the revealed Pop/Fan itself; focusing
anything else ends it. Layout restore is passive and does not claim the reveal.
A taskbar preview or any unrelated program explicitly places the window behind
the real foreground HWND and forces the whole host back to click-through.
Activating Illustrator instead uses its exact owner-bound topmost state.
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
`{{label}}`, measures the core, and reports visual overflow separately. Responsive
sizing constrains the core to the exact host width and height and skips root
scaling while translating any authored resting core offset back to the host
origin. Proportional sizing transforms the whole authored root uniformly and
normalizes the transformed core to the host origin; Stretch permits separate X/Y
scale. The renderer also owns the applied-presentation latch: it lets an active
finite skin transition or animation finish before atomically applying the newest
requested state attributes, label, placement highlight, and measurement state.
Authored Pressed, Play, and Release presentations survive asynchronous native
window preparation long enough to paint and expose that motion; later action
results remain desired state until completion.
Functional pointer attributes and backend execution remain immediate. A compiled
skin ID or source-fingerprint change resets the latch so the new source can mount.
The imported structure and visual-state source remain unchanged.

Text fitting measures the injected label glyphs against the constrained core,
not the core's complete padded or scroll box. `Shrink` is always one unbroken
row; only `Stack whole words` and `Shrink and stack` create explicit whole-word
line spans. Painted visual rectangles with any non-finite edge are discarded,
and measurement normalization falls back to the core edge, so preview overflow
cannot report `NaN`. These host rules do not rewrite skin source or alter the
`[data-core]` hitbox.

The skin compiler keeps wrappers, decorative children, shadow, glow, and visual
overflow pointer-inert while enabling only `[data-core]`. Transparent Button
windows map the physical cursor into the webview through the live
`devicePixelRatio` (with native DPI as fallback), discover cores through their
placement hosts, and test each live core rectangle. Unused placement gutters
therefore remain click-through. Tool fields and resize handles use their own
explicit control geometry.

Main-page selection adds no border, outline, or overlay. A selected Button
stays in that skin's existing pressed state until deselected; transient pointer
press state remains separate so native hover-out behavior still completes. Main
uses a selection-only host path, so authored hover, press, click, and activation
effects cannot consume the ordinary selection gesture. The core's separate
double-click listener deliberately dispatches the Button's primary action, while
Pop/Fan hosts retain ordinary single-click execution.

On a Run-mode Tool Set surface, a child derives the skin's latched `pressed`
state from its live declared behavior: every `fieldPatch` value must match the
current field value and every `toggleFields` field must be `true`. This
field-driven state is separate from Main selection and transient pointer press.
Children that patch different values into the same field therefore form a
generic radio group; an `execute: false` child updates state without dispatching
a program action. An optional radio group can instead use one Boolean toggle per
choice while patching its peers to `false`: clicking an inactive choice selects
it exclusively, and clicking the active choice releases it so none are selected.
An `inlineEditField` child is still one canonical Button placement: the host
injects its hidden number/text value into the skin's existing HTML label node,
leaves the imported skin source unchanged, and uses the same `[data-core]` for
measurement, hit testing, pressed animation, Editor movement, and resizing.
In Run mode, primary pointer-down anywhere inside that core explicitly focuses
the native popout window, then focuses and selects the inline editor; the user
does not have to hit the label glyphs themselves or reactivate the window. The
host keeps that editor binding stable through pressed/release rerenders so the
same focused node receives the replacement value.
`activationPatch` may reset that shared value when a separate mode Button is
pressed without coupling the mode's selected visual to the editable value.

A Tool Set package may declare one strict read-only `stateQuery` against an
existing child slot, but opening or expanding a Tool Set does not execute it.
Every newly opened expanded surface resets result-mapped placement cycles to
State 1 so controls such as Smart Axis X/Y/Z/Live begin neutral. Successful child
responses then reconcile the matching placements to their authoritative exact
states. Result-mapped cycles do not advance optimistically; ordinary placement
cycles and unmapped children keep their existing host-owned behavior. Query
payloads never come from a Button settings file or skin; result matches remain
placement-owned settings.

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

The canonical Base, Hover, Play, Pressed, Held, Release, Disabled, and Error
sections are the raw authored visual vocabulary. Each placement-cycle state may
select one of those authored visuals, while its separate Press/Hover/Release
trigger decides only when to advance. Skin code never owns a toggle, cycle index,
label sequence, or execution rule. A complete alternate appearance
is authored by Skin Author as one composite paste block with pointer-inert nested
faces inside the one stable `[data-core]`, with state declarations or CSS custom
properties selecting the visible face. It must not introduce another functional
Button, another `[data-core]`, another pointer target, or a runtime skin swap.

They may not run code, own actions, mutate Button state, install sources, create
bindings, or define an alternate hitbox.

Activation sprites and their motion are host/runtime features, not Button
skins. A sprite preset never changes the authored skin source or core hitbox.

## Source Lifecycle

The Button Editor exposes no manual import, update, delete, popout-creation, or
Fan-building actions. Main's existing Add Button flow opens the Editor locked to
the chosen Program and Panel and automatically prompts once for source content.
Source packages use the same canonical transaction whenever that handoff or
another authorized installation or synchronization workflow invokes it:

1. Native auto-detection treats a raw file as a script, the exact root
   `flowcell.script.json` as a script package, and the exact root
   `flowcell.toolset.json` as a Tool Set package. A folder containing both root
   manifests is ambiguous, and a folder containing neither is invalid. Nested
   manifests do not classify the selected folder.
2. When a selected script is the declared entry beside
   `flowcell.script.json`, FlowCell installs the complete package automatically.
   Selecting a package companion directly is rejected instead of creating a
   broken partial install.
3. Native install validates the program manifest and source contract.
4. FlowCell copies the source package into the owner Button's Local Scripts
   package and writes `flowcell.install.json` inside it.
5. Program-specific deployment runs only when the program runner requires it.
6. FlowCell writes the owner Button's `.flowcell-source.json` active record and
   records the pending canonical intent.
7. The invoking canonical workflow adds the returned owner, children, and layout
   to Button state; the successful commit clears the pending intent.
8. Runtime execution resolves the active record, verifies its Local package,
   then dispatches through the runner declared by `flowcell.program.json`.

The Illustrator runner keeps one package-owned bridge alive and dispatches
validated Local Scripts paths directly over its named pipe. Ordinary Button and
Tool Set actions are acknowledged before execution so long-running scripts or
dialogs do not block the invoking window. Request/response capabilities stay
serialized and wait for their result, allowing an invalidation-triggered page
refresh to observe the completed Illustrator action. The hot path does not
launch AutoHotkey or a new PowerShell process for each click.

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
