export type CommandId =
  | "flowcell.run_script"
  | "flowcell.run_macro"
  | "flowcell.run_tool_action"
  | "flowcell.run_builtin";

export interface FlowCellBounds {
  Left: number;
  Top: number;
  Width: number;
  Height: number;
}

export interface FlowCellProgramConfig {
  NormalizedName?: string;
  ProgramType?: string;
  ExePath?: string;
  ScriptFolder?: string;
  RunMethod?: string;
  AllowedScriptExtensions?: string[];
  BridgeFolder?: string;
  RequiresRestart?: boolean;
  ProcessNames?: string[];
}

export type FanoutDirection =
  | "up"
  | "down"
  | "left"
  | "right"
  | "center"
  | "up-left"
  | "up-right"
  | "down-left"
  | "down-right";

export type PanelFanLayout = "grid" | "radial" | "half-radial";

export type PanelFanPlacement =
  | "center"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface PanelFanOptions {
  layout: PanelFanLayout;
  placement: PanelFanPlacement;
}

export const DEFAULT_PANEL_FAN_OPTIONS: PanelFanOptions = {
  layout: "grid",
  placement: "bottom-left"
};

export interface FlowCellButton {
  Id: string;
  Kind: string;
  command_id: CommandId;
  Label: string;
  Target: string;
  Tooltip?: string;
  Shortcut?: string;
  BindingId?: number;
  style_group_id?: string;
  compound_tool_id?: string;
  fanout?: {
    child_button_ids: string[];
    layout: "row" | "grid" | "radial";
    direction?: FanoutDirection;
  };
}

export interface FlowCellPanel {
  Id: string;
  Name: string;
  IsPoppedOut?: boolean;
  PopoutBounds?: FlowCellBounds | null;
  FanOptions?: PanelFanOptions;
  Buttons: FlowCellButton[];
}

export interface FlowCellProgram {
  ProgramTabId: number;
  SelectedPanelId?: string;
  style_group_id?: string;
  ProgramConfig?: FlowCellProgramConfig;
  Panels: FlowCellPanel[];
}

export interface ImportedSkin {
  id: string;
  name: string;
  html: string;
  css: string;
  svg?: string;
  cardHtml?: string;
  cardCss?: string;
  cardSvg?: string;
}

export interface StyleGroup {
  id: string;
  index: number;
  name: string;
  skinId: string;
  importedSkinId?: string;
  accent: string;
}

export type SurfaceStyleSectionId =
  | "main-panels"
  | "main-panel-surface"
  | "main-cards"
  | "main-misc"
  | "popout-regular-buttons"
  | "popout-tools";

export interface SurfaceStyleAssignment {
  surface_id: SurfaceStyleSectionId;
  style_group_id: string;
}

export interface AppTheme {
  name: string;
  fontFamily: string;
  pageBackground: string;
  pageForeground: string;
  mutedForeground: string;
  surfaceColor: string;
  surfaceBorder: string;
  surfaceShadow: string;
  controlColor: string;
  buttonColor: string;
  inputColor: string;
  accentColor: string;
  successColor: string;
  dangerColor: string;
  mainCardBlurPx: number;
}

export type ToolPopoutLayoutMode = "Group" | "Individual" | "PanelFan" | "Fanout";

export interface ToolOptionStateRecord {
  ProgramTabId: number;
  PanelId: string;
  OwnerButtonId: string;
  ToolId: string;
  Values: Record<string, unknown>;
}

export interface FlowCellScriptBinding {
  id?: number;
  bindingId?: number;
  kind?: string;
  label?: string;
  status?: string;
  programTabId?: number;
  shortcut: string;
  target: string;
}

export interface FlowCellBindingsState {
  nextId?: number;
  scriptBindings: FlowCellScriptBinding[];
  actionHotkeys: Record<string, string>;
}

export interface BindingMutationResult {
  ok?: boolean;
  message: string;
  bindingId?: number;
  shortcut?: string;
  bindings?: FlowCellBindingsState;
  [key: string]: unknown;
}

export type RecordedMacroStepType =
  | "ActivateIllustrator"
  | "ActivateBlender"
  | "ActivatePhotoshop"
  | "ActivateWindows"
  | "Click"
  | "Wheel"
  | "Text"
  | "Key"
  | "Script"
  | "Macro";

export interface RecordedMacroStep {
  type: RecordedMacroStepType;
  delayMs: number;
  x?: string;
  y?: string;
  button?: string;
  count?: string;
  direction?: string;
  text?: string;
  keys?: string;
  scriptPath?: string;
  macroPath?: string;
}

