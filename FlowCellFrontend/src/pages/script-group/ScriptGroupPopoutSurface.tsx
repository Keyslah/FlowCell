// The literal script-group popout surface: template SVG grid + positioned
// buttons (stock and hub-skinned). This is THE render used by the real popout
// window (ScriptGroupPopoutWindowPage) AND the Appearance Hub preview — one
// code path, so the preview is the real thing by construction. Callers own
// behavior: the real window activates scripts, the hub passes a no-op.

import { useMemo } from "react";
import { MAIN_PAGE_IMPORTED_STYLE_GROUP } from "../../components/ButtonHost";
import { HostSkinButton } from "../../components/HostSkinButton";
import { getScriptGroupPopoutTemplate } from "../../lib/scriptGroupPopoutTemplates";
import type { ScriptGroupPopoutType } from "../../lib/scriptGroupPopoutSettings";
import {
  resolveSkinPort,
  useSkinPortRevision,
  type HubPlacement,
  type SkinPortResolution
} from "../appearance-hub/SkinPort";
import "./scriptGroupPopoutWindowPage.css";

export type ScriptGroupPopoutSurfaceScript = {
  fileName: string;
  label: string;
  tooltip?: string;
};

type ScriptGroupPopoutSurfaceProps = {
  programName: string;
  panelName: string;
  popoutType: ScriptGroupPopoutType;
  scripts: ScriptGroupPopoutSurfaceScript[];
  // Box the canonical surface uniformly scales into. Omit to render at
  // canonical size (scale 1) — the real window's default open size.
  availableWidth?: number;
  availableHeight?: number;
  // Hub-skin resolver override: the hub preview injects a draft-aware
  // resolver so unapplied text/code edits render live. Defaults to the live
  // SkinPort resolution used by the real window.
  skinResolver?: (fileName: string) => SkinPortResolution | null;
  onActivate: (fileName: string) => void;
  onHoverStart?: (fileName: string) => void;
  onHoverEnd?: (fileName: string) => void;
};

type PositionedScriptButton = {
  id: string;
  fileName: string;
  label: string;
  tooltip?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
};

const SINGLE_BUTTON_LABEL_HORIZONTAL_PADDING = 28;
const SINGLE_BUTTON_LABEL_MIN_FONT_SIZE = 10;

let textMeasureContext: CanvasRenderingContext2D | null = null;

function getTextMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") {
    return null;
  }

  if (!textMeasureContext) {
    textMeasureContext = document.createElement("canvas").getContext("2d");
  }

  return textMeasureContext;
}

function measureLabelWidth(label: string, fontSize: number): number {
  const context = getTextMeasureContext();
  if (!context) {
    return label.trim().length * fontSize * 0.56;
  }

  context.font = `700 ${fontSize}px "Segoe UI", sans-serif`;
  return context.measureText(label).width;
}

function resolveSingleButtonFontSize(label: string, buttonWidth: number, baseFontSize: number): number {
  const availableWidth = Math.max(1, buttonWidth - SINGLE_BUTTON_LABEL_HORIZONTAL_PADDING);
  const measuredWidth = Math.max(1, measureLabelWidth(label, baseFontSize));

  if (measuredWidth <= availableWidth) {
    return baseFontSize;
  }

  return Math.max(
    SINGLE_BUTTON_LABEL_MIN_FONT_SIZE,
    Math.floor((baseFontSize * availableWidth * 100) / measuredWidth) / 100
  );
}

function splitTwoWordButtonLabel(label: string): [string, string] | null {
  const words = label
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);

  if (words.length !== 2) {
    return null;
  }

  return [words[0], words[1]];
}

