import type { ButtonTextFitMode } from "../types.js";

export interface ButtonTextMeasurement {
  width: number;
  height: number;
}

export interface ButtonTextFitPlan {
  lines: string[];
  fontSize: number;
  overflow: boolean;
}

export interface ButtonTextFitRequest {
  label: string;
  mode: ButtonTextFitMode;
  maximumWidth: number;
  maximumHeight: number;
  naturalFontSize: number;
  minimumFontSize: number;
  measure: (fontSize: number, lines: readonly string[]) => ButtonTextMeasurement;
}

export function splitButtonLabelWords(label: string): string[] {
  const normalized = label.trim().replace(/\s+/g, " ");
  return normalized ? normalized.split(" ") : [""];
}

function greedyWholeWordLines(
  words: readonly string[],
  fontSize: number,
  maximumWidth: number,
  measure: ButtonTextFitRequest["measure"]
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(fontSize, [candidate]).width > maximumWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

function fits(
  request: ButtonTextFitRequest,
  fontSize: number,
  lines: readonly string[]
): boolean {
  const measurement = request.measure(fontSize, lines);
  return measurement.width <= request.maximumWidth && measurement.height <= request.maximumHeight;
}

export function computeButtonTextFitPlan(request: ButtonTextFitRequest): ButtonTextFitPlan {
  const naturalFontSize = Math.max(1, request.naturalFontSize);
  const minimumFontSize = Math.min(naturalFontSize, Math.max(1, request.minimumFontSize));
  const words = splitButtonLabelWords(request.label);
  const canStack = request.mode !== "shrink";

  for (let fontSize = naturalFontSize; fontSize >= minimumFontSize; fontSize -= 0.5) {
    if (request.mode === "stack-whole-words" && fontSize !== naturalFontSize) {
      break;
    }
    const lines = canStack
      ? greedyWholeWordLines(words, fontSize, request.maximumWidth, request.measure)
      : [words.join(" ")];
    if (fits(request, fontSize, lines)) {
      return { lines, fontSize, overflow: false };
    }
  }

  const fallbackLines = canStack
    ? greedyWholeWordLines(words, minimumFontSize, request.maximumWidth, request.measure)
    : [words.join(" ")];
  return { lines: fallbackLines, fontSize: minimumFontSize, overflow: true };
}
