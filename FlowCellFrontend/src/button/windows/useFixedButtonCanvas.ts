import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
  return Number.isFinite(value) && value > 0 ? value : 1;
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

    const initialPositionRevision = positionEventRevision;
    const initialScaleRevision = scaleEventRevision;
    void Promise.all([
      currentWindow.outerPosition().catch(() => null),
      currentWindow.scaleFactor().catch(() => 1)
    ]).then(([position, scaleFactor]) => {
      if (!position) return;
      const patch: Partial<FixedButtonCanvasMetrics> = {};
      if (positionEventRevision === initialPositionRevision) {
        patch.left = position.x;
        patch.top = position.y;
      }
      if (scaleEventRevision === initialScaleRevision) {
        patch.scaleFactor = scaleFactor;
      }
      if (Object.keys(patch).length > 0) commit(patch);
    });

    void currentWindow.onMoved(({ payload }) => {
      positionEventRevision += 1;
      commit({ left: payload.x, top: payload.y });
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else unlistenMoved = unlisten;
    }).catch(() => {});

    void currentWindow.onScaleChanged(({ payload }) => {
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
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else unlistenScaleChanged = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      unlistenMoved?.();
      unlistenScaleChanged?.();
    };
  }, []);

  return metrics;
}
