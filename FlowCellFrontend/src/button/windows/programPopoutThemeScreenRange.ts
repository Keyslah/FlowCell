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
}

export interface ProgramPopoutThemeScreenBox {
  minimumY: number;
  maximumY: number;
  minimumX?: number;
  maximumX?: number;
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
    rendered.every((placement) => Number.isFinite(placement.x) && Number.isFinite(placement.width));
  const centersX = hasX
    ? rendered.map((placement) => visibleBounds.Left! +
      (placement.x! + placement.width! / 2 - envelope.x!) * visibleBounds.Width! / envelope.width!)
    : [];
  return {
    programName: programPopoutThemeProgramKey(programName),
    monitorKey: [monitorWorkArea.Left, monitorWorkArea.Top, monitorWorkArea.Width, monitorWorkArea.Height].join(","),
    minimumY: Math.min(...centers),
    maximumY: Math.max(...centers),
    ...(hasX ? { minimumX: Math.min(...centersX), maximumX: Math.max(...centersX) } : {})
  };
}

export function isProgramPopoutThemeWindowRange(value: unknown): value is ProgramPopoutThemeWindowRange {
  if (!value || typeof value !== "object") return false;
  const range = value as ProgramPopoutThemeWindowRange;
  const hasX = range.minimumX !== undefined || range.maximumX !== undefined;
  return typeof range.programName === "string" && Boolean(range.programName) &&
    typeof range.monitorKey === "string" && Boolean(range.monitorKey) &&
    Number.isFinite(range.minimumY) && Number.isFinite(range.maximumY) && range.minimumY <= range.maximumY &&
    (!hasX || (Number.isFinite(range.minimumX) && Number.isFinite(range.maximumX) && range.minimumX! <= range.maximumX!));
}

export function aggregateProgramPopoutThemeScreenRange(
  own: ProgramPopoutThemeWindowRange | undefined,
  peers: Iterable<ProgramPopoutThemeWindowRange>
): ProgramPopoutThemeScreenBox | undefined {
  if (!own) return undefined;
  let { minimumY, maximumY, minimumX, maximumX } = own;
  for (const peer of peers) {
    if (peer.programName !== own.programName || peer.monitorKey !== own.monitorKey) continue;
    minimumY = Math.min(minimumY, peer.minimumY);
    maximumY = Math.max(maximumY, peer.maximumY);
    if (minimumX !== undefined && maximumX !== undefined &&
        peer.minimumX !== undefined && peer.maximumX !== undefined) {
      minimumX = Math.min(minimumX, peer.minimumX);
      maximumX = Math.max(maximumX, peer.maximumX);
    }
  }
  return minimumX !== undefined && maximumX !== undefined
    ? { minimumY, maximumY, minimumX, maximumX }
    : { minimumY, maximumY };
}
