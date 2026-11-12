import { parseCssDeclarations } from "./cssSyntax.js";

const PROFILE = "--cc-travel-profile";
const FRAME = "--cc-motion-frame";
const LABEL_Y = "--cc-motion-label-y";
const SHADOW_FILTER = "--cc-motion-shadow-filter";
const FULL_TRAVEL_MS = 480;

function mountRaisedShadowRemoval(core: HTMLElement | SVGElement) {
  const sprite = core.querySelector?.<HTMLElement>('[data-anim="cc"]');
  if (!sprite) return null;
  const namespace = "http://www.w3.org/2000/svg";
  const root = core.ownerDocument.createElementNS(namespace, "svg");
  const filter = core.ownerDocument.createElementNS(namespace, "filter");
  const transfer = core.ownerDocument.createElementNS(namespace, "feComponentTransfer");
  const alpha = core.ownerDocument.createElementNS(namespace, "feFuncA");
  const id = "flowcell-chipped-concrete-shadow-removal";
  root.setAttribute("width", "0");
  root.setAttribute("height", "0");
  root.setAttribute("aria-hidden", "true");
  root.style.position = "absolute";
  root.style.pointerEvents = "none";
  filter.id = id;
  filter.setAttribute("color-interpolation-filters", "sRGB");
  // The baked outer shadow is at most 189/255 alpha across the bundled frames.
  // Remove alpha <= 75%; leave opaque concrete and its RGB values unchanged.
  alpha.setAttribute("type", "linear");
  alpha.setAttribute("slope", "4");
  alpha.setAttribute("intercept", "-3");
  transfer.append(alpha);
  filter.append(transfer);
  root.append(filter);
  core.append(root);
  const previous = sprite.style.filter;
  sprite.style.filter = `${previous && previous !== "none" ? `${previous} ` : ""}var(${SHADOW_FILTER}, none)`;
  return {
    value: `url("#${id}")`,
    dispose() {
      sprite.style.filter = previous;
      root.remove();
      core.style.removeProperty(SHADOW_FILTER);
    }
  };
}

interface TravelFrame {
  depth: number;
  labelY: number;
}

interface TravelProfile {
  hover: number;
  flush: number;
  frames: TravelFrame[];
}

interface TravelInput {
  hovered: boolean;
  pressed: boolean;
  released: boolean;
  selected: boolean;
  disabled: boolean;
}

export function readChippedConcreteKeyTravel(base: string): TravelProfile | null {
  if (!base.includes(PROFILE)) return null;
  const parsed = parseCssDeclarations(base);
  if (!parsed.ok) return null;
  const value = parsed.declarations.find(({ property }) => property === PROFILE)?.value;
  if (!value) return null;
  const [hover, flush, ...samples] = value.trim().split(/\s+/);
  const frames = samples.map((sample) => {
    const [depth, labelY] = sample.split(",").map(Number);
    return { depth, labelY };
  });
  const hoverIndex = Number(hover);
  const flushIndex = Number(flush);
  if (
    frames[0]?.depth !== 0 ||
    !Number.isInteger(hoverIndex) || !Number.isInteger(flushIndex) ||
    hoverIndex <= 0 || flushIndex <= hoverIndex || flushIndex >= frames.length - 1 ||
    frames.some(({ depth, labelY }, index) =>
      !Number.isFinite(depth) || !Number.isFinite(labelY) ||
      (index > 0 && depth <= frames[index - 1].depth)
    )
  ) return null;
  return { hover: hoverIndex, flush: flushIndex, frames };
}

let travelPropertiesRegistered = false;

function registerTravelProperties() {
  if (travelPropertiesRegistered) return;
  for (const [name, syntax, initialValue] of [
    [FRAME, "<percentage>", "0%"],
    [LABEL_Y, "<length>", "0px"]
  ]) {
    try {
      CSS.registerProperty({ name, syntax, initialValue, inherits: true });
    } catch {
      // A document can already have the property registered after a hot reload.
    }
  }
  travelPropertiesRegistered = true;
}

export function mountChippedConcreteKeyTravel(
  core: HTMLElement | SVGElement,
  { frames, hover, flush }: TravelProfile
) {
  registerTravelProperties();
  const shadowRemoval = mountRaisedShadowRemoval(core);
  const press = frames.length - 1;
  const frameValues = frames.map(({ labelY }, index) => ({
    [FRAME]: `${index / press * 100}%`,
    [LABEL_Y]: `${labelY}px`,
    ...(shadowRemoval ? { [SHADOW_FILTER]: index < flush ? shadowRemoval.value : "none" } : {})
  }));
  let input: TravelInput | undefined;
  let hoverBlocked = false;
  let touchFlush = false;
  let frame = 0;
  let motion: { animation: Animation; target: number } | undefined;

  function paint(index: number) {
    frame = index;
    for (const [property, value] of Object.entries(frameValues[index])) {
      core.style.setProperty(property, value);
    }
  }

  function move(target: number) {
    if (motion) {
      const displayed = parseFloat(getComputedStyle(core).getPropertyValue(FRAME));
      if (Number.isFinite(displayed)) paint(Math.round(displayed * press / 100));
      motion.animation.cancel();
      motion = undefined;
    }
    if (frame === target) return false;

    const start = frame;
    const direction = Math.sign(target - start);
    const distance = Math.abs(frames[target].depth - frames[start].depth);
    const stops: Keyframe[] = [{ ...frameValues[start], offset: 0, easing: "step-end" }];
    for (let index = start + direction; ; index += direction) {
      // Switch at the midpoint so the same depth has the same timing in both directions.
      const midpoint = (frames[index].depth + frames[index - direction].depth) / 2;
      stops.push({
        ...frameValues[index],
        offset: Math.abs(midpoint - frames[start].depth) / distance,
        easing: "step-end"
      });
      if (index === target) break;
    }
    stops.push({ ...frameValues[target], offset: 1 });
    paint(target);
    const animation = core.animate(stops, FULL_TRAVEL_MS * distance / frames[press].depth);
    motion = { animation, target };
    void animation.finished.then(() => {
      if (motion?.animation !== animation) return;
      motion = undefined;
      if (target === flush) touchFlush = false;
      reconcile();
    }, () => { /* A new pointer target interrupted this leg. */ });
    return true;
  }

  function reconcile() {
    if (!input) return;
    const { disabled, pressed, selected, hovered } = input;
    const restingFrame = hovered && !hoverBlocked ? hover : 0;
    const target = disabled ? 0 : pressed ? press : selected || touchFlush ? flush : restingFrame;
    if (motion?.target === target) return;
    // Even a quick click must reach the bottom. A momentary release must visibly
    // pass through flush before returning to hover/rest.
    if (!disabled && (motion?.target === press || (!pressed && touchFlush && motion?.target === flush))) return;
    if (!move(target) && target === flush && touchFlush) {
      touchFlush = false;
      reconcile();
    }
  }

  return {
    update(next: TravelInput) {
      if (!next.hovered || next.pressed && !input?.pressed) hoverBlocked = false;
      if (input?.selected && !next.selected) hoverBlocked = next.hovered;
      if (next.pressed || next.disabled || hoverBlocked) touchFlush = false;
      else if (input?.pressed && next.released) touchFlush = true;

      const initial = !input;
      input = next;
      if (initial && next.selected && !next.disabled && !next.pressed) paint(flush);
      reconcile();
    },
    dispose() {
      motion?.animation.cancel();
      motion = undefined;
      core.style.removeProperty(FRAME);
      core.style.removeProperty(LABEL_Y);
      shadowRemoval?.dispose();
    }
  };
}
