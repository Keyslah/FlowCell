---
name: skin-author
description: Author FlowCell Button Editor skins in the canonical sectioned paste format. Use for writing, converting, or debugging render-only Button skins, optional visible labels, exact data-core hitboxes, state declarations, and gated keyframes.
---

## skin-author

**Use when:** producing a skin to paste into FlowCell Buttons Editor, or diagnosing why a pasted skin is invalid or measures incorrectly.

### FlowCell Button Editor Skin Author

The grammar source of truth is `FlowCellFrontend/src/button/skins/buttonSkinFormat.ts`. If this skill and that file disagree, update this skill.

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
- The rendered skin after optional label insertion owns its core interactive geometry. The host measures that exact element and attaches pointer and keyboard behavior directly to it. Never design or request an overlay hitbox.
- A textless skin receives no synthesized label, fallback face, or host chrome. The saved Button label still supplies its accessible name.
- An animation-only core may be visually unpainted, but it must have stable, nonzero resting width and height around the animated visual. Do not use `display:none`, `display:contents`, or a zero-sized core.
- The core may use content-driven or responsive sizing. The placement remains authoritative when the editor supplies exact width and height.
- Decorative wrappers, shadows, glows, and SVG may extend beyond the core, but they must remain pointer-inert.
- Use real child elements instead of pseudo-elements when state or animation must target them.
- Put every state-controlled value on a nested face, icon, frame, or decorative child behind a CSS custom property with a sensible fallback.
- Initialize every resting visual custom property explicitly in `base`. Structure fallbacks are safety defaults, not a substitute for authored Base state.
- Do not include `<script>`, `<style>`, event-handler attributes, navigation, network access, backend calls, Tauri calls, or state mutation.
- React skins are not supported.

### State sections

- State sections contain declarations only: no selectors, braces, markup, or at-rules.
- Ordinary declarations style the core.
- Custom-property declarations cascade through the rendered structure.
- `base` is resting state. Ordinary declarations style `[data-core]`; custom-property declarations cascade into nested elements that consume them.
- `hover` applies while the exact core is hovered.
- `play` is a click-triggered one-shot latch.
- `pressed`, `held`, and `release` represent pointer-down, hold, and release states.
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
- The resulting `[data-core]` rectangle is the Button's actual hitbox in the editor, main surface, regular popout, tool-set popout, and fan.
- Text fit is host-owned: Shrink, Stack Whole Words, or Shrink and Stack. Never split words in authored structure.
- Label edits do not move or resize a placement unless the placement explicitly enables label-driven growth.
- Visual overflow can overlap; interactive cores cannot.

### Known-good example

```text
=== structure ===
<div style="display:inline-block; padding:8px; pointer-events:none;">
  <div data-core style="display:inline-flex; align-items:center; justify-content:center;
    min-width:100%; min-height:100%; box-sizing:border-box; padding:10px 20px;
    border-radius:999px; white-space:normal; text-align:center; pointer-events:auto;
    background:var(--fx-bg, rgba(44,56,82,.9));
    border:1px solid var(--fx-edge, rgba(126,150,210,.55));
    color:var(--fx-ink, #e2e9ff);
    box-shadow:0 4px 18px var(--fx-halo, rgba(0,0,0,.35));
    transform:scale(var(--fx-push, 1));
    transition:transform 120ms ease, background 160ms ease, border-color 160ms ease;">
    {{label}}
  </div>
</div>
=== base ===
--fx-bg: rgba(44,56,82,.9);
--fx-edge: rgba(126,150,210,.55);
--fx-ink: #e2e9ff;
=== hover ===
--fx-bg: rgba(56,72,108,.95);
--fx-edge: rgba(150,176,240,.9);
--fx-halo: rgba(90,120,220,.35);
=== pressed ===
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
=== play ===
--anim-orbit: fc-orbit 700ms ease-in-out 1;
```

### Scope and output

This format applies to single-script Buttons, panel owners, tool-set owners, every tool-set child button, regular-popout members, and fan members. Skins persist only in `flowcellbackend/local/button-system/button-state.json`.

When the user asks for a skin, output only the paste block unless they explicitly request explanation.
