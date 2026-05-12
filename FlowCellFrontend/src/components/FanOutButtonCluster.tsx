import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type {
  FanoutDirection,
  FlowCellButton,
  ImportedSkin,
  PanelFanPlacement,
  StyleGroup
} from "../types";
import { getImportedSkin, resolveStyleGroup } from "../lib/skins";
import { HostSkinButton } from "./HostSkinButton";

export interface FanClusterEntry {
  programId: number;
  panelId: string;
  panelName: string;
  button: FlowCellButton;
  childSlotId: string;
}

export interface FanClusterInteractiveRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FanClusterPanelMetrics {
  windowWidth: number;
  windowHeight: number;
  ownerLeft: number;
  ownerTop: number;
  ownerWidth: number;
  ownerHeight: number;
  childRects: FanClusterInteractiveRect[];
}

export interface FanClusterFloatingMetrics extends FanClusterPanelMetrics {
  direction: FanoutDirection;
}

interface FanClusterChildLayout extends FanClusterInteractiveRect {
  closedDx: number;
  closedDy: number;
}

interface FanClusterPanelLayout extends FanClusterPanelMetrics {
  childLayouts: FanClusterChildLayout[];
}

interface FanClusterFloatingLayout extends FanClusterFloatingMetrics {
  childLayouts: FanClusterChildLayout[];
}

interface FanClusterVisualSpec {
  key: string;
  entry: FanClusterEntry;
}

interface FanOutButtonClusterProps {
  ownerButton: FlowCellButton;
  layout?: "row" | "grid" | "radial" | "half-radial";
  direction?: FanoutDirection;
  placement?: PanelFanPlacement;
  variant: "panel-fan" | "floating-fanout";
  layoutMetricsOverride?: FanClusterPanelMetrics | FanClusterFloatingMetrics | null;
  windowExpanded: boolean;
  childrenVisible: boolean;
  suspendInteraction?: boolean;
  onExpandRequest?: () => void;
  onCollapseRequest?: () => void;
  onPanelFanMetricsChange?: (metrics: FanClusterPanelMetrics | null) => void;
  onFloatingMetricsChange?: (metrics: FanClusterFloatingMetrics | null) => void;
  childButtons: FanClusterEntry[];
  styleGroups?: StyleGroup[];
  importedSkins?: ImportedSkin[];
  ownerStyleGroupOverride?: StyleGroup;
  ownerImportedSkinOverride?: ImportedSkin;
  styleGroupOverride?: StyleGroup;
  importedSkinOverride?: ImportedSkin;
  onOwnerClick: () => void;
  onChildClick: (entry: FanClusterEntry) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readStableNodeSize(
  node: HTMLElement | null | undefined,
  fallback?: { width?: number; height?: number }
): { width: number; height: number } {
  if (node) {
    const width = Math.max(node.offsetWidth, node.clientWidth, node.scrollWidth);
    const height = Math.max(node.offsetHeight, node.clientHeight, node.scrollHeight);
    if (width > 0 && height > 0) {
      return {
        width: Math.ceil(width),
        height: Math.ceil(height)
      };
    }
  }

  return {
    width: Math.max(Math.ceil(fallback?.width ?? 0), 1),
    height: Math.max(Math.ceil(fallback?.height ?? 0), 1)
  };
}

function areRectsEqual(
  left: FanClusterInteractiveRect[],
  right: FanClusterInteractiveRect[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const next = right[index];
    return (
      Math.abs(entry.left - next.left) < 0.5 &&
      Math.abs(entry.top - next.top) < 0.5 &&
      Math.abs(entry.width - next.width) < 0.5 &&
      Math.abs(entry.height - next.height) < 0.5
    );
  });
}

function arePanelLayoutsEqual(
  left: FanClusterPanelLayout | null,
  right: FanClusterPanelLayout
): boolean {
  return Boolean(
    left &&
      Math.abs(left.windowWidth - right.windowWidth) < 0.5 &&
      Math.abs(left.windowHeight - right.windowHeight) < 0.5 &&
      Math.abs(left.ownerLeft - right.ownerLeft) < 0.5 &&
      Math.abs(left.ownerTop - right.ownerTop) < 0.5 &&
      Math.abs(left.ownerWidth - right.ownerWidth) < 0.5 &&
      Math.abs(left.ownerHeight - right.ownerHeight) < 0.5 &&
      areRectsEqual(left.childRects, right.childRects)
  );
}

function areFloatingLayoutsEqual(
  left: FanClusterFloatingLayout | null,
  right: FanClusterFloatingLayout
): boolean {
  return Boolean(left && left.direction === right.direction && arePanelLayoutsEqual(left, right));
}

function resolvePanelColumns(count: number): number {
  if (count <= 1) {
    return 1;
  }
  return clamp(Math.ceil(Math.sqrt(count)), 2, 4);
}

