import type { ButtonPlacement } from "../types.js";
import type { FlowCellBounds } from "../../types.js";
import type { ProgramPopoutThemeScreenGeometry } from "../../theme/programPopoutTheme.js";

export interface ProgramPopoutThemeWindowRange {
  programName: string;
  monitorKey: string;
  minimumY: number;
  maximumY: number;
  /** Present when the window reports horizontal geometry, for tilted gradients. */
  minimumX?: number;
  maximumX?: number;
  /** Actual physical Button centers keep rotated ranges off empty box corners. */
  centers?: readonly { x: number; y: number }[];
}

export interface ProgramPopoutThemeScreenBox {
  minimumY: number;
  maximumY: number;
  minimumX?: number;
  maximumX?: number;
  centers?: readonly { x: number; y: number }[];
}

export function programPopoutThemeProgramKey(programName: string): string {
  return programName.normalize("NFC").trim().toLocaleLowerCase("en");
}

/** Only the placements being rendered contribute, including a collapsed owner. */
export function programPopoutThemeWindowRange(
  programName: string,
  placements: readonly (Pick<ButtonPlacement, "y" | "height"> & Partial<Pick<ButtonPlacement, "x" | "width">>)[],
  geometry: (ProgramPopoutThemeScreenGeometry & { monitorWorkArea: FlowCellBounds }) | undefined
): ProgramPopoutThemeWindowRange | undefined {
  if (!geometry || !programName.trim()) return undefined;
  const { visibleBounds, envelope, monitorWorkArea } = geometry;
  if (![visibleBounds.Top, envelope.y, monitorWorkArea.Left, monitorWorkArea.Top].every(Number.isFinite) ||
      ![visibleBounds.Height, envelope.height, monitorWorkArea.Width, monitorWorkArea.Height]
        .every((value) => Number.isFinite(value) && value > 0)) return undefined;
  const rendered = placements
    .filter((placement) => Number.isFinite(placement.y) && Number.isFinite(placement.height) && placement.height > 0);
  const centers = rendered.map((placement) => visibleBounds.Top +
    (placement.y + placement.height / 2 - envelope.y) * visibleBounds.Height / envelope.height);
  if (centers.length === 0) return undefined;
  const hasX = Number.isFinite(visibleBounds.Left) && Number.isFinite(envelope.x) &&
    Number.isFinite(visibleBounds.Width) && (visibleBounds.Width ?? 0) > 0 &&
    Number.isFinite(envelope.width) && (envelope.width ?? 0) > 0 &&
    rendered.every((placement) => Number.isFinite(placement.x) && Number.isFinite(placement.width) && placement.width! > 0);
  const centersX = hasX
    ? rendered.map((placement) => visibleBounds.Left! +
      (placement.x! + placement.width! / 2 - envelope.x!) * visibleBounds.Width! / envelope.width!)
    : [];
  return {
    programName: programPopoutThemeProgramKey(programName),
    monitorKey: [monitorWorkArea.Left, monitorWorkArea.Top, monitorWorkArea.Width, monitorWorkArea.Height].join(","),
    minimumY: Math.min(...centers),
    maximumY: Math.max(...centers),
    ...(hasX ? {
      minimumX: Math.min(...centersX), maximumX: Math.max(...centersX),
      centers: centers.map((y, index) => ({ x: centersX[index], y }))
    } : {})
  };
}

export function isProgramPopoutThemeWindowRange(value: unknown): value is ProgramPopoutThemeWindowRange {
  if (!value || typeof value !== "object") return false;
  const range = value as ProgramPopoutThemeWindowRange;
  const hasX = range.minimumX !== undefined || range.maximumX !== undefined;
  return typeof range.programName === "string" && Boolean(range.programName) &&
    typeof range.monitorKey === "string" && Boolean(range.monitorKey) &&
    Number.isFinite(range.minimumY) && Number.isFinite(range.maximumY) && range.minimumY <= range.maximumY &&
    (!hasX || (Number.isFinite(range.minimumX) && Number.isFinite(range.maximumX) && range.minimumX! <= range.maximumX!)) &&
    (range.centers === undefined || (hasX && Array.isArray(range.centers) && range.centers.length > 0 &&
      range.centers.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)) &&
      Math.min(...range.centers.map((point) => point.x)) === range.minimumX &&
      Math.max(...range.centers.map((point) => point.x)) === range.maximumX &&
      Math.min(...range.centers.map((point) => point.y)) === range.minimumY &&
      Math.max(...range.centers.map((point) => point.y)) === range.maximumY));
}

export function aggregateProgramPopoutThemeScreenRange(
  own: ProgramPopoutThemeWindowRange | undefined,
  peers: Iterable<ProgramPopoutThemeWindowRange>
): ProgramPopoutThemeScreenBox | undefined {
  if (!isProgramPopoutThemeWindowRange(own)) return undefined;
  let { minimumY, maximumY, minimumX, maximumX } = own;
  let centers = own.centers ? [...own.centers] : undefined;
  for (const peer of peers) {
    if (!isProgramPopoutThemeWindowRange(peer) || peer.programName !== own.programName || peer.monitorKey !== own.monitorKey) continue;
    minimumY = Math.min(minimumY, peer.minimumY);
    maximumY = Math.max(maximumY, peer.maximumY);
    if (minimumX !== undefined && maximumX !== undefined &&
        peer.minimumX !== undefined && peer.maximumX !== undefined) {
      minimumX = Math.min(minimumX, peer.minimumX);
      maximumX = Math.max(maximumX, peer.maximumX);
    }
    // A legacy peer cannot supply an exact rotated range; retain its vertical
    // contribution until all participating windows report current geometry.
    centers = centers && peer.centers ? [...centers, ...peer.centers] : undefined;
  }
  return minimumX !== undefined && maximumX !== undefined
    ? { minimumY, maximumY, minimumX, maximumX, ...(centers ? { centers } : {}) }
    : { minimumY, maximumY };
}