export interface RecordedMacroDefinition {
  id: string;
  label: string;
  path?: string;
  steps: RecordedMacroStep[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AlignmentToolStateRecord {
  ProgramTabId: number;
  PanelId: string;
  OwnerButtonId: string;
  Modifiers: {
    X: string;
    Y: string;
    Z: string;
  };
}

export interface ToolPopoutRecord {
  ProgramTabId: number;
  PanelId: string;
  ButtonIds: string[];
  LayoutMode: ToolPopoutLayoutMode;
  Bounds?: FlowCellBounds | null;
}

export interface PopoutClusterRecord {
  Id: string;
  MemberIds: string[];
  GrabberOffset?: {
    X: number;
    Y: number;
  };
}

export interface SavedProgramRecord {
  SourceProgramTabId: number;
  SavedAt: string;
  Program: FlowCellProgram;
  AlignmentToolStates: AlignmentToolStateRecord[];
  ToolOptionStates: ToolOptionStateRecord[];
  ToolPopouts: ToolPopoutRecord[];
  PopoutClusters: PopoutClusterRecord[];
}

export interface SavedVisualThemeProgramAssignment {
  programId: number;
  style_group_id: string;
}

export interface SavedVisualThemeButtonAssignment {
  programId: number;
  panelId: string;
  buttonId: string;
  style_group_id: string;
}

export interface SavedVisualTheme {
  id: string;
  name: string;
  savedAt: string;
  appTheme: AppTheme;
  styleGroups: StyleGroup[];
  importedSkins: ImportedSkin[];
  surfaceStyleAssignments: SurfaceStyleAssignment[];
  programStyleAssignments: SavedVisualThemeProgramAssignment[];
  buttonStyleAssignments: SavedVisualThemeButtonAssignment[];
}

export interface FlowCellState {
  SelectedProgramTabId: number;
  MainWindowBounds?: FlowCellBounds;
  StartupRestorePopoutsOnly?: boolean;
  Programs: FlowCellProgram[];
  AlignmentToolStates?: AlignmentToolStateRecord[];
  ToolOptionStates?: ToolOptionStateRecord[];
  ToolPopouts?: ToolPopoutRecord[];
  PopoutClusters?: PopoutClusterRecord[];
  SavedPrograms?: SavedProgramRecord[];
  SavedVisualThemes?: SavedVisualTheme[];
  AppTheme?: AppTheme;
  StyleGroups?: StyleGroup[];
  ImportedSkins?: ImportedSkin[];
  SurfaceStyleAssignments?: SurfaceStyleAssignment[];
}

export interface RuntimeInfo {
  repoRoot: string;
  flowCellRoot: string;
  statePath: string;
  frontendLogPath: string;
}

export interface SavedLayoutFile {
  name: string;
  displayName: string;
  path: string;
  details: string;
  savedAt?: string;
  modifiedAt?: string;
}

export interface RecordedMacroChoice {
  id: string;
  label: string;
  path: string;
  createdAt?: string;
}

export interface LayoutSnapshotPanelPopout {
  ProgramTabId: number;
  ProgramName?: string;
  PanelId: string;
  PanelName?: string;
  Bounds: FlowCellBounds;
}

export interface LayoutSnapshotToolPopout {
  ProgramTabId: number;
  ProgramName?: string;
  PanelId: string;
  PanelName?: string;
  ButtonIds: string[];
  ButtonLabels?: string[];
  LayoutMode: ToolPopoutLayoutMode;
  Bounds?: FlowCellBounds | null;
}

export interface LayoutSnapshot {
  SavedAt?: string;
  Version?: number;
  LayoutKind?: string;
  FlowCellStatePath?: string;
  PanelPopouts?: LayoutSnapshotPanelPopout[];
  ToolPopouts?: LayoutSnapshotToolPopout[];
  PopoutClusters?: PopoutClusterRecord[];
}

export interface LoadStateResponse {
  state: FlowCellState;
  runtime: RuntimeInfo;
  bindings: FlowCellBindingsState;
}

export interface WindowContext {
  kind:
    | "main"
    | "panel-popout"
    | "tool-popout"
    | "panel-fan-options"
    | "button-appearance"
    | "layout-picker";
  programId?: number;
  panelId?: string;
  panelName?: string;
  ownerButtonId?: string;
  buttonId?: string;
  buttonIds?: string[];
  layoutMode?: ToolPopoutLayoutMode;
  buttonLabel?: string;
}

export interface CommandEnvelope {
  command_id: CommandId;
  program_id: number;
  panel_id: string;
  button_id: string;
  style_group_id?: string;
  owner_button_id?: string;
  child_slot_id?: string;
  tool_action?: string;
  payload?: Record<string, unknown>;
  source_surface?: string;
  request_id?: string;
  timestamp: string;
  tool_option_state?: Record<string, unknown>;
  program: {
    id: number;
    label: string;
    normalized_name: string;
    program_type: string;
    run_method: string;
    script_folder: string;
    bridge_folder: string;
    exe_path: string;
    requires_restart: boolean;
    process_names: string[];
  };
}

export interface CommandResult {
  ok: boolean;
  request_id: string;
  status: string;
  message: string;
  details: Record<string, unknown>;
  logs: string[];
  exit_code: number;
  duration_ms: number;
}