function resolveFloatingColumns(args: {
  layout: "row" | "grid" | "radial";
  direction: FanoutDirection;
  count: number;
}): number {
  if (args.count <= 1) {
    return 1;
  }

  if (args.layout === "row") {
    if (args.direction === "left" || args.direction === "right") {
      return 1;
    }
    return Math.min(args.count, 4);
  }

  return clamp(Math.ceil(Math.sqrt(args.count)), 2, 4);
}

function buildGridMetrics(
  sizes: Array<{ width: number; height: number }>,
  columns: number,
  gap: number
): {
  rows: number;
  columnWidths: number[];
  rowHeights: number[];
  gridWidth: number;
  gridHeight: number;
} {
  if (sizes.length === 0) {
    return {
      rows: 0,
      columnWidths: [],
      rowHeights: [],
      gridWidth: 0,
      gridHeight: 0
    };
  }

  const normalizedColumns = Math.max(columns, 1);
  const rows = Math.ceil(sizes.length / normalizedColumns);
  const columnWidths = Array.from({ length: normalizedColumns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);

  sizes.forEach((entry, index) => {
    const column = index % normalizedColumns;
    const row = Math.floor(index / normalizedColumns);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, entry.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, entry.height);
  });

  return {
    rows,
    columnWidths,
    rowHeights,
    gridWidth:
      columnWidths.reduce((total, value) => total + value, 0) +
      gap * Math.max(columnWidths.length - 1, 0),
    gridHeight:
      rowHeights.reduce((total, value) => total + value, 0) +
      gap * Math.max(rowHeights.length - 1, 0)
  };
}

function sumBefore(values: number[], endExclusive: number, gap: number): number {
  let total = 0;
  for (let index = 0; index < endExclusive; index += 1) {
    total += values[index] ?? 0;
  }
  return total + Math.max(endExclusive, 0) * gap;
}

function buildChildLayouts(args: {
  sizes: Array<{ width: number; height: number }>;
  columns: number;
  columnWidths: number[];
  rowHeights: number[];
  gap: number;
  gridLeft: number;
  gridTop: number;
  rowTops?: number[];
  ownerCenterX: number;
  ownerCenterY: number;
}): FanClusterChildLayout[] {
  return args.sizes.map((entry, index) => {
    const column = args.columns === 0 ? 0 : index % args.columns;
    const row = args.columns === 0 ? 0 : Math.floor(index / args.columns);
    const left =
      args.gridLeft +
      sumBefore(args.columnWidths, column, args.gap) +
      ((args.columnWidths[column] ?? entry.width) - entry.width) / 2;
    const rowTop =
      args.rowTops?.[row] ??
      (args.gridTop + sumBefore(args.rowHeights, row, args.gap));
    const top =
      rowTop +
      ((args.rowHeights[row] ?? entry.height) - entry.height) / 2;
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: entry.width,
      height: entry.height,
      closedDx: Math.round(args.ownerCenterX - (left + entry.width / 2)),
      closedDy: Math.round(args.ownerCenterY - (top + entry.height / 2))
    };
  });
}

function resolveHorizontalAlignment(placement: PanelFanPlacement): "left" | "center" | "right" {
  switch (placement) {
    case "top":
    case "bottom":
    case "center":
      return "center";
    case "top-right":
    case "bottom-right":
      return "right";
    case "top-left":
    case "bottom-left":
    default:
      return "left";
  }
}

function resolveVerticalAlignment(placement: PanelFanPlacement): "top" | "center" | "bottom" {
  switch (placement) {
    case "top":
    case "top-left":
    case "top-right":
      return "top";
    case "center":
      return "center";
    case "bottom":
    case "bottom-left":
    case "bottom-right":
    default:
      return "bottom";
  }
}

function resolveFanCenterVector(placement: PanelFanPlacement): { x: number; y: number } {
  const horizontal = resolveHorizontalAlignment(placement);
  const vertical = resolveVerticalAlignment(placement);
  return {
    x: horizontal === "left" ? 1 : horizontal === "right" ? -1 : 0,
    y: vertical === "top" ? 1 : vertical === "bottom" ? -1 : 0
  }
}

