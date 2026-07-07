import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ImportedSkin, StyleGroup, FlowCellButton } from "../types";
import { getImportedSkin, resolveStyleGroup } from "../lib/skins";
import { HostSkinButton } from "./HostSkinButton";
import type { FanClusterEntry } from "./FanOutButtonCluster";

export interface ViewportRect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

interface OwnerFanoutOverlayProps {
  ownerButton: FlowCellButton;
  ownerRect: ViewportRect;
  layout: "row" | "grid" | "radial";
  childEntries: FanClusterEntry[];
  styleGroups?: StyleGroup[];
  importedSkins?: ImportedSkin[];
  onChildEnter: () => void;
  onChildLeave: () => void;
  onChildClick: (entry: FanClusterEntry) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function OwnerFanoutOverlay({
  ownerButton,
  ownerRect,
  layout,
  childEntries,
  styleGroups,
  importedSkins,
  onChildEnter,
  onChildLeave,
  onChildClick
}: OwnerFanoutOverlayProps) {
  const clusterRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<CSSProperties>({
    left: 0,
    top: 0,
    visibility: "hidden"
  });
  const columns = useMemo(() => {
    if (childEntries.length <= 1) {
      return 1;
    }
    if (layout === "row") {
      return Math.min(childEntries.length, 4);
    }
    return Math.min(Math.max(Math.ceil(Math.sqrt(childEntries.length)), 2), 3);
  }, [childEntries.length, layout]);

  useLayoutEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) {
      return;
    }

    const nextWidth = cluster.offsetWidth;
    const nextHeight = cluster.offsetHeight;
    const viewportPadding = 12;
    const unclampedLeft = ownerRect.left + ownerRect.width / 2 - nextWidth / 2;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - nextWidth - viewportPadding);
    const left = clamp(unclampedLeft, viewportPadding, maxLeft);
    const top = Math.max(viewportPadding, ownerRect.top - nextHeight - 10);

    setPlacement((current) => {
      const previousLeft =
        typeof current.left === "number" ? current.left : Number(current.left ?? 0);
      const previousTop = typeof current.top === "number" ? current.top : Number(current.top ?? 0);
      if (
        Math.abs(previousLeft - left) < 0.5 &&
        Math.abs(previousTop - top) < 0.5 &&
        current.visibility === "visible"
      ) {
        return current;
      }
      return {
        left,
        top,
        visibility: "visible"
      };
    });
  }, [childEntries.length, columns, ownerRect]);

  if (typeof document === "undefined" || childEntries.length === 0) {
    return null;
  }

  return createPortal(
    <div className="owner-fanout-overlay" aria-hidden="true">
      <div
        ref={clusterRef}
        className="owner-fanout-overlay__cluster"
        style={{
          ...placement,
          ["--fanout-columns" as string]: String(columns)
        }}
        data-owner-button-id={ownerButton.Id}
      >
        {childEntries.map((entry) => {
          const styleGroup = resolveStyleGroup(styleGroups, entry.button.style_group_id ?? "");
          const importedSkin = getImportedSkin(importedSkins, styleGroup?.importedSkinId);
          return (
            <div
              key={`${entry.button.Id}-${entry.childSlotId}`}
              className="owner-fanout-overlay__slot"
              onMouseEnter={onChildEnter}
              onMouseLeave={onChildLeave}
            >
              <HostSkinButton
                type="button"
                label={entry.button.Label}
                flowId={entry.button.Id}
                aria-label={entry.button.Label}
                data-flow-tooltip={entry.button.Tooltip || entry.button.Label}
                className="owner-fanout-overlay__button"
                styleGroup={styleGroup}
                importedSkin={importedSkin}
                skinCompact={true}
                onClick={() => onChildClick(entry)}
              />
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
