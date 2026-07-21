---
name: skin-author
description: Author FlowCell Button Editor skins in the canonical sectioned paste format. Use for writing, converting, or debugging render-only Button skins, optional visible labels, exact data-core hitboxes, state declarations, and gated keyframes.
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
- The core may use content-driven or responsive sizing. The placement remains authoritative when the editor supplies exact width and height.
- Decorative wrappers, shadows, glows, and SVG may extend beyond the core, but they must remain pointer-inert.
- Keep intentional 3D depth, bevel insets, shadows, and glows on nested visual children. For new skins, do not invent transparent core padding to simulate placement gaps. For literal conversions, preserve transparent padding already authored on the source control when it participates in that control's shape or depth.
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

### Keyframes and animation

- `keyframes` may contain only `@keyframes` or `@-webkit-keyframes` blocks.
- Prefix animation names to avoid collisions.
- Never run an animation unconditionally from structure.
- Mark an animated real element with `data-anim="token"` using lowercase letters, digits, or hyphens.
- Trigger it from a state section with `--anim-token: <animation shorthand>;`.
- Use `hover` for motion that should stop on hover-out.
- Use `play` for one complete animation per activation. Use iteration count `1`; never put an infinite animation in `play`.

### Sizing and hitbox rules

- When present, the label is inserted before the core is measured. A textless skin is measured directly from its authored core.
- The resulting `[data-core]` rectangle defines the Button's placement, accessible geometry, and only pointer target in the editor, main surface, regular popout, tool-set popout, and fan. Transparent native windows discover it through the placement host and test its live rectangle; unused placement gutters remain click-through.
- Audit a newly authored packed core edge to edge: two copies placed at `x = 0` and `x = core width`, or `y = 0` and `y = core height`, must not reveal an unintended transparent strip. For a literal conversion, compare against the source instead: authored control padding is retained even when it creates transparent space.
- Compare the measured core aspect ratio in the Editor and a real Pop/Fan. It must remain the same before host scaling; a mismatch means inherited typography or other host-context units still own skin geometry.
- Text fit is host-owned: Shrink, Stack Whole Words, or Shrink and Stack. Never split words in authored structure.
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

This format applies to single-script Buttons, panel owners, tool-set owners, every tool-set child button, regular-popout members, and fan members. Skins persist only in `flowcellbackend/local/button-system/button-state.json`.

### Required preflight

Before returning any new, converted, or replacement skin:

1. Include every canonical header, even when a section is empty.
2. Run `.claude/skills/skin-author/scripts/validate-skin.mjs` against the exact paste block.
3. Return the skin only when the parser accepts it, the replacement contains every canonical section, and `validateButtonSkin(...)` reports zero diagnostics.
4. For original authoring, manually confirm that `data-core` matches the intended resting painted/clickable footprint and contains no accidental exterior gutter. For a conversion, compare source and result at rest and in every authored state, confirming the same core size, child boxes, padding, radii, colors, shadows, and transitions except for explicitly requested changes. In both cases, confirm the same natural aspect ratio in Editor and Pop/Fan. Static validation cannot infer this geometry, so the visual comparison is mandatory.

The validator preflight proves grammar and semantic safety. It does not replace visual adjacency, hitbox, hover, pressed, held, release, disabled, and error checks in the Button Editor plus a real Pop or Fan when those surfaces are in scope.

When the user asks for a skin, output only the paste block unless they explicitly request explanation.