function finalizePanelLayout(args: {
  ownerRect: FanClusterInteractiveRect;
  childRects: FanClusterInteractiveRect[];
}): FanClusterPanelLayout {
  const minLeft = Math.min(args.ownerRect.left, ...args.childRects.map((entry) => entry.left));
  const minTop = Math.min(args.ownerRect.top, ...args.childRects.map((entry) => entry.top));
  const maxRight = Math.max(
    args.ownerRect.left + args.ownerRect.width,
    ...args.childRects.map((entry) => entry.left + entry.width)
  );
  const maxBottom = Math.max(
    args.ownerRect.top + args.ownerRect.height,
    ...args.childRects.map((entry) => entry.top + entry.height)
  );
  const shiftX = minLeft < 0 ? -minLeft : 0;
  const shiftY = minTop < 0 ? -minTop : 0;
  const ownerLeft = Math.round(args.ownerRect.left + shiftX);
  const ownerTop = Math.round(args.ownerRect.top + shiftY);
  const ownerCenterX = ownerLeft + args.ownerRect.width / 2;
  const ownerCenterY = ownerTop + args.ownerRect.height / 2;
  const childLayouts = args.childRects.map((entry) => {
    const left = Math.round(entry.left + shiftX);
    const top = Math.round(entry.top + shiftY);
    return {
      left,
      top,
      width: entry.width,
      height: entry.height,
      closedDx: Math.round(ownerCenterX - (left + entry.width / 2)),
      closedDy: Math.round(ownerCenterY - (top + entry.height / 2))
    };
  });

  return {
    windowWidth: Math.ceil(maxRight - minLeft),
    windowHeight: Math.ceil(maxBottom - minTop),
    ownerLeft,
    ownerTop,
    ownerWidth: args.ownerRect.width,
    ownerHeight: args.ownerRect.height,
    childRects: childLayouts.map(({ left, top, width, height }) => ({
      left,
      top,
      width,
      height
    })),
    childLayouts
  };
}

