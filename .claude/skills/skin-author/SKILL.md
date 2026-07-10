---
name: skin-author
description: Author FlowCell Appearance Hub button skins in the `=== slot ===` paste format. Use when writing, converting, or debugging a hub skin paste — the data-core/data-anim contract, state slots, and compiler routing rules.
---

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