function buildScriptButtons(args: {
  programName: string;
  panelName: string;
  popoutType: ScriptGroupPopoutType;
  scripts: ScriptGroupPopoutSurfaceScript[];
}): PositionedScriptButton[] {
  const template = getScriptGroupPopoutTemplate(args.popoutType);

  return args.scripts.map((script, index) => {
    const columnIndex = index % template.buttonsPerRow;
    const rowIndex = Math.floor(index / template.buttonsPerRow);
    const rect = template.rowRects[columnIndex];

    return {
      id: [
        "script-group-popout",
        args.programName.trim().toLowerCase(),
        args.panelName.trim().toLowerCase(),
        script.fileName.trim().toLowerCase()
      ].join("::"),
      fileName: script.fileName,
      label: script.label,
      tooltip: script.tooltip,
      x: rect.x,
      y: rect.y + template.rowHeight * rowIndex,
      width: rect.width,
      height: rect.height,
      rx: rect.rx,
      ry: rect.ry
    };
  });
}

export function ScriptGroupPopoutSurface({
  programName,
  panelName,
  popoutType,
  scripts,
  availableWidth,
  availableHeight,
  skinResolver,
  onActivate,
  onHoverStart,
  onHoverEnd
}: ScriptGroupPopoutSurfaceProps) {
  // Re-render when hub assignments change in any window.
  const skinPortRevision = useSkinPortRevision();
  const template = useMemo(() => getScriptGroupPopoutTemplate(popoutType), [popoutType]);
  const buttons = useMemo(
    () => buildScriptButtons({ programName, panelName, popoutType, scripts }),
    [programName, panelName, popoutType, scripts]
  );
  const hubPlacement: HubPlacement = template.type === "single" ? "popped-single" : "popped-group";
  const resolveSkin =
    skinResolver ??
    ((fileName: string) =>
      resolveSkinPort({
        programName,
        panelName,
        buttonKey: fileName,
        placement: hubPlacement
      }));
  const rowCount = Math.max(1, Math.ceil(Math.max(scripts.length, 1) / template.buttonsPerRow));
  const canonicalWidth = template.rowWidth;
  const canonicalHeight = template.rowHeight * rowCount;
  const uniformScale = Math.max(
    0.1,
    Math.min(
      (availableWidth ?? canonicalWidth) / canonicalWidth,
      (availableHeight ?? canonicalHeight) / canonicalHeight
    )
  );
  const scaledWidth = canonicalWidth * uniformScale;
  const scaledHeight = canonicalHeight * uniformScale;

  return (
    <div
      className="script-group-popout__surface-frame"
      style={{
        width: `${scaledWidth}px`,
        height: `${scaledHeight}px`
      }}
    >
      <section
        className="script-group-popout__surface"
        style={{
          width: `${canonicalWidth}px`,
          height: `${canonicalHeight}px`,
          transform: `scale(${uniformScale})`,
          transformOrigin: "top left"
        }}
      >
        <svg
          className="script-group-popout__svg"
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${canonicalWidth} ${canonicalHeight}`}
          aria-hidden="true"
        >
          {Array.from({ length: rowCount }, (_, rowIndex) => (
            <g
              key={`script-group-popout-row-${rowIndex}`}
              transform={`translate(0 ${template.rowHeight * rowIndex})`}
            >
              {template.rowRects.map((rect, rectIndex) => (
                <rect
                  key={`script-group-popout-row-${rowIndex}-rect-${rectIndex}`}
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  rx={rect.rx}
                  ry={rect.ry}
                  fill="none"
                  stroke="#fff"
                  strokeMiterlimit="10"
                />
              ))}
            </g>
          ))}
        </svg>

        {buttons.map((button) => {
          const isSingleButtonTemplate = template.type === "single";
          const skinPort = resolveSkin(button.fileName);
          if (skinPort) {
            // Sizing rule from the hub: "cell" fills the uniform template
            // rect (all buttons identical, label shrinks/stacks inside);
            // otherwise the skin renders at its natural size × user scale
            // (the footprint the hub measured), centered on the rect.
            const cellFit = skinPort.importedSkin.hubPopoutFit === "cell";
            const naturalFootprint =
              typeof skinPort.importedSkin.fixedWidth === "number" &&
              typeof skinPort.importedSkin.fixedHeight === "number"
                ? {
                    width: skinPort.importedSkin.fixedWidth,
                    height: skinPort.importedSkin.fixedHeight
                  }
                : undefined;
            return (
              <div
                key={`${button.id}-hub-${skinPortRevision}`}
                className="script-group-popout__hub-slot"
                style={
                  cellFit
                    ? {
                        position: "absolute",
                        left: `${button.x}px`,
                        top: `${button.y}px`,
                        width: `${button.width}px`,
                        height: `${button.height}px`
                      }
                    : {
                        position: "absolute",
                        left: `${button.x + button.width / 2}px`,
                        top: `${button.y + button.height / 2}px`,
                        transform: "translate(-50%, -50%)"
                      }
                }
              >
                <HostSkinButton
                  label={
                    skinPort.labelOverride !== undefined ? skinPort.labelOverride : button.label
                  }
                  // renderButtonSkin only mounts the imported-skin shadow
                  // root (and its interaction bridge) for skinId
                  // "imported-skin" — without this the skin degrades to
                  // an inert stock label.
                  styleGroup={MAIN_PAGE_IMPORTED_STYLE_GROUP}
                  importedSkin={skinPort.importedSkin}
                  footprintOverride={
                    cellFit
                      ? { width: button.width, height: button.height }
                      : naturalFootprint
                  }
                  hostMode="neutral"
                  // Hub skins do NOT wear the stock popout button class
                  // (no position/overflow/background from that pool). The
                  // hub lane (.host-skin-button--hub) owns their look.
                  className="script-group-popout__button--hub"
                  data-script-file-name={button.fileName}
                  data-flow-tooltip={button.tooltip?.trim() || button.label}
                  aria-label={button.label}
                  onClick={() => {
                    onActivate(button.fileName);
                  }}
                  onPointerEnter={() => onHoverStart?.(button.fileName)}
                  onPointerLeave={() => onHoverEnd?.(button.fileName)}
                  onPointerCancel={() => onHoverEnd?.(button.fileName)}
                />
              </div>
            );
          }
          const stackedLabelWords = isSingleButtonTemplate
            ? null
            : splitTwoWordButtonLabel(button.label);
          const isStackedLabel = stackedLabelWords !== null;
          const buttonFontSize = isSingleButtonTemplate
            ? resolveSingleButtonFontSize(
                button.label,
                button.width,
                template.buttonTextSize
              )
            : template.buttonTextSize * (isStackedLabel ? 0.82 : 1);

          return (
            <button
              key={button.id}
              type="button"
              className={`script-group-popout__button${
                isSingleButtonTemplate ? " script-group-popout__button--single" : ""
              }`}
              aria-label={button.label}
              data-flow-tooltip={button.tooltip?.trim() || button.label}
              data-script-file-name={button.fileName}
              style={{
                left: `${button.x}px`,
                top: `${button.y}px`,
                width: `${button.width}px`,
                height: `${button.height}px`,
                borderRadius: `${Math.min(button.rx, button.ry)}px`,
                fontSize: `${buttonFontSize}px`
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                onActivate(button.fileName);
              }}
              onPointerEnter={() => {
                onHoverStart?.(button.fileName);
              }}
              onPointerLeave={() => {
                onHoverEnd?.(button.fileName);
              }}
              onPointerCancel={() => {
                onHoverEnd?.(button.fileName);
              }}
              onClick={(event) => {
                if (event.detail === 0) {
                  onActivate(button.fileName);
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <span
                className={`script-group-popout__button-label${
                  isStackedLabel ? " script-group-popout__button-label--stacked" : ""
                }${
                  isSingleButtonTemplate ? " script-group-popout__button-label--single" : ""
                }`}
              >
                {isStackedLabel ? (
                  <>
                    <span>{stackedLabelWords[0]}</span>
                    <span>{stackedLabelWords[1]}</span>
                  </>
                ) : (
                  button.label
                )}
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}