function computePanelLayout(args: {
  owner: { width: number; height: number };
  childSizes: Array<{ width: number; height: number }>;
  layout: "grid" | "radial" | "half-radial";
  placement: PanelFanPlacement;
}): FanClusterPanelLayout {
  const ownerWidth = Math.max(args.owner.width, 1);
  const ownerHeight = Math.max(args.owner.height, 1);
  const ownerRect: FanClusterInteractiveRect = {
    left: 0,
    top: 0,
    width: ownerWidth,
    height: ownerHeight
  };
  const childSizes = args.childSizes.map((entry) => ({
    width: Math.max(entry.width, ownerWidth),
    height: Math.max(entry.height, ownerHeight)
  }));
  if (childSizes.length === 0) {
    return finalizePanelLayout({
      ownerRect,
      childRects: []
    });
  }

  if (args.layout === "grid") {
    const columns = resolvePanelColumns(childSizes.length);
    const gap = 12;
    const ownerGap = 10;
    const gridMetrics = buildGridMetrics(childSizes, columns, gap);
    const horizontalAlignment = resolveHorizontalAlignment(args.placement);
    const verticalAlignment = resolveVerticalAlignment(args.placement);

    if (args.placement === "center") {
      if (gridMetrics.rows <= 1) {
        const leftCount = Math.floor(childSizes.length / 2);
        const leftSizes = childSizes.slice(0, leftCount);
        const rightSizes = childSizes.slice(leftCount);
        const leftWidth =
          leftSizes.reduce((total, entry) => total + entry.width, 0) +
          gap * Math.max(leftSizes.length - 1, 0);
        const maxChildHeight = childSizes.reduce(
          (maxValue, entry) => Math.max(maxValue, entry.height),
          ownerHeight
        );
        const nextOwnerRect: FanClusterInteractiveRect = {
          ...ownerRect,
          left: leftWidth > 0 ? leftWidth + ownerGap : 0,
          top: Math.max((maxChildHeight - ownerHeight) / 2, 0)
        };
        let currentLeft = 0;
        const childRects: FanClusterInteractiveRect[] = [];

        leftSizes.forEach((entry) => {
          childRects.push({
            left: currentLeft,
            top: Math.max((maxChildHeight - entry.height) / 2, 0),
            width: entry.width,
            height: entry.height
          });
          currentLeft += entry.width + gap;
        });

        currentLeft =
          nextOwnerRect.left +
          ownerWidth +
          (rightSizes.length > 0 ? ownerGap : 0);

        rightSizes.forEach((entry) => {
          childRects.push({
            left: currentLeft,
            top: Math.max((maxChildHeight - entry.height) / 2, 0),
            width: entry.width,
            height: entry.height
          });
          currentLeft += entry.width + gap;
        });

        return finalizePanelLayout({
          ownerRect: nextOwnerRect,
          childRects
        });
      }

      const contentWidth = Math.max(ownerWidth, gridMetrics.gridWidth);
      const ownerLeft = (contentWidth - ownerWidth) / 2;
      const topRows = Math.floor(gridMetrics.rows / 2);
      const topBlockHeight =
        gridMetrics.rowHeights.slice(0, topRows).reduce((total, value) => total + value, 0) +
        gap * Math.max(topRows - 1, 0);
      const nextOwnerRect: FanClusterInteractiveRect = {
        ...ownerRect,
        left: ownerLeft,
        top: topBlockHeight + (topRows > 0 ? ownerGap : 0)
      };
      const bottomStartTop =
        nextOwnerRect.top + ownerHeight + (topRows < gridMetrics.rows ? ownerGap : 0);
      const bottomRowHeights = gridMetrics.rowHeights.slice(topRows);
      const rowTops = gridMetrics.rowHeights.map((_, rowIndex) => {
        if (rowIndex < topRows) {
          return sumBefore(gridMetrics.rowHeights, rowIndex, gap);
        }
        return bottomStartTop + sumBefore(bottomRowHeights, rowIndex - topRows, gap);
      });

      return finalizePanelLayout({
        ownerRect: nextOwnerRect,
        childRects: buildChildLayouts({
          sizes: childSizes,
          columns,
          columnWidths: gridMetrics.columnWidths,
          rowHeights: gridMetrics.rowHeights,
          gap,
          gridLeft: (contentWidth - gridMetrics.gridWidth) / 2,
          gridTop: 0,
          rowTops,
          ownerCenterX: nextOwnerRect.left + ownerWidth / 2,
          ownerCenterY: nextOwnerRect.top + ownerHeight / 2
        }).map(({ left, top, width, height }) => ({
          left,
          top,
          width,
          height
        }))
      });
    }

    let nextOwnerRect: FanClusterInteractiveRect;
    let gridLeft = 0;
    let gridTop = 0;
    if (verticalAlignment === "top" && horizontalAlignment === "center") {
      const contentWidth = Math.max(ownerWidth, gridMetrics.gridWidth);
      nextOwnerRect = {
        ...ownerRect,
        left: (contentWidth - ownerWidth) / 2,
        top: 0
      };
      gridLeft = (contentWidth - gridMetrics.gridWidth) / 2;
      gridTop = ownerHeight + ownerGap;
    } else if (verticalAlignment === "bottom" && horizontalAlignment === "center") {
      const contentWidth = Math.max(ownerWidth, gridMetrics.gridWidth);
      nextOwnerRect = {
        ...ownerRect,
        left: (contentWidth - ownerWidth) / 2,
        top: gridMetrics.gridHeight + ownerGap
      };
      gridLeft = (contentWidth - gridMetrics.gridWidth) / 2;
      gridTop = 0;
    } else {
      const contentWidth = ownerWidth + ownerGap + gridMetrics.gridWidth;
      const contentHeight = ownerHeight + ownerGap + gridMetrics.gridHeight;
      nextOwnerRect = {
        ...ownerRect,
        left: horizontalAlignment === "left" ? 0 : contentWidth - ownerWidth,
        top: verticalAlignment === "top" ? 0 : contentHeight - ownerHeight
      };
      gridLeft = horizontalAlignment === "left" ? ownerWidth + ownerGap : 0;
      gridTop = verticalAlignment === "top" ? ownerHeight + ownerGap : 0;
    }

    return finalizePanelLayout({
      ownerRect: nextOwnerRect,
      childRects: buildChildLayouts({
        sizes: childSizes,
        columns,
        columnWidths: gridMetrics.columnWidths,
        rowHeights: gridMetrics.rowHeights,
        gap,
        gridLeft,
        gridTop,
        ownerCenterX: nextOwnerRect.left + ownerWidth / 2,
        ownerCenterY: nextOwnerRect.top + ownerHeight / 2
      }).map(({ left, top, width, height }) => ({
        left,
        top,
        width,
        height
      }))
    });
  }

  const maxChildWidth = childSizes.reduce((maxValue, entry) => Math.max(maxValue, entry.width), ownerWidth);
  const maxChildHeight = childSizes.reduce((maxValue, entry) => Math.max(maxValue, entry.height), ownerHeight);
  const ownerGap = 12;
  const fanVector = resolveFanCenterVector(args.placement);
  const radialRadiusX = Math.max(maxChildWidth * 0.8, ownerWidth * 0.6) + Math.max(24, childSizes.length * 8);
  const radialRadiusY = Math.max(maxChildHeight * 0.8, ownerHeight * 0.6) + Math.max(24, childSizes.length * 8);
  const ownerCenterX = ownerWidth / 2;
  const ownerCenterY = ownerHeight / 2;
  const clusterOffsetX =
    fanVector.x === 0
      ? 0
      : fanVector.x * (radialRadiusX + ownerWidth / 2 + maxChildWidth / 2 + ownerGap);
  const clusterOffsetY =
    fanVector.y === 0
      ? 0
      : fanVector.y * (radialRadiusY + ownerHeight / 2 + maxChildHeight / 2 + ownerGap);
  const clusterCenterX = ownerCenterX + clusterOffsetX;
  const clusterCenterY = ownerCenterY + clusterOffsetY;
  const spread = args.layout === "half-radial" ? Math.PI : Math.PI * 2;
  const angleStep =
    childSizes.length <= 1
      ? 0
      : args.layout === "half-radial"
      ? spread / Math.max(childSizes.length - 1, 1)
      : spread / childSizes.length;
  const startAngle =
    args.layout === "half-radial"
      ? Math.atan2(fanVector.y === 0 ? -1 : fanVector.y, fanVector.x) - spread / 2
      : -Math.PI / 2;

  return finalizePanelLayout({
    ownerRect,
    childRects: childSizes.map((entry, index) => {
      const angle = startAngle + angleStep * index;
      const childCenterX = clusterCenterX + Math.cos(angle) * radialRadiusX;
      const childCenterY = clusterCenterY + Math.sin(angle) * radialRadiusY;
      return {
        left: childCenterX - entry.width / 2,
        top: childCenterY - entry.height / 2,
        width: entry.width,
        height: entry.height
      };
    })
  });
}

