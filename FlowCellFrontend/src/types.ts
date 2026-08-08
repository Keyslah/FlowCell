export interface FlowCellBounds {
  Left: number;
  Top: number;
  Width: number;
  Height: number;
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
  ownerButtonId?: string;
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
  ownerButtonId?: string;
}

export interface BindablePanelRecord {
  name: string;
  buttons: BindableButtonRecord[];
}

export interface BindableProgramRecord {
  name: string;
  programTabId: number;
  shortcutProfileId?: string;
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

export type LayoutSnapshotWindowKind =
  | "button-editor"
  | "button-popout"
  | "button-fan"
  | "installed-page";

export interface LayoutSnapshotWindow {
  Kind: LayoutSnapshotWindowKind;
  ProgramName?: string;
  PanelName?: string;
  ButtonPopoutUnitId?: string;
  ButtonFanSetupId?: string;
  ButtonOwnerId?: string;
  ButtonDisplayMode?: "collapsed" | "expanded";
  InstalledPageFileName?: string;
  InstalledPageId?: string;
  Bounds: FlowCellBounds;
}

export interface LayoutSnapshot {
  SavedAt: string;
  Version: number;
  LayoutKind: "FlowCellWindowLayout";
  Windows: LayoutSnapshotWindow[];
}
