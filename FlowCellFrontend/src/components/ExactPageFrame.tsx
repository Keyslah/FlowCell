import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type ExactPage = {
  id: string;
  width: number;
  height: number;
  viewBox: string;
};

type ExactPageFrameProps = {
  page: ExactPage;
  children: ReactNode;
};

type FitState = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export function ExactPageFrame({ page, children }: ExactPageFrameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<FitState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0
  });

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const updateFit = () => {
      const rect = container.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const scale = Math.min(rect.width / page.width, rect.height / page.height);
      const nextScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
      const offsetX = (rect.width - page.width * nextScale) / 2;
      const offsetY = (rect.height - page.height * nextScale) / 2;

      setFit((current) => {
        const unchanged =
          Math.abs(current.scale - nextScale) < 0.0001 &&
          Math.abs(current.offsetX - offsetX) < 0.5 &&
          Math.abs(current.offsetY - offsetY) < 0.5;

        if (unchanged) {
          return current;
        }

        return {
          scale: nextScale,
          offsetX,
          offsetY
        };
      });
    };

    updateFit();

    const observer = new ResizeObserver(() => {
      updateFit();
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [page.height, page.width]);

  return (
    <div className="exact-page-frame" ref={containerRef}>
      <div
        className="exact-page-frame__plane"
        data-page-id={page.id}
        data-view-box={page.viewBox}
        style={{
          width: `${page.width}px`,
          height: `${page.height}px`,
          transform: `translate(${fit.offsetX}px, ${fit.offsetY}px) scale(${fit.scale})`
        }}
      >
        {children}
      </div>
    </div>
  );
}
