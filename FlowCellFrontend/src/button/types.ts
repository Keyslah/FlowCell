export const BUTTON_STATE_SCHEMA_VERSION = 1 as const;
export const BUTTON_SKIN_COMPILER_VERSION = 1 as const;

export type ButtonId = string;
export type ButtonPlacementId = string;
export type ButtonSurfaceId = string;
export type ButtonSkinId = string;
export type ButtonPopoutUnitId = string;
export type ButtonFanSetupId = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ButtonRole =
  | "single-script"
  | "tool-set-owner"
  | "tool-set-child"
  | "panel-owner";

export type ButtonTextFitMode = "shrink" | "stack-whole-words" | "shrink-and-stack";
export type ButtonTextAlignment = "skin" | "left" | "center" | "right";
export type ButtonResizeAnchor = "top-left";
export type ButtonWindowFitMode = "surface" | "hitbox" | "visual";
export type ButtonSurfaceKind =
  | "main"
  | "panel"
  | "regular-popout"
  | "tool-set-popout"
  | "fan";

export interface ButtonRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ButtonDesktopBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ButtonActivationAnimationPresetId = "plus-rise";

export interface ButtonActivationAnimation {
  presetId: ButtonActivationAnimationPresetId;
  desktopBounds: ButtonDesktopBounds;
}

