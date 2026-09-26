import type { ButtonPlacement } from "../types.js";
import type { FlowCellBounds } from "../../types.js";
import type { ProgramPopoutThemeScreenGeometry } from "../../theme/programPopoutTheme.js";

export interface ProgramPopoutThemeWindowRange {
  programName: string;
  monitorKey: string;
  minimumY: number;
  maximumY: number;
}

export function programPopoutThemeProgramKey(programName: string): string {
  return programName.normalize("NFC").trim().toLocaleLowerCase("en");
}

/** Only the placements being rendered contribute, including a collapsed owner. */
export function programPopoutThemeWindowRange(
  programName: string,
  placements: readonly Pick<ButtonPlacement, "y" | "height">[],
  geometry: (ProgramPopoutThemeScreenGeometry & { monitorWorkArea: FlowCellBounds }) | undefined
): ProgramPopoutThemeWindowRange | undefined {
  if (!geometry || !programName.trim()) return undefined;
  const { visibleBounds, envelope, monitorWorkArea } = geometry;
  if (![visibleBounds.Top, envelope.y, monitorWorkArea.Left, monitorWorkArea.Top].every(Number.isFinite) ||
      ![visibleBounds.Height, envelope.height, monitorWorkArea.Width, monitorWorkArea.Height]
        .every((value) => Number.isFinite(value) && value > 0)) return undefined;
  const centers = placements
    .filter((placement) => Number.isFinite(placement.y) && Number.isFinite(placement.height) && placement.height > 0)
    .map((placement) => visibleBounds.Top +
      (placement.y + placement.height / 2 - envelope.y) * visibleBounds.Height / envelope.height);
  if (centers.length === 0) return undefined;
  return {
    programName: programPopoutThemeProgramKey(programName),
    monitorKey: [monitorWorkArea.Left, monitorWorkArea.Top, monitorWorkArea.Width, monitorWorkArea.Height].join(","),
    minimumY: Math.min(...centers),
    maximumY: Math.max(...centers)
  };
}

export function isProgramPopoutThemeWindowRange(value: unknown): value is ProgramPopoutThemeWindowRange {
  if (!value || typeof value !== "object") return false;
  const range = value as ProgramPopoutThemeWindowRange;
  return typeof range.programName === "string" && Boolean(range.programName) &&
    typeof range.monitorKey === "string" && Boolean(range.monitorKey) &&
    Number.isFinite(range.minimumY) && Number.isFinite(range.maximumY) && range.minimumY <= range.maximumY;
}

export function aggregateProgramPopoutThemeScreenRange(
  own: ProgramPopoutThemeWindowRange | undefined,
  peers: Iterable<ProgramPopoutThemeWindowRange>
): { minimumY: number; maximumY: number } | undefined {
  if (!own) return undefined;
  let { minimumY, maximumY } = own;
  for (const peer of peers) {
    if (peer.programName !== own.programName || peer.monitorKey !== own.monitorKey) continue;
    minimumY = Math.min(minimumY, peer.minimumY);
    maximumY = Math.max(maximumY, peer.maximumY);
  }
  return { minimumY, maximumY };
}
