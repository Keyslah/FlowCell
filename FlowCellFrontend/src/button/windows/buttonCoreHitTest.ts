interface ElementFromPointRoot {
  elementFromPoint(clientX: number, clientY: number): Element | null;
}

function hasElementFromPoint(root: Node): root is Node & ElementFromPointRoot {
  return "elementFromPoint" in root &&
    typeof (root as Partial<ElementFromPointRoot>).elementFromPoint === "function";
}

/**
 * Tests one live Button core in two phases.
 *
 * The live bounds of the authored target (the core, or its optional inner hit
 * shape) are only a cheap rejection region. Browser hit testing is the exact
 * phase so border radii, clip paths, SVG pointer geometry, live transforms,
 * stacking, and translated inner shapes stay aligned with the DOM path.
 */
export function buttonCoreContainsClientPoint(
  core: Element,
  clientX: number,
  clientY: number
): boolean {
  if (!core.isConnected) return false;
  const authoredHitShape = core.querySelector<Element>("[data-hit-shape]");
  const broadPhaseElement = authoredHitShape?.isConnected ? authoredHitShape : core;
  const rect = broadPhaseElement.getBoundingClientRect();
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return false;
  }

  const root = core.getRootNode();
  const hit = hasElementFromPoint(root)
    ? root.elementFromPoint(clientX, clientY)
    : typeof document === "undefined"
      ? null
      : document.elementFromPoint(clientX, clientY);
  return hit === core || (hit !== null && core.contains(hit));
}