export interface ButtonCoreMeasurement {
  width: number;
  height: number;
  visualOverflow: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface ButtonVisualState {
  hovered: boolean;
  pressed: boolean;
  held: boolean;
  play: boolean;
  release: boolean;
  error: boolean;
}

export interface ButtonVisualMeasurement extends ButtonCoreMeasurement {
  state: ButtonVisualState;
}

export interface ButtonSourceIdentity {
  displayProgramName: string;
  displayPanelName: string;
  displayFileName: string;
  normalizedProgramName: string;
  normalizedPanelName: string;
  normalizedFileName: string;
}

export interface ButtonEventActionMetadata {
  type?: string;
  action?: string;
  data?: JsonValue;
}

export type ButtonEventMetadata = Record<string, ButtonEventActionMetadata>;

export interface PanelScriptExecutionTarget {
  kind: "panel-script";
  programName: string;
  panelName: string;
  fileName: string;
  events?: ButtonEventMetadata;
}

export interface ToolSetActionExecutionTarget {
  kind: "tool-set-action";
  programName: string;
  panelName: string;
  ownerFileName: string;
  command: string;
  payload?: JsonObject;
  events?: ButtonEventMetadata;
}

export interface CoreActionExecutionTarget {
  kind: "core-action";
  actionId: string;
  payload?: JsonObject;
  events?: ButtonEventMetadata;
}

export type ButtonExecutionTarget =
  | PanelScriptExecutionTarget
  | ToolSetActionExecutionTarget
  | CoreActionExecutionTarget;

export type ButtonPayloadTemplateValue =
  | JsonPrimitive
  | ButtonPayloadTemplateValue[]
  | { [key: string]: ButtonPayloadTemplateValue }
  | { $field: string };

export type ButtonPayloadTemplate = Record<string, ButtonPayloadTemplateValue>;

export interface ButtonToolSetChildBehavior {
  toggleFields?: string[];
  fieldPatch?: Record<string, JsonValue>;
  activationPatch?: Record<string, JsonValue>;
  activateField?: string;
  inlineEditField?: string;
  execute?: boolean;
  payloadTemplate?: ButtonPayloadTemplate;
}

export interface ButtonRecord {
  id: ButtonId;
  role: ButtonRole;
  sourceIdentity: ButtonSourceIdentity | null;
  label: string;
  tooltip: string;
  executionTarget: ButtonExecutionTarget | null;
  defaultSkinId: ButtonSkinId;
  defaultTextFitMode: ButtonTextFitMode;
  disabled: boolean;
  activationAnimation: ButtonActivationAnimation | null;
  toolSetParentId: ButtonId | null;
  toolSetBehavior: ButtonToolSetChildBehavior | null;
  metadata: JsonObject;
}

export interface ButtonPlacement extends ButtonRect {
  id: ButtonPlacementId;
  buttonId: ButtonId;
  surfaceId: ButtonSurfaceId;
  zIndex: number;
  skinOverrideId: ButtonSkinId | null;
  textFitMode: ButtonTextFitMode;
  textAlignment: ButtonTextAlignment;
  minimumFontSize: number;
  textSizeOverride: number | null;
  allowLabelResize: boolean;
  matchHitboxToSkin: boolean;
  allowStretching: boolean;
  resizeAnchor: ButtonResizeAnchor;
}

export interface ButtonSurface {
  id: ButtonSurfaceId;
  name: string;
  kind: ButtonSurfaceKind;
  width: number;
  height: number;
  placementIds: ButtonPlacementId[];
  visualOverflowAllowance: number;
  uniformButtonSize: Pick<ButtonRect, "width" | "height"> | null;
}

export type ButtonSkinSectionName =
  | "structure"
  | "keyframes"
  | "base"
  | "hover"
  | "play"
  | "pressed"
  | "held"
  | "release"
  | "disabled"
  | "error";

export interface ButtonSkinCompileCache {
  compilerVersion: typeof BUTTON_SKIN_COMPILER_VERSION;
  sourceFingerprint: string;
}

export interface ButtonSkin {
  id: ButtonSkinId;
  name: string;
  structure: string;
  keyframes: string;
  base: string;
  hover: string;
  play: string;
  pressed: string;
  held: string;
  release: string;
  disabled: string;
  error: string;
  metadata: JsonObject;
  compileCache: ButtonSkinCompileCache | null;
}

export type ButtonPopoutOpenRule = "toggle" | "click" | "hover" | "manual";
export type ButtonPopoutCloseRule = "toggle" | "escape" | "hover-out" | "manual";

export interface ButtonToolFieldOption {
  id: string;
  label: string;
  value: JsonPrimitive;
}

export type ButtonToolFieldServiceTarget = ToolSetActionExecutionTarget | CoreActionExecutionTarget;

interface ButtonToolFieldBase extends ButtonRect {
  id: string;
  label: string;
  payloadKey: string;
  zIndex: number;
  hidden?: boolean;
  disabled?: boolean;
  serviceTrigger?: "change" | "activate";
  serviceTarget?: ButtonToolFieldServiceTarget;
}

export interface ButtonTextToolField extends ButtonToolFieldBase {
  kind: "text";
  defaultValue: string;
  placeholder?: string;
}

export interface ButtonNumberToolField extends ButtonToolFieldBase {
  kind: "number";
  defaultValue: number;
  minimum?: number;
  maximum?: number;
  step?: number;
}

export interface ButtonSelectToolField extends ButtonToolFieldBase {
  kind: "select";
  defaultValue: JsonPrimitive;
  options: ButtonToolFieldOption[];
}

export interface ButtonToggleToolField extends ButtonToolFieldBase {
  kind: "toggle";
  defaultValue: boolean;
}

export interface ButtonPathToolField extends ButtonToolFieldBase {
  kind: "path";
  defaultValue: string;
  pathKind: "file" | "folder";
  filter?: string;
}

export interface ButtonColorToolField extends ButtonToolFieldBase {
  kind: "color";
  defaultValue: string;
}

export interface ButtonDisplayToolField extends ButtonToolFieldBase {
  kind: "display";
  defaultValue: string | number | boolean | null;
  format?: string;
}

export type ButtonToolField =
  | ButtonTextToolField
  | ButtonNumberToolField
  | ButtonSelectToolField
  | ButtonToggleToolField
  | ButtonPathToolField
  | ButtonColorToolField
  | ButtonDisplayToolField;

interface ButtonPopoutUnitBase {
  id: ButtonPopoutUnitId;
  name: string;
  surfaceId: ButtonSurfaceId;
  canonicalBounds: ButtonRect;
  desktopBounds: ButtonDesktopBounds | null;
  desktopBoundsFitMode?: ButtonWindowFitMode;
  desktopBoundsEnvelope?: ButtonRect;
  openRule: ButtonPopoutOpenRule;
  closeRule: ButtonPopoutCloseRule;
  transparency: number;
  pinnedDefault: boolean;
  windowFitMode?: ButtonWindowFitMode;
}

export interface RegularButtonPopoutUnit extends ButtonPopoutUnitBase {
  kind: "regular";
  memberPlacementIds: ButtonPlacementId[];
  memberSourceIdentities: ButtonSourceIdentity[];
  selectionKey: string;
}

export interface ToolSetButtonPopoutUnit extends ButtonPopoutUnitBase {
  kind: "tool-set";
  ownerButtonId: ButtonId;
  childButtonIds: ButtonId[];
  childPlacementIds: ButtonPlacementId[];
  fields: ButtonToolField[];
}

export type ButtonPopoutUnit = RegularButtonPopoutUnit | ToolSetButtonPopoutUnit;

export interface ButtonFanAnimationSettings {
  durationMs: number;
  easing: string;
  staggerMs: number;
}

export interface ButtonFanSetup {
  id: ButtonFanSetupId;
  name: string;
  programName: string;
  panelName: string;
  panelOwnerButtonId: ButtonId;
  fanMemberButtonIds: ButtonId[];
  selectedToolSetOwnerButtonIds: ButtonId[];
  fanSurfaceId: ButtonSurfaceId;
  fanMemberPlacementIds: ButtonPlacementId[];
  toolSetOwnerAnchors: Record<ButtonId, ButtonDesktopBounds>;
  // Physical desktop pixels captured when the user drags the collapsed fan
  // window; absent until the fan has been anchored for the first time.
  collapsedPanelOwnerBounds?: ButtonDesktopBounds;
  collapsedBoundsFitMode?: ButtonWindowFitMode;
  collapsedBoundsEnvelope?: ButtonRect;
  openRule: ButtonPopoutOpenRule;
  closeRule: ButtonPopoutCloseRule;
  pinnedDefault: boolean;
  animation: ButtonFanAnimationSettings;
  windowFitMode?: ButtonWindowFitMode;
}

export interface ButtonDocumentSettings {
  gridSize: number;
  snapTolerance: number;
  defaultGap: number;
  defaultSurfacePadding: number;
  defaultSkinId: ButtonSkinId;
  defaultMinimumFontSize: number;
  allowSurfaceAutoExpansion: boolean;
}

export interface ButtonStateDocument {
  schemaVersion: typeof BUTTON_STATE_SCHEMA_VERSION;
  revision: number;
  buttons: Record<ButtonId, ButtonRecord>;
  placements: Record<ButtonPlacementId, ButtonPlacement>;
  surfaces: Record<ButtonSurfaceId, ButtonSurface>;
  skins: Record<ButtonSkinId, ButtonSkin>;
  popoutUnits: Record<ButtonPopoutUnitId, ButtonPopoutUnit>;
  fanSetups: Record<ButtonFanSetupId, ButtonFanSetup>;
  settings: ButtonDocumentSettings;
}

export type ButtonEditorMode = "run" | "edit";
