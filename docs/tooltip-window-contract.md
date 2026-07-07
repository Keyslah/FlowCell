# FlowCell Tooltip Window Contract

FlowCell button tooltips are owned by the external transparent Tauri tooltip
window. Do not render fallback tooltip DOM inside panel fan, popout, toolbox, or
main windows.

## Owner Path

- Trigger: any element with `data-flow-tooltip`.
- Delegation owner: `FlowCellFrontend/src/AppBase.tsx`.
- Window controller: `FlowCellFrontend/src/lib/flowTooltip.ts`.
- Window route: `FlowCellFrontend/src/pages/tooltip/TooltipWindowPage.tsx`.
- Window CSS: `FlowCellFrontend/src/pages/tooltip/tooltipWindowPage.css`.

`AppBase` listens for pointer/focus events and calls
`showFlowTooltipForElement(text, element)`. `flowTooltip.ts` creates or reuses
the `flowcell-tooltip` `WebviewWindow`, positions it from the source window and
element rect, emits `flowcell-tooltip:update`, and shows it as an always-on-top,
cursor-ignoring, transparent window.

## Transparency Requirements

The tooltip window must be created with:

- `transparent: true`
- `backgroundColor: [0, 0, 0, 0]`
- `decorations: false`
- `shadow: false`
- `visible: false`
- `focus: false`
- `alwaysOnTop: true`

After creation, `flowTooltip.ts` also reapplies the same chrome with
`setDecorations(false)`, `setShadow(false)`, `setResizable(false)`,
`setIgnoreCursorEvents(true)`, and `setBackgroundColor([0, 0, 0, 0])` when the
runtime exposes it.

## Regression Rules

- Do not add native HTML `title` to FlowCell button/fan/popout controls that
  already use `data-flow-tooltip`; WebView2 may draw its own delayed tooltip
  rectangle.
- Do not call `showFlowTooltipForElement` from individual button hosts. The
  delegated `AppBase` listener is the only trigger owner.
- Do not reintroduce a local fallback tooltip element inside the source window.
  That creates the old two-tooltip behavior and can force a visible rectangle
  inside transparent panel fan or popout windows.
- Panel fan and script-group popout windows must request transparent native
  backgrounds at creation time, not only after creation.
- Do not open the tooltip window from transparent overlay surfaces
  (`panel-fan` or `script-group-popout`). On WebView2 the delayed tooltip
  window can show its native white creation surface over Blender even when the
  page CSS is transparent.

## Hub Skin Demo Backgrounds

Appearance Hub skins commonly start as copied demo-page snippets. The imported
skin scoper rewrites root selectors such as `body`, `html`, and `:root` into
shadow-host selectors, so a pasted rule like `body { background: #fff; }` can
paint a white rectangle behind the real `data-core` button unless hub skins
clear page-level host backgrounds after imported CSS is scoped.

Hub-authored `HostSkinButton` renders must expose the `host-skin-button--hub`
surface token to the imported-skin shadow root. The shadow CSS then clears
host/demo backgrounds for hub skins while leaving the measured `data-core`
visual source untouched.

Script-group popout hub skins are compiled as cell-fit skins for
`popped-single` and `popped-group` placements. The popout window owns a fixed
template grid, so hub skins must fill the template cell instead of rendering at
their natural footprint; otherwise adjacent skins can overlap, clip, and reveal
outer demo-page backgrounds during popout/fan animation.