function computeFloatingLayout(args: {
  owner: { width: number; height: number };
  childSizes: Array<{ width: number; height: number }>;
  layout: "row" | "grid" | "radial";
  direction: FanoutDirection;
}): FanClusterFloatingLayout {
  const padding = 0;
  const gap = 8;
  const ownerGap = args.childSizes.length > 0 ? 10 : 0;
  const ownerWidth = Math.max(args.owner.width, 1);
  const ownerHeight = Math.max(args.owner.height, 1);
  const childSizes = args.childSizes.map((entry) => ({
    width: Math.max(entry.width, ownerWidth),
    height: Math.max(entry.height, ownerHeight)
  }));
  const columns =
    childSizes.length > 0
      ? resolveFloatingColumns({
          layout: args.layout,
          direction: args.direction,
          count: childSizes.length
        })
      : 0;
  const gridMetrics = buildGridMetrics(childSizes, columns, gap);

  let ownerLeft = padding;
  let ownerTop = padding;
  let gridLeft = padding;
  let gridTop = padding;
  let windowWidth = ownerWidth + padding * 2;
  let windowHeight = ownerHeight + padding * 2;

  switch (args.direction) {
    case "down":
      windowWidth = Math.max(ownerWidth, gridMetrics.gridWidth) + padding * 2;
      ownerLeft = 0;
      ownerTop = 0;
      gridLeft = 0;
      gridTop = ownerTop + ownerHeight + ownerGap;
      windowHeight = gridTop + gridMetrics.gridHeight + padding;
      break;
    case "left":
      windowHeight = Math.max(ownerHeight, gridMetrics.gridHeight) + padding * 2;
      gridLeft = padding;
      gridTop = padding;
      ownerLeft = gridLeft + gridMetrics.gridWidth + ownerGap;
      ownerTop = 0;
      windowWidth = ownerLeft + ownerWidth + padding;
      break;
    case "right":
      windowHeight = Math.max(ownerHeight, gridMetrics.gridHeight) + padding * 2;
      ownerLeft = padding;
      ownerTop = 0;
      gridLeft = ownerLeft + ownerWidth + ownerGap;
      gridTop = 0;
      windowWidth = gridLeft + gridMetrics.gridWidth + padding;
      break;
    case "up-left":
      gridLeft = padding;
      gridTop = padding;
      ownerLeft = gridLeft + gridMetrics.gridWidth + ownerGap;
      ownerTop = gridTop + gridMetrics.gridHeight + ownerGap;
      windowWidth = ownerLeft + ownerWidth + padding;
      windowHeight = ownerTop + ownerHeight + padding;
      break;
    case "up-right":
      ownerLeft = padding;
      gridLeft = ownerLeft + ownerWidth + ownerGap;
      gridTop = padding;
      ownerTop = gridTop + gridMetrics.gridHeight + ownerGap;
      windowWidth = gridLeft + gridMetrics.gridWidth + padding;
      windowHeight = ownerTop + ownerHeight + padding;
      break;
    case "down-left":
      gridLeft = padding;
      ownerLeft = gridLeft + gridMetrics.gridWidth + ownerGap;
      ownerTop = padding;
      gridTop = ownerTop + ownerHeight + ownerGap;
      windowWidth = ownerLeft + ownerWidth + padding;
      windowHeight = gridTop + gridMetrics.gridHeight + padding;
      break;
    case "down-right":
      ownerLeft = padding;
      ownerTop = padding;
      gridLeft = ownerLeft + ownerWidth + ownerGap;
      gridTop = ownerTop + ownerHeight + ownerGap;
      windowWidth = gridLeft + gridMetrics.gridWidth + padding;
      windowHeight = gridTop + gridMetrics.gridHeight + padding;
      break;
    case "center":
      windowWidth = Math.max(ownerWidth, gridMetrics.gridWidth) + padding * 2;
      windowHeight = Math.max(ownerHeight, gridMetrics.gridHeight) + padding * 2;
      ownerLeft = 0;
      ownerTop = 0;
      gridLeft = 0;
      gridTop = 0;
      break;
    case "up":
    default:
      windowWidth = Math.max(ownerWidth, gridMetrics.gridWidth) + padding * 2;
      gridLeft = 0;
      gridTop = padding;
      ownerLeft = 0;
      ownerTop = gridTop + gridMetrics.gridHeight + ownerGap;
      windowHeight = ownerTop + ownerHeight + padding;
      break;
  }

  const ownerCenterX = ownerLeft + ownerWidth / 2;
  const ownerCenterY = ownerTop + ownerHeight / 2;
  const childLayouts = buildChildLayouts({
    sizes: childSizes,
    columns,
    columnWidths: gridMetrics.columnWidths,
    rowHeights: gridMetrics.rowHeights,
    gap,
    gridLeft,
    gridTop,
    ownerCenterX,
    ownerCenterY
  });

  return {
    direction: args.direction,
    windowWidth: Math.ceil(windowWidth),
    windowHeight: Math.ceil(windowHeight),
    ownerLeft: Math.round(ownerLeft),
    ownerTop: Math.round(ownerTop),
    ownerWidth,
    ownerHeight,
    childRects: childLayouts.map(({ left, top, width, height }) => ({
      left,
      top,
      width,
      height
    })),
    childLayouts
  };
}

