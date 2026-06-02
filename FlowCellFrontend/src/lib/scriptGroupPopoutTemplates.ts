import {
  normalizeScriptGroupPopoutType,
  type ScriptGroupPopoutType
} from "./scriptGroupPopoutSettings";

export type ScriptGroupPopoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
};

export type ScriptGroupPopoutTemplate = {
  type: ScriptGroupPopoutType;
  label: string;
  rowWidth: number;
  rowHeight: number;
  buttonsPerRow: number;
  buttonTextSize: number;
  rowRects: readonly ScriptGroupPopoutRect[];
};

const FOUR_ROW_RECTS: readonly ScriptGroupPopoutRect[] = [
  { x: 0.5, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 63.405263, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 126.310526, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 189.21579, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 }
] as const;

const FOUR_ROW_TEMPLATE: ScriptGroupPopoutTemplate = {
  type: "4row",
  label: "4row",
  rowWidth: 252.621053,
  rowHeight: 35.863158,
  buttonsPerRow: 4,
  buttonTextSize: 9.5,
  rowRects: FOUR_ROW_RECTS
};

export function getScriptGroupPopoutTemplate(
  popoutType: ScriptGroupPopoutType
): ScriptGroupPopoutTemplate {
  switch (normalizeScriptGroupPopoutType(popoutType)) {
    case "4row":
    default:
      return FOUR_ROW_TEMPLATE;
  }
}

export function buildScriptGroupPopoutWindowSize(
  popoutType: ScriptGroupPopoutType,
  scriptCount: number
): {
  width: number;
  height: number;
} {
  const template = getScriptGroupPopoutTemplate(popoutType);
  const clampedCount = Math.max(scriptCount, 1);
  const rowCount = Math.max(1, Math.ceil(clampedCount / template.buttonsPerRow));
  return {
    width: template.rowWidth,
    height: template.rowHeight * rowCount
  };
}
