export type CommandId =
  | "flowcell.run_script"
  | "flowcell.run_macro"
  | "flowcell.run_tool_action"
  | "flowcell.run_builtin"
  | "windows.chrome_workspace.save"
  | "windows.chrome_workspace.open";

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
  ActiveScriptFolder?: string;
  RuntimeScriptFolder?: string;
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
  ExecutionTarget?: string;
  Tooltip?: string;
  Shortcut?: string;
  BindingId?: number;
  style_group_id?: string;
  transparent_popout?: boolean;
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
  bridgeJs?: string;
  cardHtml?: string;
  cardCss?: string;
  cardSvg?: string;
  themeBinding?: "black-tint";
  sizingMode?:
    | "intrinsic"
    | "fit-uniform"
    | "responsive-uniform"
    | "fill-stretch"
    | "cover-crop";
  allowOverflow?: boolean;
  mainButtonSizePercent?: number;
  fanChildWidth?: number;
  fanChildHeight?: number;
  fanOwnerWidth?: number;
  fanOwnerHeight?: number;
  fixedWidth?: number;
  fixedHeight?: number;
  labelMaxWidth?: number;
  labelMinScale?: number;
  labelScale?: number;
  // false disables the two-word stacked-label overlay for this skin (labels
  // stay on one line and rely on font shrinking alone). Default: enabled.
  labelStack?: boolean;
  // Set only on Appearance-hub-authored runtime skins: the host runs a
  // click-triggered play latch (data-play) that stays up until the skin's
  // play animations finish. Never persisted into FlowCellState.
  hubPlayLatch?: boolean;
  // Hub group/single-popout rule: "cell" stretches the skin's core to fill
  // the popout's uniform template cell (text fits via shrink/stack) instead
  // of rendering at the skin's natural size.
  hubPopoutFit?: "cell";
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
  | "main-program-buttons"
  | "main-rails"
  | "main-panel-surface"
  | "main-buttons"
  | "main-cards"
  | "main-misc"
  | "main-window-buttons"
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
  blackTintOpacity: number;
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

export interface BindableButtonRecord {
  id: string;
  label: string;
  kind: string;
  target: string;
  executionTarget?: string;
  bindingId?: number;
  shortcut?: string;
}

export interface BindablePanelRecord {
  name: string;
  buttons: BindableButtonRecord[];
}

export interface BindableProgramRecord {
  name: string;
  programTabId: number;
  panels: BindablePanelRecord[];
}

export interface FrontendMacroSummaryRecord {
  id: string;
  label: string;
  programName: string;
  panelName: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShortcutProfileEntry {
  shortcut: string;
  display?: string;
  reason?: string;
  source?: string;
}

export interface ShortcutProfileFile {
  id: string;
  displayName?: string;
  platform?: string;
  processNames?: string[];
  blocked?: ShortcutProfileEntry[];
  reserved?: ShortcutProfileEntry[];
  preferred?: string[];
  notes?: string;
}

export interface ShortcutProfileDocument {
  fileName: string;
  profileId: string;
  isLocalOverride: boolean;
  profile: ShortcutProfileFile;
}

export interface BindsWorkspaceData {
  programs: BindableProgramRecord[];
  macros: FrontendMacroSummaryRecord[];
  bindings: FlowCellBindingsState;
  shortcutProfiles: ShortcutProfileDocument[];
  warnings: string[];
}

export interface BindingMutationResult {
  ok?: boolean;
  message: string;
  bindingId?: number;
  shortcut?: string;
  bindings?: FlowCellBindingsState;
  [key: string]: unknown;
}

export interface ManagedScriptInstallResultItem {
  label?: string;
  tooltip?: string;
  sourcePath: string;
  activePath: string;
  executionTarget: string;
  installed: boolean;
  message?: string;
}

export interface ManagedScriptInstallResult {
  installedCount: number;
  failedCount: number;
  statusMessage: string;
  reloadRequired?: boolean;
  reloadReason?: string;
  results: ManagedScriptInstallResultItem[];
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

export type LayoutSnapshotWindowKind =
  | "flatten-revolve-toolbox"
  | "generic-toolbox"
  | "dimensions-toolbox"
  | "theme-toolbox"
  | "rotate-toolbox"
  | "alignment-toolbox"
  | "boolean-toolbox"
  | "remesh-toolbox"
  | "tri-poly-toolbox"
  | "smart-axis-toolbox"
  | "panel-fan"
  | "panel-fan-options"
  | "script-group-popout"
  | "codex-usage-popout";

export interface LayoutSnapshotWindow {
  Kind: LayoutSnapshotWindowKind;
  ProgramName?: string;
  PanelName?: string;
  FileName?: string;
  Label?: string;
  SelectedFileNames?: string[];
  Bounds: FlowCellBounds;
}

export interface LayoutSnapshot {
  SavedAt?: string;
  Version?: number;
  LayoutKind?: string;
  FlowCellStatePath?: string;
  SelectedProgramName?: string;
  SelectedPanelName?: string;
  SelectedFileNames?: string[];
  MainWindowBounds?: FlowCellBounds | null;
  PanelPopouts?: LayoutSnapshotPanelPopout[];
  ToolPopouts?: LayoutSnapshotToolPopout[];
  PopoutClusters?: PopoutClusterRecord[];
  Windows?: LayoutSnapshotWindow[];
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
    | "button-reorder"
    | "binds"
    | "button-options"
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
    active_script_folder: string;
    runtime_script_folder: string;
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
