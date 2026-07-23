const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

type LabelElement = HTMLElement | SVGElement;

interface StyleDeclarationSnapshot {
  value: string;
  priority: string;
}

const offsetStyleSnapshots = new WeakMap<LabelElement, Map<string, StyleDeclarationSnapshot>>();
const offsetAttributeSnapshots = new WeakMap<SVGElement, Map<string, string | null>>();

function restoreTextOffsetStyles(labelNode: LabelElement): void {
  const snapshots = offsetStyleSnapshots.get(labelNode);
  if (!snapshots) return;
  for (const [property, snapshot] of snapshots) {
    if (snapshot.value) {
      labelNode.style.setProperty(property, snapshot.value, snapshot.priority);
    } else {
      labelNode.style.removeProperty(property);
    }
  }
  offsetStyleSnapshots.delete(labelNode);
}

function overrideTextOffsetStyle(
  labelNode: LabelElement,
  property: string,
  value: string
): void {
  let snapshots = offsetStyleSnapshots.get(labelNode);
  if (!snapshots) {
    snapshots = new Map();
    offsetStyleSnapshots.set(labelNode, snapshots);
  }
  if (!snapshots.has(property)) {
    snapshots.set(property, {
      value: labelNode.style.getPropertyValue(property),
      priority: labelNode.style.getPropertyPriority(property)
    });
  }
  labelNode.style.setProperty(property, value, "important");
}

function restoreTextOffsetAttributes(element: SVGElement): void {
  const snapshots = offsetAttributeSnapshots.get(element);
  if (!snapshots) return;
  for (const [attribute, value] of snapshots) {
    if (value === null) element.removeAttribute(attribute);
    else element.setAttribute(attribute, value);
  }
  offsetAttributeSnapshots.delete(element);
}

function overrideTextOffsetAttribute(
  element: SVGElement,
  attribute: string,
  value: string
): void {
  let snapshots = offsetAttributeSnapshots.get(element);
  if (!snapshots) {
    snapshots = new Map();
    offsetAttributeSnapshots.set(element, snapshots);
  }
  if (!snapshots.has(attribute)) snapshots.set(attribute, element.getAttribute(attribute));
  element.setAttribute(attribute, value);
}

function svgLabelLines(labelNode: SVGElement): SVGElement[] {
  return Array.from(labelNode.children).filter((child): child is SVGElement => (
    child.namespaceURI === SVG_NAMESPACE && child.getAttribute("data-button-label-line") === "true"
  ));
}

function splitCssComponents(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value.trim()) {
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(character) && depth === 0) {
      if (current) parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function composedTranslate(
  labelNode: LabelElement,
  offsetX: number,
  offsetY: number
): string {
  const computed = labelNode.ownerDocument.defaultView?.getComputedStyle(labelNode);
  const authored = computed?.translate;
  const parts = authored && authored !== "none" ? splitCssComponents(authored) : [];
  const authoredX = parts[0] ?? "0px";
  const authoredY = parts[1] ?? "0px";
  const authoredZ = parts[2];
  const x = offsetX === 0 ? authoredX : `calc(${authoredX} + ${offsetX}px)`;
  const y = offsetY === 0 ? authoredY : `calc(${authoredY} + ${offsetY}px)`;
  return authoredZ ? `${x} ${y} ${authoredZ}` : `${x} ${y}`;
}

function screenPixelOffsetInSvgUnits(
  labelNode: SVGElement,
  offsetX: number,
  offsetY: number
): { x: number; y: number } {
  const matrix = (labelNode as SVGGraphicsElement).getScreenCTM?.();
  if (!matrix) return { x: offsetX, y: offsetY };
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < Number.EPSILON) {
    return { x: offsetX, y: offsetY };
  }
  return {
    x: (matrix.d * offsetX - matrix.c * offsetY) / determinant,
    y: (-matrix.b * offsetX + matrix.a * offsetY) / determinant
  };
}

/**
 * Moves only the host-injected label node. Static HTML labels use relative
 * positioning so even plain inline text moves without leaving layout flow.
 * Authored positioned labels keep their positioning model and compose the host
 * offset through the independent translate property. SVG uses the host-created
 * line tspans and converts CSS-pixel movement through the live screen matrix.
 */
export function applyButtonLabelTextOffset(
  labelNode: LabelElement,
  offsetX: number,
  offsetY: number
): void {
  restoreTextOffsetStyles(labelNode);
  if (labelNode.namespaceURI === SVG_NAMESPACE) {
    const lines = svgLabelLines(labelNode as SVGElement);
    lines.forEach(restoreTextOffsetAttributes);
    if (offsetX === 0 && offsetY === 0) return;
    const localOffset = screenPixelOffsetInSvgUnits(labelNode as SVGElement, offsetX, offsetY);
    lines.forEach((line, index) => {
      if (offsetX !== 0) overrideTextOffsetAttribute(line, "dx", String(localOffset.x));
      if (index === 0 && offsetY !== 0) {
        overrideTextOffsetAttribute(line, "dy", String(localOffset.y));
      }
    });
    return;
  }
  if (offsetX === 0 && offsetY === 0) return;

  const computed = labelNode.ownerDocument.defaultView?.getComputedStyle(labelNode);
  if (computed?.position && computed.position !== "static") {
    overrideTextOffsetStyle(labelNode, "translate", composedTranslate(labelNode, offsetX, offsetY));
  } else {
    overrideTextOffsetStyle(labelNode, "position", "relative");
    overrideTextOffsetStyle(labelNode, "left", `${offsetX}px`);
    overrideTextOffsetStyle(labelNode, "top", `${offsetY}px`);
  }
}
