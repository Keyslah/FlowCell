// Appearance Hub slot contract — the single source of truth for the paste
// format. `.claude/skills/skin-author/SKILL.md` mirrors this file; keep the
// two in sync when the format changes.
//
// A hub skin is a set of named slots:
//   structure — skin HTML. Must contain {{label}} and exactly one data-core
//               element (the measured button = the hitbox). Decorative parts
//               style themselves with inline style="..." attributes.
//   base/hover/pressed/held/release/disabled/error — CSS declarations only,
//               no selectors. The compiler writes every selector itself:
//               normal declarations land on the data-core element, custom
//               properties (--name: value) land on the instance root so they
//               cascade into decorative children.
//   keyframes — @keyframes blocks ONLY (no other rules). Structure children
//               reference them via `animation: var(--x, none)` inline, and a
//               state slot turns them on by setting the var — so motion can
//               be gated to hover/pressed/etc.

export const STRUCTURE_SLOT_ID = "structure" as const;
export const KEYFRAMES_SLOT_ID = "keyframes" as const;

export const STATE_SLOT_IDS = [
  "base",
  "hover",
  "play",
  "pressed",
  "held",
  "release",
  "disabled",
  "error"
] as const;

export type StateSlotId = (typeof STATE_SLOT_IDS)[number];
export type SlotId = typeof STRUCTURE_SLOT_ID | typeof KEYFRAMES_SLOT_ID | StateSlotId;

export const SLOT_IDS: readonly SlotId[] = [STRUCTURE_SLOT_ID, KEYFRAMES_SLOT_ID, ...STATE_SLOT_IDS];

export const HUB_LABEL_PLACEHOLDER = "{{label}}";
export const HUB_CORE_ATTRIBUTE = "data-core";

// Marker lines that split a full-skin paste into slots: `=== hover ===`
export const SLOT_MARKER_LINE_PATTERN = /^===\s*([a-z]+)\s*===\s*$/;

// State attributes live on the host-owned instance wrapper. The names match
// the live FlowCell button contract (lib/skins.tsx) so a future apply bridge
// does not need a translation layer.
export const STATE_SELECTOR_SUFFIX: Record<StateSlotId, string> = {
  base: "",
  hover: '[data-hovered="true"]',
  // One-shot trigger: the host sets data-play on pointer-down (click) and
  // holds it until every animation it started has finished (animationend),
  // regardless of pointer leave or release. Use iteration count 1 in
  // play-slot vars.
  play: '[data-play="true"]',
  pressed: '[data-pressed="true"]',
  held: '[data-held="true"]',
  release: '[data-action-phase="release"]',
  disabled: '[data-disabled="true"]',
  error: '[data-error="true"]'
};

export const STATE_SLOT_HINTS: Record<StateSlotId, string> = {
  base: "resting look",
  hover: "pointer over the core",
  play: "one-shot on click — always completes",
  pressed: "pointer down",
  held: "pointer held down",
  release: "just released",
  disabled: "not runnable",
  error: "action failed"
};

export type ForbiddenPattern = {
  pattern: RegExp;
  message: string;
};

// Declaration-slot content that gets a paste rejected outright.
export const FORBIDDEN_STATE_PATTERNS: readonly ForbiddenPattern[] = [
  { pattern: /[{}]/, message: "No selectors or braces — declarations only." },
  { pattern: /</, message: "No markup inside state slots." },
  { pattern: /@/, message: "No at-rules (@media, @import, ...)." },
  { pattern: /position\s*:\s*fixed/i, message: "position: fixed is not allowed." },
  { pattern: /javascript\s*:/i, message: "javascript: URLs are not allowed." },
  { pattern: /expression\s*\(/i, message: "CSS expression() is not allowed." }
];

export function isStateSlotId(value: string): value is StateSlotId {
  return (STATE_SLOT_IDS as readonly string[]).includes(value);
}

export function isSlotId(value: string): value is SlotId {
  return value === STRUCTURE_SLOT_ID || value === KEYFRAMES_SLOT_ID || isStateSlotId(value);
}