function hydrateLayoutFromMetrics(
  metrics: FanClusterPanelMetrics | FanClusterFloatingMetrics
): FanClusterPanelLayout {
  const ownerCenterX = metrics.ownerLeft + metrics.ownerWidth / 2;
  const ownerCenterY = metrics.ownerTop + metrics.ownerHeight / 2;
  return {
    ...metrics,
    childLayouts: metrics.childRects.map((entry) => ({
      left: entry.left,
      top: entry.top,
      width: entry.width,
      height: entry.height,
      closedDx: Math.round(ownerCenterX - (entry.left + entry.width / 2)),
      closedDy: Math.round(ownerCenterY - (entry.top + entry.height / 2))
    }))
  };
}

export function FanOutButtonCluster({
  ownerButton,
  layout = "radial",
  direction = "up",
  placement = "bottom-left",
  variant,
  layoutMetricsOverride,
  windowExpanded,
  childrenVisible,
  suspendInteraction = false,
  onExpandRequest,
  onCollapseRequest,
  onPanelFanMetricsChange,
  onFloatingMetricsChange,
  childButtons,
  styleGroups,
  importedSkins,
  ownerStyleGroupOverride,
  ownerImportedSkinOverride,
  styleGroupOverride,
  importedSkinOverride,
  onOwnerClick,
  onChildClick
}: FanOutButtonClusterProps) {
  const closeTimerRef = useRef<number | undefined>(undefined);
  const postExpandHoverTimerRef = useRef<number | undefined>(undefined);
  const pendingCollapseAfterExpandRef = useRef(false);
  const ownerVisibleRef = useRef<HTMLElement | null>(null);
  const visibleChildRefs = useRef(new Map<string, HTMLElement>());
  const lastPanelLayoutRef = useRef<FanClusterPanelLayout | null>(null);
  const lastFloatingLayoutRef = useRef<FanClusterFloatingLayout | null>(null);
  const [panelLayout, setPanelLayout] = useState<FanClusterPanelLayout | null>(null);
  const [floatingLayout, setFloatingLayout] = useState<FanClusterFloatingLayout | null>(null);
  const resolveButtonVisuals = (
    button: FlowCellButton,
    explicitStyleGroupOverride?: StyleGroup,
    explicitImportedSkinOverride?: ImportedSkin
  ) => {
    const buttonStyleGroup = resolveStyleGroup(styleGroups, button.style_group_id ?? "");
    const styleGroup = explicitStyleGroupOverride ?? buttonStyleGroup ?? styleGroupOverride;
    const importedSkin =
      explicitImportedSkinOverride ??
      getImportedSkin(importedSkins, styleGroup?.importedSkinId) ??
      importedSkinOverride;
    return {
      styleGroup,
      importedSkin
    };
  };
  const ownerVisuals = resolveButtonVisuals(
    ownerButton,
    ownerStyleGroupOverride,
    ownerImportedSkinOverride
  );
  const ownerStyleGroup = ownerVisuals.styleGroup;
  const ownerImportedSkin = ownerVisuals.importedSkin;
  const ownerClassName =
    variant === "panel-fan"
      ? [
          "fan-cluster__owner",
          "fan-cluster__owner--panel-fan",
          "panel-rail__popout"
        ]
          .filter(Boolean)
          .join(" ")
      : [
          "fan-cluster__owner",
          "fan-cluster__owner--floating-fanout"
        ]
          .filter(Boolean)
          .join(" ");

  const childVisuals = useMemo<FanClusterVisualSpec[]>(
    () =>
      childButtons.map((entry) => {
        return {
          key: `${entry.button.Id}-${entry.childSlotId}`,
          entry
        };
      }),
    [childButtons]
  );
  const floatingLayoutMode = layout === "half-radial" ? "radial" : layout;

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
      if (postExpandHoverTimerRef.current) {
        window.clearTimeout(postExpandHoverTimerRef.current);
      }
      onPanelFanMetricsChange?.(null);
      onFloatingMetricsChange?.(null);
    };
  }, [onFloatingMetricsChange, onPanelFanMetricsChange]);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };

  const clearPostExpandHoverTimer = () => {
    if (postExpandHoverTimerRef.current) {
      window.clearTimeout(postExpandHoverTimerRef.current);
      postExpandHoverTimerRef.current = undefined;
    }
  };

  const hasHoveredVisiblePill = () => {
    const ownerHovered = ownerVisibleRef.current?.matches(":hover") ?? false;
    const childHovered = Array.from(visibleChildRefs.current.values()).some((node) =>
      node.matches(":hover")
    );
    return ownerHovered || childHovered;
  };

  const requestExpand = () => {
    clearCloseTimer();
    clearPostExpandHoverTimer();
    pendingCollapseAfterExpandRef.current = false;
    if (suspendInteraction) {
      return;
    }
    onExpandRequest?.();
  };

  const scheduleCollapse = () => {
    clearCloseTimer();
    if (suspendInteraction) {
      onCollapseRequest?.();
      return;
    }

    if (windowExpanded && !childrenVisible) {
      pendingCollapseAfterExpandRef.current = true;
      return;
    }

    closeTimerRef.current = window.setTimeout(() => {
      if (hasHoveredVisiblePill()) {
        return;
      }
      onCollapseRequest?.();
    }, childrenVisible ? 140 : 240);
  };

  useEffect(() => {
    if (!windowExpanded) {
      pendingCollapseAfterExpandRef.current = false;
      clearPostExpandHoverTimer();
      return;
    }

    if (!childrenVisible || !pendingCollapseAfterExpandRef.current) {
      return;
    }

    clearPostExpandHoverTimer();
    postExpandHoverTimerRef.current = window.setTimeout(() => {
      postExpandHoverTimerRef.current = undefined;
      if (hasHoveredVisiblePill()) {
        pendingCollapseAfterExpandRef.current = false;
        return;
      }
      pendingCollapseAfterExpandRef.current = false;
      onCollapseRequest?.();
    }, 40);

    return () => {
      clearPostExpandHoverTimer();
    };
  }, [childrenVisible, onCollapseRequest, windowExpanded]);

  useLayoutEffect(() => {
    const ownerMetrics = readStableNodeSize(ownerVisibleRef.current);
    const childSizes = childVisuals.map((entry) =>
      readStableNodeSize(visibleChildRefs.current.get(entry.key), ownerMetrics)
    );

    if (variant === "panel-fan") {
      const nextLayout = computePanelLayout({
        owner: ownerMetrics,
        childSizes,
        layout: layout === "row" ? "grid" : layout,
        placement
      });
      if (!arePanelLayoutsEqual(lastPanelLayoutRef.current, nextLayout)) {
        lastPanelLayoutRef.current = nextLayout;
        setPanelLayout(nextLayout);
        onPanelFanMetricsChange?.(nextLayout);
      }
      return;
    }

    const nextLayout = computeFloatingLayout({
      owner: ownerMetrics,
      childSizes,
      layout: floatingLayoutMode,
      direction
    });
    if (!areFloatingLayoutsEqual(lastFloatingLayoutRef.current, nextLayout)) {
      lastFloatingLayoutRef.current = nextLayout;
      setFloatingLayout(nextLayout);
      onFloatingMetricsChange?.(nextLayout);
    }
  }, [
    childVisuals,
    direction,
    floatingLayoutMode,
    layout,
    onFloatingMetricsChange,
    onPanelFanMetricsChange,
    variant
  ]);

  useEffect(() => {
    if (variant === "panel-fan") {
      setFloatingLayout(null);
      lastFloatingLayoutRef.current = null;
      onFloatingMetricsChange?.(null);
      return;
    }

    setPanelLayout(null);
    lastPanelLayoutRef.current = null;
    onPanelFanMetricsChange?.(null);
  }, [onFloatingMetricsChange, onPanelFanMetricsChange, variant]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observeTargets: HTMLElement[] = [];
    if (ownerVisibleRef.current) {
      observeTargets.push(ownerVisibleRef.current);
    }
    childVisuals.forEach((entry) => {
      const node = visibleChildRefs.current.get(entry.key);
      if (node) {
        observeTargets.push(node);
      }
    });
    if (observeTargets.length === 0) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const ownerMetrics = readStableNodeSize(ownerVisibleRef.current);
      const childSizes = childVisuals.map((entry) =>
        readStableNodeSize(visibleChildRefs.current.get(entry.key), ownerMetrics)
      );

      if (variant === "panel-fan") {
        const nextLayout = computePanelLayout({
          owner: ownerMetrics,
          childSizes,
          layout: layout === "row" ? "grid" : layout,
          placement
        });
        if (!arePanelLayoutsEqual(lastPanelLayoutRef.current, nextLayout)) {
          lastPanelLayoutRef.current = nextLayout;
          setPanelLayout(nextLayout);
          onPanelFanMetricsChange?.(nextLayout);
        }
        return;
      }

      const nextLayout = computeFloatingLayout({
        owner: ownerMetrics,
        childSizes,
        layout: floatingLayoutMode,
        direction
      });
      if (!areFloatingLayoutsEqual(lastFloatingLayoutRef.current, nextLayout)) {
        lastFloatingLayoutRef.current = nextLayout;
        setFloatingLayout(nextLayout);
        onFloatingMetricsChange?.(nextLayout);
      }
    });

    observeTargets.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
    };
  }, [
    childVisuals,
    direction,
    floatingLayoutMode,
    layout,
    onFloatingMetricsChange,
    onPanelFanMetricsChange,
    variant
  ]);

  const overriddenLayout = useMemo(
    () => (layoutMetricsOverride ? hydrateLayoutFromMetrics(layoutMetricsOverride) : null),
    [layoutMetricsOverride]
  );
  const activeLayout = overriddenLayout ?? (variant === "panel-fan" ? panelLayout : floatingLayout);
  const contentExpanded = childrenVisible;
  const rootStyle =
    activeLayout
      ? ({
          width: `${contentExpanded ? activeLayout.windowWidth : activeLayout.ownerWidth}px`,
          height: `${contentExpanded ? activeLayout.windowHeight : activeLayout.ownerHeight}px`
        } satisfies CSSProperties)
      : undefined;
  const ownerStyle =
    activeLayout
      ? ({
          left: `${contentExpanded ? activeLayout.ownerLeft : 0}px`,
          top: `${contentExpanded ? activeLayout.ownerTop : 0}px`
        } satisfies CSSProperties)
      : undefined;

  return (
    <div
      className={[
        "fan-cluster",
        `fan-cluster--${variant}`,
        windowExpanded ? "is-window-open" : "",
        childrenVisible ? "is-open" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={rootStyle}
    >
      <div className="fan-cluster__stage">
        <HostSkinButton
          ref={ownerVisibleRef}
          type="button"
          className={ownerClassName}
          label={ownerButton.Label}
          styleGroup={ownerStyleGroup}
          importedSkin={ownerImportedSkin}
          skinCompact
          style={ownerStyle}
          title={ownerButton.Tooltip || ownerButton.Label}
          onMouseEnter={requestExpand}
          onMouseLeave={scheduleCollapse}
          onClick={onOwnerClick}
        />
        <div className="fan-cluster__children" aria-hidden={!childrenVisible}>
          {childVisuals.map((entry, index) => {
            const childLayout = activeLayout?.childLayouts[index];
            const childVisuals =
              variant === "panel-fan"
                ? ownerVisuals
                : resolveButtonVisuals(entry.entry.button);
            const childStyle =
              childLayout
                ? ({
                    left: `${childLayout.left}px`,
                    top: `${childLayout.top}px`,
                    width: `${childLayout.width}px`,
                    height: `${childLayout.height}px`,
                    ["--slot-delay" as string]: `${index * 16}ms`,
                    ["--slot-closed-dx" as string]: `${childLayout.closedDx}px`,
                    ["--slot-closed-dy" as string]: `${childLayout.closedDy}px`
                  } satisfies CSSProperties)
                : undefined;

            return (
              <HostSkinButton
                key={entry.key}
                ref={(node) => {
                  if (!node) {
                    visibleChildRefs.current.delete(entry.key);
                    return;
                  }
                  visibleChildRefs.current.set(entry.key, node);
                }}
                type="button"
                className={[
                  "fan-cluster__child",
                  `fan-cluster__child--${variant}`,
                  variant === "panel-fan" ? "panel-rail__popout" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                label={entry.entry.button.Label}
                styleGroup={childVisuals.styleGroup}
                importedSkin={childVisuals.importedSkin}
                skinCompact
                style={childStyle}
                title={entry.entry.button.Tooltip || entry.entry.button.Label}
                onMouseEnter={requestExpand}
                onMouseLeave={scheduleCollapse}
                onClick={() => onChildClick(entry.entry)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
