---
name: skin-author
description: Author FlowCell Button Editor skins in the canonical sectioned paste format. Use for writing, converting, or debugging render-only Button skins, optional visible and alternate faces, exact data-core hitboxes, state declarations, and gated keyframes.
---

## skin-author

**Use when:** producing a skin to paste into FlowCell Buttons Editor, or diagnosing why a pasted skin is invalid or measures incorrectly.

### FlowCell Button Editor Skin Author

The section grammar source of truth is `FlowCellFrontend/src/button/skins/buttonSkinFormat.ts`. The semantic source of truth is `FlowCellFrontend/src/button/skins/skinValidator.ts`. If this skill disagrees with either file, update this skill.

Produce one paste-ready block using only canonical lowercase section headers:

```text
=== structure ===
<skin HTML>
=== keyframes ===
<@keyframes blocks only>
=== base ===
<CSS declarations>
=== hover ===
<CSS declarations>
=== play ===
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

The complete canonical order is `structure`, `keyframes`, `base`, `hover`, `play`, `pressed`, `held`, `release`, `disabled`, `error`. `text-bench` is editor-only and is never a paste header.

For a new skin, a conversion, or a complete replacement, emit every canonical header in that order, including empty optional sections. Empty present sections clear stale source from the previous skin. Omit headers only when the user explicitly requests a partial named-section update.

### Paste behavior

- A complete replacement requires a nonempty valid `structure` section.
- A named-section update may contain any subset of canonical sections.
- Omitted sections stay unchanged.
- An explicitly present empty optional section clears only that section.
- Header lines tolerate surrounding whitespace, indentation, and letter case; blank lines before the first header are ignored. Canonical lowercase remains the authored form.
- Unknown or duplicate section headers, and real content before the first header, make the paste invalid and change nothing.
- Correctly parsed source remains literal and editable even when semantic compilation fails. The last valid render remains visible until the error is fixed.
- Recognized paste source is applied through both the native paste event and the textarea's normal WebView input path, distributed into its canonical section editors, and shown in an always-visible preview before assignment. The transient paste field clears after successful distribution; unparseable input remains available for correction.
- The core element's inline `style` is compiled into a lowest-priority `[data-core]` rule, so ordinary state-section declarations (for example `font-size` in `base`) override inline defaults on that core. This does not override inline declarations on nested elements.

### Structure contract

- Include zero or one `{{label}}` token. Put it inside `data-core` when the skin renders visible Button text; omit it entirely for a textless or animation-only skin.
- Include exactly one element marked `data-core`.
- Use a neutral render-only element such as `div` or `span` for `data-core`. Never emit an interactive, form, media, or navigation element such as `button`, `a`, `input`, `select`, `textarea`, `form`, `img`, `video`, or `audio`; the FlowCell host owns Button semantics and behavior.
- The rendered skin after optional label insertion owns its core interactive geometry. The host measures that exact element, uses it for accessibility geometry, and attaches Button interaction listeners directly to it. The shadow host remains browser-reachable only so the core can receive events; unused host gutters perform no Button action. Never design or request an overlay hitbox.
- For a newly authored packed Button, `data-core` must be the intended resting clickable body footprint. Do not invent transparent exterior margin, demo-page spacing, or layout gutters inside it. When converting an existing interactive control, however, its own authored box model is part of the visual source: preserve padding or transparent depth space that positions its face, base, or press travel.
- Make core typography and geometry deterministic across the Editor, Main, Pop, and Fan. Do not inherit core font metrics. A labeled core, or any core whose dimensions use `em`, must resolve to an explicit pixel `font`/`font-size` and pixel line-height; otherwise different host typography can change its natural aspect ratio and make uniform placement scaling leave gaps.
- A textless skin receives no synthesized label, fallback face, or host chrome. The saved Button label still supplies its accessible name.
- An animation-only core may be visually unpainted, but it must have stable, nonzero resting width and height around the animated visual. Do not use `display:none`, `display:contents`, or a zero-sized core.
- The core may use content-driven or responsive sizing. The placement remains authoritative when the editor supplies exact width and height. In Responsive mode the host forces the core to that exact box, resets authored core min/max constraints, and performs no root transform; nested faces must use flexible layout such as `inset:0`, percentages, flex, or grid if they are expected to reflow cleanly at arbitrary dimensions. Do not rewrite a literal converted skin merely to make it responsive unless the user asks for that source change.
- Decorative wrappers, shadows, glows, and SVG may extend beyond the core, but they must remain pointer-inert.
- Keep intentional 3D depth, bevel insets, shadows, and glows on nested visual children. For new skins, do not invent transparent core padding to simulate placement gaps. For literal conversions, preserve transparent padding already authored on the source control when it participates in that control's shape or depth.
- When a Button state needs a complete alternate appearance, produce one paste-ready composite skin: put every alternate face inside the same stable `data-core` as pointer-inert nested visual markup, then use canonical state declarations and CSS custom properties to reveal the intended face. Never emit another functional Button, another `data-core`, another hitbox, or a runtime skin swap for an alternate state.
- Use real child elements instead of pseudo-elements when state or animation must target them.
- Put every state-controlled value on a nested face, icon, frame, or decorative child behind a CSS custom property with a sensible fallback.
- Initialize every resting visual custom property explicitly in `base`. Structure fallbacks are safety defaults, not a substitute for authored Base state.
- Do not include `<script>`, `<style>`, event-handler attributes, navigation, network access, backend calls, Tauri calls, or state mutation.
- React skins are not supported.

### React and styled-components conversion

When converting a React, JSX, or styled-components example:

- Treat the imported visual source as literal. Do not simplify, normalize, restyle, or "improve" its dimensions, padding, radii, gradients, shadows, transitions, or state behavior unless the user explicitly asks for that exact visual change.
- Remove imports, exports, component functions, hooks, JavaScript expressions, and styled-component wrappers. Output static render-only markup plus canonical state declarations.
- Replace the source `<button>`, anchor, or form control with a neutral `div` or `span` core. Neutralize only browser semantics; preserve the source control's visual display and complete box model on that core because FlowCell supplies behavior, not a substitute shape.
- Convert `className` and selector-owned visual rules into literal inline styles on real elements.
- Replace pseudo-elements with real pointer-inert children when they own a face, base, depth layer, or state-controlled visual. Preserve their authored stacking order, size, box sizing, offsets, and transitions.
- Convert `:hover` to `hover`, `:active` to `pressed` and/or `held`, and functional disabled/error visuals to their matching canonical sections. Leave canonical sections empty when the source has no matching visual; never invent hover, disabled, error, or release styling.
- Put state-controlled nested values behind prefixed CSS custom properties, initialize all resting values in `base`, and consume every `var()` with a fallback in structure.
- Replace the source's literal visible caption with `{{label}}` when the Button text must remain editable. Do not alter the surrounding typography or face structure.
- Remove only spacing that belongs to an outer demo/page wrapper. Margin or gap outside the source interactive element is not Button geometry; padding and depth space on the source interactive element are Button geometry and remain on `data-core`.
- Replace inherited typography with the explicit resolved font size and line height from the intended source host whenever text or `em` units participate in measurement. This freezes the source's rendered geometry across Editor and Pop/Fan rather than choosing new font metrics.
- If the user asks only for a color change, change only the named source color values. Every non-color declaration and every unmentioned color remains literal.

### State sections

- State sections contain declarations only: no selectors, braces, markup, or at-rules.
- Ordinary declarations style the core.
- Custom-property declarations cascade through the rendered structure.
- `base` is resting state. Ordinary declarations style `[data-core]`; custom-property declarations cascade into nested elements that consume them.
- `hover` applies while the exact core is hovered.
- `play` is a click-triggered one-shot latch.
- `pressed`, `held`, and `release` represent pointer-down, hold, and release states.
- Main-page selection reuses `pressed` as a latched visual state until deselection; do not author a separate selection outline or wrapper chrome.
- `disabled` and `error` represent host-owned functional states.
- Forbidden values include `position: fixed`, `javascript:`, and `expression(`.

The canonical Base, Hover, Play, Pressed, Held, Release, Disabled, and Error
sections remain raw author-editable skin code. A placement's optional `Highlight
on hover` setting is a host-owned brightness lift around the rendered placement;
it does not populate, rewrite, or replace the authored `hover` section. Leave that
section empty when the source itself has no hover appearance.

Button behavior is outside skin source. A placement may own one ordered activation
cycle with 2 through 64 stable logical states; two states are the On/Off toggle and
larger counts use the same model. State 1 is initial, the final state wraps to it,
and each state owns one Press, Hover, or Release advance trigger, one label, and one
canonical visual selection. The current index exists only for the running session,
is keyed by placement, and resets when FlowCell restarts unless an action-backed
placement reconciles it from package-owned status. Optional placement-owned
`resultMatches` map an authoritative action response to one exact state; they do
not add executable data to the placement or skin. The Skin Editor's Button
States & Behavior section exposes the count, one Advance on dropdown per state, then
State and Visual state dropdowns. The visual selector offers Base plus nonempty
canonical sections authored by the active working skin; it chooses the latched
resting appearance and never rewrites that section's code. Real Hover, Pressed,
Held, Play, and Release input temporarily render their authored skin states, then
settle back to the latched visual; functional Error and Disabled remain the
highest-priority desired visuals but do not cut short an already-latched finite presentation.
For a placement cycle, an empty transient section does not participate in visual
resolution: the host falls through to the next authored input state or the configured
resting visual. Consequently, an empty Pressed, Held, Play, or Release section cannot
remove and then reapply a completed Hover target; its Hover state remains one continuous
static presentation through that interaction.
Once the renderer applies a presentation, running finite transitions and animations
finish before the newest requested appearance replaces it. Pointer truth and action
dispatch remain immediate, while infinite-only motion does not block later visual
state. A real ButtonSkinRenderer preview updates through the same presentation boundary, and selection never
replaces a configured cycle visual with an implicit Pressed visual. The same
section exposes the placement-only `Highlight on hover` option, which defaults off
and changes neither skin source nor `[data-core]` geometry. Button Text uses the
same logical states and assigns one label
per state, with no interaction-condition label matrix. Its placement-owned X/Y
controls move only the host-injected label: static HTML labels use host-owned
flow-preserving relative positioning, already-positioned HTML labels keep their authored
positioning model while composing the placement offset, and SVG label lines convert
screen-pixel movement through their live matrix before using host-owned positions. The HTML path remains effective if authored state declarations switch the
core among inline, block, flex, or grid layout. A `{{label}}` token may therefore
remain in the literal source wrapper where it visually belongs; do not flatten the
markup, add a transform wrapper, or encode an offset merely to make editor movement
work. Host movement changes neither skin source, authored transforms, core geometry,
nor hit testing, and the host reapplies the composition across visual-transition frames.
The Button Text preview updates immediately, and its bottom `Apply
All` applies only labels and focused-placement text settings. Save placement persists
the hover highlight plus cycle IDs, triggers, labels, and visual names without copying
or changing skin source.
Do not encode execution, toggle state, cycle counters, label sequences, or persistence
in skin markup or CSS.

### Keyframes and animation

- `keyframes` may contain only `@keyframes` or `@-webkit-keyframes` blocks.
- Prefix animation names to avoid collisions.
- Never run an animation unconditionally from structure.
- Mark an animated real element with `data-anim="token"` using lowercase letters, digits, or hyphens.
- Trigger it from a state section with `--anim-token: <animation shorthand>;`.
- Use `hover` for motion entered by hover. Finite hover motion completes even if hover ends; infinite-only hover motion remains immediately replaceable on hover-out.
- Pressed, Play, and Release are host-owned commit barriers. Once requested, asynchronous native Pop/Fan preparation must commit that exact authored presentation before pointer-up or an action result may replace it. Later interaction, label, highlight, and activation-state requests update only one latest desired appearance.
- Once a finite state animation or transition is applied, FlowCell keeps the complete presentation until every finite Web Animation reaches its `Animation.finished` completion signal. The renderer confirms the final frame, then applies the latest desired persistent/result appearance. Never implement this boundary with interval polling. Infinite-only motion never blocks, and raw pointer truth plus backend activation remain immediate.
- Use `play` for a finite one-shot activation animation with iteration count `1`. Another activation while Play is active does not restart or queue that visual run; never put an infinite animation in `play`.

The latch is host code, never skin code. FlowCell's deployed reference is
[buttonVisualLatch.ts](../../../FlowCellFrontend/src/button/runtime/buttonVisualLatch.ts),
its Web Animations integration is
[ButtonSkinRenderer.tsx](../../../FlowCellFrontend/src/button/skins/ButtonSkinRenderer.tsx),
and the protected Smart Axis handoff is covered in
[buttonSystem.test.mjs](../../../FlowCellFrontend/tests/buttonSystem.test.mjs).
The core pattern is:

```ts
const intent = {
  key,
  value: snapshot,
  commitBeforeSupersede:
    snapshot.pressed || snapshot.play || snapshot.release
};
latch = requestButtonVisual(latch, intent);

const completions = finiteAnimations.map((animation) => animation.finished);
await Promise.allSettled(completions);
await waitForButtonVisualFrame();
latch = finishButtonVisualMotion(latch, presentationId);
```

The production renderer rechecks motion after that frame before releasing the
presentation. Do not paste this TypeScript into a skin or delay command dispatch
behind it.

### Sizing and hitbox rules

- When present, the label is inserted before the core is measured. A textless skin is measured directly from its authored core.
- The resulting `[data-core]` rectangle defines the Button's placement, accessible geometry, and only pointer target in the editor, main surface, regular popout, tool-set popout, and fan. Transparent native windows discover it through the placement host and test its live rectangle; unused placement gutters remain click-through.
- After a core receives pointer-down in a transparent Pop or Fan, the host keeps native input enabled through pointer-up even if an authored Pressed, Held, or Play animation moves or shrinks that core. Do not enlarge or stabilize the skin hitbox to compensate; the host owns gesture continuity and restores live-core click-through gating after release.
- Button Size is a host-owned working preview with three behaviors. Responsive assigns independent width and height to the core without scaling the authored root. Proportional uniformly scales the complete root and keeps the working aspect ratio. Stretch explicitly scales X and Y separately and may distort text, corners, shadows, and effects.
- `Assign Size` applies the working target and behavior only to the focused placement. `Assign Size to Panel` applies that target once to every Button beside the edited placement on its current Main, Pop, Fan, or other Button surface and atomically repacks that same surface when it fits. Responsive and Stretch use the exact target dimensions; Proportional preserves each target Button's measured natural aspect when available and otherwise its current aspect. Both actions disable label-driven geometry growth, neither enables the separate legacy `Same size Buttons` surface format, and neither mutates skin source. The preview uses the isolated working skin, so a changed skin must still be assigned separately.
- Audit a newly authored packed core edge to edge: two copies placed at `x = 0` and `x = core width`, or `y = 0` and `y = core height`, must not reveal an unintended transparent strip. For a literal conversion, compare against the source instead: authored control padding is retained even when it creates transparent space.
- Compare the measured core aspect ratio in the Editor and a real Pop/Fan. It must remain the same before host scaling; a mismatch means inherited typography or other host-context units still own skin geometry.
- Text fit is host-owned and placement-specific: Shrink, Stack Whole Words, or Shrink and Stack, plus an optional starting text size and minimum shrink size. Horizontal alignment is likewise placement-specific: Use skin, Left, Center, or Right. Alignment changes only the rendered text for that placement and never rewrites skin source; Use skin removes the override and restores the authored alignment. Shrink modes may render below the starting size. These controls remain independent from size assignment. Never split words in authored structure.
- Label edits do not move or resize a placement unless the placement explicitly enables label-driven growth.
- Visual overflow can overlap; interactive cores cannot.

### Known-good example

```text
=== structure ===
<div style="display:inline-block; padding:8px; pointer-events:none;">
  <div data-core style="display:inline-flex; align-items:center; justify-content:center;
    min-width:100%; min-height:100%; box-sizing:border-box; padding:10px 20px;
    border-radius:999px; white-space:normal; text-align:center;
    font:600 13px/17px 'Segoe UI',system-ui,sans-serif;
    background:var(--fx-bg, rgba(44,56,82,.9));
    border:1px solid var(--fx-edge, rgba(126,150,210,.55));
    color:var(--fx-ink, #e2e9ff);
    box-shadow:0 4px 18px var(--fx-halo, rgba(0,0,0,.35));
    transform:scale(var(--fx-push, 1));
    transition:transform 120ms ease, background 160ms ease, border-color 160ms ease;">
    {{label}}
  </div>
</div>
=== keyframes ===
=== base ===
--fx-bg: rgba(44,56,82,.9);
--fx-edge: rgba(126,150,210,.55);
--fx-ink: #e2e9ff;
=== hover ===
--fx-bg: rgba(56,72,108,.95);
--fx-edge: rgba(150,176,240,.9);
--fx-halo: rgba(90,120,220,.35);
=== play ===
=== pressed ===
--fx-push: .94;
=== held ===
--fx-push: .94;
=== release ===
--fx-push: 1.03;
=== disabled ===
--fx-bg: rgba(40,44,54,.6);
--fx-ink: rgba(190,198,214,.45);
=== error ===
--fx-edge: rgba(240,90,90,.9);
--fx-halo: rgba(240,80,80,.3);
```

### Animation-only example

This skin has no visible Button face and intentionally omits `{{label}}`. The transparent core supplies a stable hit target and the particle supplies the authored visual:

```text
=== structure ===
<span data-core style="display:inline-grid;place-items:center;width:72px;height:72px;">
  <span data-anim="orbit" style="width:16px;height:16px;border-radius:50%;
    background:#7dd3fc;box-shadow:0 0 18px rgba(125,211,252,.9);"></span>
</span>
=== keyframes ===
@keyframes fc-orbit {
  from { transform:rotate(0deg) translateX(22px) rotate(0deg); }
  to { transform:rotate(360deg) translateX(22px) rotate(-360deg); }
}
=== base ===
background: transparent;
=== hover ===
=== play ===
--anim-orbit: fc-orbit 700ms ease-in-out 1;
=== pressed ===
=== held ===
=== release ===
=== disabled ===
=== error ===
```

### Scope and output

This format applies to single-script Buttons, panel owners, tool-set owners, every tool-set child button, regular-popout members, and fan members. Assigned and library skins persist in `flowcellbackend/local/button-system/button-state.json`. Load skin lists machine-local recent files, saved library skins, and then `Browse...`; loading never assigns. Browse, first-time Save skin, and Save as new skin default to `flowcellbackend/local/Button editor/Skins`. Save skin overwrites its associated portable `.flowcell-button-skin.txt` file, or opens the picker when it has no file yet, and updates the same library entry. Save as new skin always opens the picker, exports canonical paste-ready source without assigning it, and uses the chosen filename stem exactly as the new library name. Recent absolute paths remain machine-local rather than entering canonical Button metadata. Before editing a skin, inspect whether the focused placement inherits a shared `defaultSkinId`. Default to forking and assigning a focused-placement override, and warn which placements or tool-set children would change before any explicit shared or panel-wide mutation.

### Required preflight

Before returning any new, converted, or replacement skin:

1. Include every canonical header, even when a section is empty.
2. Run `.claude/skills/skin-author/scripts/validate-skin.mjs` against the exact paste block.
3. Return the skin only when the parser accepts it, the replacement contains every canonical section, and `validateButtonSkin(...)` reports zero diagnostics.
4. For original authoring, manually confirm that `data-core` matches the intended resting painted/clickable footprint and contains no accidental exterior gutter. For a conversion, compare source and result at rest and in every authored state, confirming the same core size, child boxes, padding, radii, colors, shadows, and transitions except for explicitly requested changes. In both cases, confirm the same natural aspect ratio in Editor and Pop/Fan. Static validation cannot infer this geometry, so the visual comparison is mandatory.
5. For a labeled skin, preview nonzero Button Text X and Y values and confirm the injected label moves while `[data-core]`, the authored face, and the hit target stay fixed. This applies whether `{{label}}` is a direct flex/grid child, nested in ordinary inline HTML, or inside SVG. For a placement cycle, verify every logical state against its selected authored visual and per-state label, and exercise the configured Press, Hover, or Release advance edge without changing skin source.

The validator preflight proves grammar and semantic safety. It does not replace visual adjacency, hitbox, hover, pressed, held, release, disabled, and error checks in the Button Editor plus a real Pop or Fan when those surfaces are in scope.

When the user asks for a skin, output only the paste block unless they explicitly request explanation.
