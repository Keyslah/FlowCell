import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { resolveButtonWebviewPixelRatio } from "./buttonWindowGeometry";

export interface FixedButtonCanvasMetrics {
  left: number;
  top: number;
  scaleFactor: number;
  ready: boolean;
}

const FALLBACK_METRICS: FixedButtonCanvasMetrics = {
  left: 0,
  top: 0,
  scaleFactor: 1,
  ready: false
};

function normalizedScaleFactor(value: number): number {
  return resolveButtonWebviewPixelRatio(
    value,
    typeof window === "undefined" ? undefined : window.devicePixelRatio
  );
}

export function useFixedButtonCanvasMetrics(): FixedButtonCanvasMetrics {
  const [metrics, setMetrics] = useState<FixedButtonCanvasMetrics>(FALLBACK_METRICS);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let cancelled = false;
    let unlistenMoved: (() => void) | null = null;
    let unlistenScaleChanged: (() => void) | null = null;
    let positionEventRevision = 0;
    let scaleEventRevision = 0;

    const commit = (patch: Partial<FixedButtonCanvasMetrics>) => {
      if (cancelled) return;
      setMetrics((current) => {
        const next = {
          ...current,
          ...patch,
          scaleFactor: normalizedScaleFactor(patch.scaleFactor ?? current.scaleFactor),
          ready: true
        };
        return current.left === next.left &&
          current.top === next.top &&
          current.scaleFactor === next.scaleFactor &&
          current.ready === next.ready
          ? current
          : next;
      });
    };

    const handleViewportResize = () => {
      if (cancelled) return;
      setMetrics((current) => {
        if (!current.ready) return current;
        const scaleFactor = normalizedScaleFactor(current.scaleFactor);
        return scaleFactor === current.scaleFactor
          ? current
          : { ...current, scaleFactor };
      });
    };
    window.addEventListener("resize", handleViewportResize);

    const initializeMetrics = async () => {
      const [stopMoved, stopScaleChanged] = await Promise.all([
        currentWindow.onMoved(({ payload }) => {
          positionEventRevision += 1;
          commit({ left: payload.x, top: payload.y });
        }).catch(() => null),
        currentWindow.onScaleChanged(({ payload }) => {
          scaleEventRevision += 1;
          const positionRevision = positionEventRevision;
          void currentWindow.outerPosition()
            .then((position) => commit(positionEventRevision === positionRevision
              ? {
                  left: position.x,
                  top: position.y,
                  scaleFactor: payload.scaleFactor
                }
              : { scaleFactor: payload.scaleFactor }))
            .catch(() => commit({ scaleFactor: payload.scaleFactor }));
        }).catch(() => null)
      ]);
      if (cancelled) {
        stopMoved?.();
        stopScaleChanged?.();
        return;
      }
      unlistenMoved = stopMoved;
      unlistenScaleChanged = stopScaleChanged;

      // Subscribe first, then take the authoritative snapshot. Otherwise the host can
      // move from its temporary creation origin to the fixed monitor canvas in the gap.
      const snapshotPositionRevision = positionEventRevision;
      const snapshotScaleRevision = scaleEventRevision;
      const [position, scaleFactor] = await Promise.all([
        currentWindow.outerPosition().catch(() => null),
        currentWindow.scaleFactor().catch(() => 1)
      ]);
      if (cancelled || !position) return;
      const patch: Partial<FixedButtonCanvasMetrics> = {};
      if (positionEventRevision === snapshotPositionRevision) {
        patch.left = position.x;
        patch.top = position.y;
      }
      if (scaleEventRevision === snapshotScaleRevision) {
        patch.scaleFactor = scaleFactor;
      }
      if (Object.keys(patch).length > 0) commit(patch);
    };
    void initializeMetrics();

    return () => {
      cancelled = true;
      unlistenMoved?.();
      unlistenScaleChanged?.();
      window.removeEventListener("resize", handleViewportResize);
    };
  }, []);

  return metrics;
}
