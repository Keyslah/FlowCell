import type {
  AlignmentToolStateRecord,
  AppTheme,
  CommandEnvelope,
  FlowCellBindingsState,
  FlowCellButton,
  FlowCellBounds,
  FlowCellPanel,
  FlowCellProgram,
  FlowCellState,
  LayoutSnapshot,
  PanelFanOptions,
  RuntimeInfo,
  SavedProgramRecord,
  SurfaceStyleAssignment,
  SurfaceStyleSectionId,
  StyleGroup,
  ToolOptionStateRecord,
  ToolPopoutRecord
} from "../types";
import { DEFAULT_PANEL_FAN_OPTIONS } from "../types";
import {
  DEFAULT_GLASS_HOVER_IMPORTED_SKIN,
  DEFAULT_IMPORTED_SKINS,
  isLegacyGlassHoverImportedSkin,
  normalizeAppTheme
} from "./theme";

const DEFAULT_IMPORTED_SKIN_ID = "imported-skin-01";
const DEFAULT_PROGRAM_STYLE_GROUP_ID = "style-group-03";
const DEFAULT_SURFACE_STYLE_ASSIGNMENTS: SurfaceStyleAssignment[] = [
  {
    surface_id: "main-panels",
    style_group_id: ""
  },
  {
    surface_id: "main-panel-surface",
    style_group_id: ""
  },
  {
    surface_id: "main-buttons",
    style_group_id: ""
  },
  {
    surface_id: "main-cards",
    style_group_id: ""
  },
  {
    surface_id: "main-misc",
    style_group_id: ""
  },
  {
    surface_id: "popout-regular-buttons",
    style_group_id: ""
  },
  {
    surface_id: "popout-tools",
    style_group_id: ""
  }
];

const DEFAULT_STYLE_GROUPS: StyleGroup[] = [
  {
    id: "style-group-01",
    index: 1,
    name: "01 Glass Rail",
    skinId: "glass-card",
    accent: "#9cf667"
  },
  {
    id: "style-group-02",
    index: 2,
    name: "02 Signal Strip",
    skinId: "signal-strip",
    accent: "#68d9ff"
  },
  {
    id: "style-group-03",
    index: 3,
    name: "03 Imported",
    skinId: "imported-skin",
    importedSkinId: DEFAULT_IMPORTED_SKIN_ID,
    accent: "#ffb870"
  },
  {
    id: "style-group-04",
    index: 4,
    name: "04 Glass Hover",
    skinId: "imported-skin",
    importedSkinId: "imported-skin-glass-hover",
    accent: "#d2b28a"
  },
  {
    id: "style-group-05",
    index: 5,
    name: "05 Black Tint",
    skinId: "imported-skin",
    importedSkinId: "imported-skin-black-tint",
    accent: "#d8dee8"
  }
];

const DEFAULT_ALIGNMENT_MODIFIERS: AlignmentToolStateRecord["Modifiers"] = {
  X: "",
  Y: "",
  Z: ""
};

const SMART_AXIS_TARGET_TO_COMMAND: Record<string, string> = {
  "util_smart_axis_base.ps1": "baseline",
  "util_smart_axis_x.ps1": "cycle_x",
  "util_smart_axis_y.ps1": "cycle_y",
  "util_smart_axis_z.ps1": "cycle_z",
  "util_smart_axis_live.ps1": "toggle_live"
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createId(prefix: string): string {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  return `${prefix}${randomPart}`;
}

function clonePlainValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeFanoutDirection(
  value: unknown
): NonNullable<FlowCellButton["fanout"]>["direction"] {
  switch (value) {
    case "down":
    case "left":
    case "right":
    case "center":
    case "up-left":
    case "up-right":
    case "down-left":
    case "down-right":
      return value;
    case "up":
    default:
      return "up";
  }
}

function normalizePanelFanLayout(value: unknown): PanelFanOptions["layout"] {
  switch (value) {
    case "radial":
    case "half-radial":
      return value;
    case "grid":
    default:
      return "grid";
  }
}

function normalizePanelFanPlacement(value: unknown): PanelFanOptions["placement"] {
  switch (value) {
    case "center":
    case "top":
    case "bottom":
    case "top-left":
    case "top-right":
    case "bottom-left":
    case "bottom-right":
      return value;
    default:
      return "bottom-left";
  }
}

function normalizePanelFanOptions(value: unknown): PanelFanOptions {
  const source = value && typeof value === "object" ? (value as Partial<PanelFanOptions>) : {};
  return {
    layout: normalizePanelFanLayout(source.layout),
    placement: normalizePanelFanPlacement(source.placement)
  };
}

function targetFileName(target: string): string {
  const normalized = target.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return (segments[segments.length - 1] ?? "").toLowerCase();
}

function buttonDisplayLabelFromPath(target: string): string {
  const fileName = target.split(/[\\/]/).pop() ?? target;
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const strippedPrefix = withoutExtension.replace(/^(org_|file_|util_)/i, "");
  return strippedPrefix.replace(/[_-]+/g, " ").trim() || withoutExtension;
}

function inferButtonCommandId(
  button: Pick<FlowCellButton, "Kind"> & Partial<Pick<FlowCellButton, "command_id">>
): CommandEnvelope["command_id"] {
  if (button.command_id) {
    return button.command_id;
  }

  return button.Kind === "macro" ? "flowcell.run_macro" : "flowcell.run_script";
}

function inferProgramTemplateKey(programName: string, exePath: string): string {
  const normalizedName = programName.trim().toLowerCase();
  const normalizedExe = exePath.trim().toLowerCase();
  const exeName = normalizedExe.split(/[\\/]/).pop() ?? normalizedExe;

  if (normalizedName.includes("blender") || exeName.includes("blender")) {
    return "blender";
  }
  if (normalizedName.includes("illustrator") || exeName.includes("illustrator")) {
    return "illustrator";
  }
  if (normalizedName.includes("photoshop") || exeName.includes("photoshop")) {
    return "photoshop";
  }
  if (normalizedName.includes("windows") || exeName.includes("explorer")) {
    return "windows";
  }
  return "generic";
}

function buildDefaultPanels(panelNames: string[]): FlowCellPanel[] {
  return panelNames.map((panelName) => ({
    Id: `panel_${createId("")}`,
    Name: panelName,
    IsPoppedOut: false,
    PopoutBounds: null,
    FanOptions: { ...DEFAULT_PANEL_FAN_OPTIONS },
    Buttons: []
  }));
}

function buildProgramConfig(args: {
  programName: string;
  exePath: string;
  repoRoot: string;
}): FlowCellProgram["ProgramConfig"] {
  const templateKey = inferProgramTemplateKey(args.programName, args.exePath);
  const exeName = args.exePath.split(/[\\/]/).pop() ?? args.exePath;
  const processName = exeName.replace(/\.exe$/i, "").trim().toLowerCase();

  switch (templateKey) {
    case "illustrator":
      return {
        NormalizedName: args.programName.trim().toLowerCase(),
        ProgramType: "adobe_direct_script_runner",
        ExePath: args.exePath,
        ScriptFolder: `${args.repoRoot}\\Illustrator`,
        RunMethod: "illustrator_direct",
        AllowedScriptExtensions: [".jsx", ".js"],
        BridgeFolder: "",
        RequiresRestart: false,
        ProcessNames: processName ? [processName] : ["illustrator"]
      };
    case "photoshop":
      return {
        NormalizedName: args.programName.trim().toLowerCase(),
        ProgramType: "adobe_direct_script_runner",
        ExePath: args.exePath,
        ScriptFolder: `${args.repoRoot}\\Photoshop`,
        RunMethod: "photoshop_direct",
        AllowedScriptExtensions: [".jsx", ".js"],
        BridgeFolder: "",
        RequiresRestart: false,
        ProcessNames: processName ? [processName] : ["photoshop"]
      };
    case "blender":
      return {
        NormalizedName: args.programName.trim().toLowerCase(),
        ProgramType: "bridge_runner",
        ExePath: args.exePath,
        ScriptFolder: `${args.repoRoot}\\Blender\\FlowCellButtons`,
        RunMethod: "blender_bridge",
        AllowedScriptExtensions: [".ps1", ".py", ".blend", ".exe", ".lnk"],
        BridgeFolder: "",
        RequiresRestart: false,
        ProcessNames:
          processName && processName !== "blender-launcher"
            ? [processName, "blender", "blender-launcher"]
            : ["blender", "blender-launcher"]
      };
    case "windows":
      return {
        NormalizedName: args.programName.trim().toLowerCase(),
        ProgramType: "generic",
        ExePath: args.exePath,
        ScriptFolder: `${args.repoRoot}\\Windows`,
        RunMethod: "generic",
        AllowedScriptExtensions: [],
        BridgeFolder: "",
        RequiresRestart: false,
        ProcessNames: ["explorer", "dopus", "dopusrt"]
      };
    default:
      return {
        NormalizedName: args.programName.trim().toLowerCase(),
        ProgramType: "generic",
        ExePath: args.exePath,
        ScriptFolder: args.exePath.replace(/[\\/][^\\/]+$/, ""),
        RunMethod: "generic",
        AllowedScriptExtensions: [],
        BridgeFolder: "",
        RequiresRestart: false,
        ProcessNames: processName ? [processName] : []
      };
  }
}

function getDefaultPanelNames(programName: string, exePath: string, programType: string): string[] {
  switch (inferProgramTemplateKey(programName, exePath)) {
    case "blender":
      return ["Collections", "Files", "Utility"];
    case "illustrator":
    case "photoshop":
      return ["Layers", "Files", "Utility"];
    default:
      return programType === "generic" ? ["Files", "Utility"] : ["Layers", "Files", "Utility"];
  }
}

function isPersistableBounds(bounds: FlowCellBounds | null | undefined): bounds is FlowCellBounds {
  return Boolean(
    bounds &&
      Number.isFinite(bounds.Left) &&
      Number.isFinite(bounds.Top) &&
      Number.isFinite(bounds.Width) &&
      Number.isFinite(bounds.Height) &&
      bounds.Width >= 120 &&
      bounds.Height >= 40
  );
}

function cloneAlignmentModifiers(
  modifiers?: Partial<AlignmentToolStateRecord["Modifiers"]> | null
): AlignmentToolStateRecord["Modifiers"] {
  return {
    X: modifiers?.X ?? "",
    Y: modifiers?.Y ?? "",
    Z: modifiers?.Z ?? ""
  };
}

function normalizePopoutClusters(clusters?: FlowCellState["PopoutClusters"]) {
  return (clusters ?? []).map((cluster) => ({
    ...cluster,
    MemberIds: Array.isArray(cluster.MemberIds)
      ? cluster.MemberIds.filter(
          (memberId): memberId is string =>
            typeof memberId === "string" && memberId.trim().length > 0
        )
      : []
  }));
}

function normalizeSavedProgramRecord(record: SavedProgramRecord): SavedProgramRecord {
  const program = normalizeProgram(clonePlainValue(record.Program));
  const sourceProgramTabId =
    Number.isFinite(record.SourceProgramTabId) && record.SourceProgramTabId > 0
      ? record.SourceProgramTabId
      : program.ProgramTabId;
  return {
    SourceProgramTabId: sourceProgramTabId,
    SavedAt:
      typeof record.SavedAt === "string" && record.SavedAt.trim().length > 0
        ? record.SavedAt
        : new Date().toISOString(),
    Program: program,
    AlignmentToolStates: clonePlainValue(record.AlignmentToolStates ?? []),
    ToolOptionStates: clonePlainValue(record.ToolOptionStates ?? []),
    ToolPopouts: clonePlainValue(record.ToolPopouts ?? []).map((toolPopout) => ({
      ...toolPopout,
      ButtonIds: Array.isArray(toolPopout.ButtonIds)
        ? toolPopout.ButtonIds.filter(
            (buttonId): buttonId is string =>
              typeof buttonId === "string" && buttonId.trim().length > 0
          )
        : [],
      Bounds: toolPopout.Bounds ?? null
    })),
    PopoutClusters: normalizePopoutClusters(clonePlainValue(record.PopoutClusters ?? []))
  };
}

function matchesProgramClusterMember(memberId: string, programId: number): boolean {
  return (
    memberId.startsWith(`panel|${programId}|`) ||
    memberId.startsWith(`tool|${programId}|`)
  );
}

function normalizeProgram(program: FlowCellProgram): FlowCellProgram {
  const normalizedPanels = program.Panels.map((panel) => ({
    ...panel,
    FanOptions: normalizePanelFanOptions(panel.FanOptions),
    Buttons: panel.Buttons.map((button) => ({
      ...button,
      command_id: inferButtonCommandId(button),
      style_group_id: button.style_group_id ?? "",
      transparent_popout: button.transparent_popout === true,
      fanout:
        button.fanout &&
        Array.isArray(button.fanout.child_button_ids) &&
        typeof button.fanout.layout === "string"
          ? {
              child_button_ids: button.fanout.child_button_ids.filter(
                (buttonId) => typeof buttonId === "string" && buttonId.trim().length > 0
              ),
              layout: (
                button.fanout.layout === "grid" || button.fanout.layout === "radial"
                  ? button.fanout.layout
                  : "row"
              ) as "grid" | "radial" | "row",
              direction: normalizeFanoutDirection(button.fanout.direction)
            }
          : undefined
    }))
  }));
  const normalizedProgramName =
    program.ProgramConfig?.NormalizedName?.trim().toLowerCase() ?? "";
  const panels =
    normalizedProgramName === "blender"
      ? (() => {
          const toolSetIndex = normalizedPanels.findIndex(
            (panel) => panel.Name.trim().toLowerCase() === "tool set"
          );
          const utilityIndex = normalizedPanels.findIndex(
            (panel) => panel.Id === "panel_utility" || panel.Name.trim().toLowerCase() === "utility"
          );
          if (toolSetIndex < 0 || utilityIndex < 0) {
            return normalizedPanels;
          }
          const toolSetPanel = normalizedPanels[toolSetIndex];
          const utilityPanel = normalizedPanels[utilityIndex];
          const toolSetOwnerButtonIds = new Set([
            "button_blender_flowcell_alignment_tools",
            "button_blender_flowcell_flatten_revolve"
          ]);
          const movedButtons = utilityPanel.Buttons.filter((button) =>
            toolSetOwnerButtonIds.has(button.Id)
          );
          if (movedButtons.length === 0) {
            return normalizedPanels;
          }
          const existingToolSetButtonIds = new Set(toolSetPanel.Buttons.map((button) => button.Id));
          const nextPanels = [...normalizedPanels];
          nextPanels[toolSetIndex] = {
            ...toolSetPanel,
            Buttons: [
              ...movedButtons.filter((button) => !existingToolSetButtonIds.has(button.Id)),
              ...toolSetPanel.Buttons
            ]
          };
          nextPanels[utilityIndex] = {
            ...utilityPanel,
            Buttons: utilityPanel.Buttons.filter((button) => !toolSetOwnerButtonIds.has(button.Id))
          };
          return nextPanels;
        })()
      : normalizedPanels;

  return {
    ...program,
    style_group_id:
      typeof program.style_group_id === "string" && program.style_group_id.trim().length > 0
        ? program.style_group_id
        : DEFAULT_PROGRAM_STYLE_GROUP_ID,
    Panels: panels
  };
}

function getBindingNumericId(binding: FlowCellBindingsState["scriptBindings"][number]): number {
  return binding.id ?? binding.bindingId ?? 0;
}

function findMatchingScriptBinding(
  button: FlowCellButton,
  programId: number,
  bindings: FlowCellBindingsState
) {
  const bindingId = button.BindingId ?? 0;
  if (bindingId > 0) {
    const byId = bindings.scriptBindings.find(
      (binding) => getBindingNumericId(binding) === bindingId
    );
    if (byId) {
      return byId;
    }
  }

  const buttonTarget = button.Target?.trim();
  if (!buttonTarget) {
    return undefined;
  }

  return (
    bindings.scriptBindings.find(
      (binding) =>
        binding.target === buttonTarget &&
        (binding.programTabId ?? 0) === programId
    ) ?? bindings.scriptBindings.find((binding) => binding.target === buttonTarget)
  );
}

export function ensureStateDefaults(state: FlowCellState): FlowCellState {
  const importedSkinsSource = state.ImportedSkins ? [...state.ImportedSkins] : [];

  DEFAULT_IMPORTED_SKINS.forEach((defaultSkin) => {
    if (!importedSkinsSource.some((skin) => skin.id === defaultSkin.id)) {
      importedSkinsSource.push({ ...defaultSkin });
    }
  });

  const importedSkins = importedSkinsSource.map((skin) =>
    isLegacyGlassHoverImportedSkin(skin) ? { ...DEFAULT_GLASS_HOVER_IMPORTED_SKIN } : skin
  );

  const defaultImportedSkinId = importedSkins[0]?.id ?? DEFAULT_IMPORTED_SKIN_ID;
  const styleGroupsSource =
    state.StyleGroups && state.StyleGroups.length > 0 ? [...state.StyleGroups] : [...DEFAULT_STYLE_GROUPS];

  DEFAULT_STYLE_GROUPS.forEach((defaultStyleGroup) => {
    if (!styleGroupsSource.some((styleGroup) => styleGroup.id === defaultStyleGroup.id)) {
      styleGroupsSource.push(defaultStyleGroup);
    }
  });

  const styleGroups = styleGroupsSource.map((styleGroup) =>
    styleGroup.skinId === "imported-skin" && !(styleGroup.importedSkinId ?? "").trim()
      ? {
          ...styleGroup,
          importedSkinId: defaultImportedSkinId
        }
      : styleGroup
  );

  const surfaceStyleAssignments =
    state.SurfaceStyleAssignments && state.SurfaceStyleAssignments.length > 0
      ? [...state.SurfaceStyleAssignments]
      : [...DEFAULT_SURFACE_STYLE_ASSIGNMENTS];

  DEFAULT_SURFACE_STYLE_ASSIGNMENTS.forEach((defaultAssignment) => {
    if (
      !surfaceStyleAssignments.some(
        (assignment) => assignment.surface_id === defaultAssignment.surface_id
      )
    ) {
      surfaceStyleAssignments.push(defaultAssignment);
    }
  });

  return {
    ...state,
    AlignmentToolStates: state.AlignmentToolStates ?? [],
    ToolOptionStates: state.ToolOptionStates ?? [],
    ToolPopouts: state.ToolPopouts ?? [],
    PopoutClusters: normalizePopoutClusters(state.PopoutClusters),
    SavedPrograms: (state.SavedPrograms ?? []).map((record) =>
      normalizeSavedProgramRecord(record)
    ),
    SavedVisualThemes: (state.SavedVisualThemes ?? []).map((record) => clonePlainValue(record)),
    AppTheme: normalizeAppTheme(state.AppTheme),
    StyleGroups: styleGroups,
    ImportedSkins: importedSkins,
    SurfaceStyleAssignments: surfaceStyleAssignments,
    Programs: state.Programs.map((program) => normalizeProgram(program))
  };
}

export function applyBindingsToState(
  state: FlowCellState,
  bindings: FlowCellBindingsState | null | undefined
): FlowCellState {
  if (!bindings) {
    return state;
  }

  return {
    ...state,
    Programs: state.Programs.map((program) => ({
      ...program,
      Panels: program.Panels.map((panel) => ({
        ...panel,
        Buttons: panel.Buttons.map((button) => {
          if (button.Kind === "macro") {
            const shortcut = bindings.actionHotkeys[button.Target?.trim() ?? ""] ?? "";
            return {
              ...button,
              Shortcut: shortcut,
              BindingId: 0
            };
          }

          if (button.Kind !== "script") {
            return button;
          }

          const binding = findMatchingScriptBinding(button, program.ProgramTabId, bindings);
          return {
            ...button,
            Shortcut: binding?.shortcut ?? "",
            BindingId: binding ? getBindingNumericId(binding) : 0
          };
        })
      }))
    }))
  };
}

export function getSelectedProgram(state: FlowCellState): FlowCellProgram {
  return (
    state.Programs.find(
      (program) => program.ProgramTabId === state.SelectedProgramTabId
    ) ?? state.Programs[0]
  );
}

export function getSelectedPanel(program: FlowCellProgram): FlowCellPanel {
  return (
    program.Panels.find((panel) => panel.Id === program.SelectedPanelId) ??
    program.Panels[0]
  );
}

export function findProgram(
  state: FlowCellState,
  programId: number
): FlowCellProgram | undefined {
  return state.Programs.find((program) => program.ProgramTabId === programId);
}

export function findPanel(
  state: FlowCellState,
  programId: number,
  panelId: string
): FlowCellPanel | undefined {
  return findProgram(state, programId)?.Panels.find((panel) => panel.Id === panelId);
}

export function findButton(
  state: FlowCellState,
  programId: number,
  panelId: string,
  buttonId: string
): FlowCellButton | undefined {
  return findPanel(state, programId, panelId)?.Buttons.find(
    (button) => button.Id === buttonId
  );
}

export function collectAllButtons(state: FlowCellState): Array<{
  programId: number;
  panelId: string;
  panelName: string;
  button: FlowCellButton;
}> {
  return state.Programs.flatMap((program) =>
    program.Panels.flatMap((panel) =>
      panel.Buttons.map((button) => ({
        programId: program.ProgramTabId,
        panelId: panel.Id,
        panelName: panel.Name,
        button
      }))
    )
  );
}

export function findToolPopoutByOwner(
  state: FlowCellState,
  programId: number,
  panelId: string,
  ownerButtonId: string
): ToolPopoutRecord | undefined {
  return state.ToolPopouts?.find(
    (toolPopout) =>
      toolPopout.ProgramTabId === programId &&
      toolPopout.PanelId === panelId &&
      toolPopout.ButtonIds[0] === ownerButtonId
  );
}

export function findGroupedToolPopout(
  state: FlowCellState,
  programId: number,
  panelId: string
): ToolPopoutRecord | undefined {
  return state.ToolPopouts?.find(
    (toolPopout) =>
      toolPopout.ProgramTabId === programId &&
      toolPopout.PanelId === panelId &&
      toolPopout.LayoutMode === "Group" &&
      toolPopout.ButtonIds.length > 1
  );
}

export function getToolPopoutButtons(
  state: FlowCellState,
  toolPopout: ToolPopoutRecord
): FlowCellButton[] {
  return toolPopout.ButtonIds.map((buttonId) =>
    findButton(
      state,
      toolPopout.ProgramTabId,
      toolPopout.PanelId,
      buttonId
    )
  ).filter((button): button is FlowCellButton => Boolean(button));
}

export function isAlignmentOwnerButton(button: FlowCellButton): boolean {
  return (
    (button.compound_tool_id ?? "").toLowerCase() === "alignment" ||
    targetFileName(button.Target) === "util_alignment_tools.ps1"
  );
}

export function isFlattenRevolveOwnerButton(button: FlowCellButton): boolean {
  return targetFileName(button.Target) === "util_flatten_revolve_tools.ps1";
}

export function isQuickRotateGroupOwnerButton(button: FlowCellButton): boolean {
  return targetFileName(button.Target) === "util_quick_rotate_group_tools.ps1";
}

export function getSmartAxisCommandForButton(button: FlowCellButton): string {
  return SMART_AXIS_TARGET_TO_COMMAND[targetFileName(button.Target)] ?? "";
}

export function isSmartAxisButton(button: FlowCellButton): boolean {
  return getSmartAxisCommandForButton(button).length > 0;
}

export function isSmartAxisOwnerButton(button: FlowCellButton): boolean {
  return getSmartAxisCommandForButton(button) === "baseline";
}

export function isRegularPopCandidate(button: FlowCellButton): boolean {
  return (
    !isAlignmentOwnerButton(button) &&
    !isFlattenRevolveOwnerButton(button) &&
    !isQuickRotateGroupOwnerButton(button) &&
    !isSmartAxisButton(button)
  );
}

export function getAlignmentToolModifiers(
  state: FlowCellState,
  programId: number,
  panelId: string,
  ownerButtonId: string
): AlignmentToolStateRecord["Modifiers"] {
  const entry = state.AlignmentToolStates?.find(
    (alignmentState) =>
      alignmentState.ProgramTabId === programId &&
      alignmentState.PanelId === panelId &&
      alignmentState.OwnerButtonId === ownerButtonId
  );
  return cloneAlignmentModifiers(entry?.Modifiers);
}

export function updateAlignmentToolModifiers(
  state: FlowCellState,
  programId: number,
  panelId: string,
  ownerButtonId: string,
  modifiers: AlignmentToolStateRecord["Modifiers"]
): FlowCellState {
  const nextEntry: AlignmentToolStateRecord = {
    ProgramTabId: programId,
    PanelId: panelId,
    OwnerButtonId: ownerButtonId,
    Modifiers: cloneAlignmentModifiers(modifiers)
  };
  const existingEntries = state.AlignmentToolStates ?? [];
  const matches = existingEntries.some(
    (entry) =>
      entry.ProgramTabId === programId &&
      entry.PanelId === panelId &&
      entry.OwnerButtonId === ownerButtonId
  );

  return {
    ...state,
    AlignmentToolStates: matches
      ? existingEntries.map((entry) =>
          entry.ProgramTabId === programId &&
          entry.PanelId === panelId &&
          entry.OwnerButtonId === ownerButtonId
            ? nextEntry
            : entry
        )
      : [...existingEntries, nextEntry]
  };
}

export function getToolOptionState(
  state: FlowCellState,
  programId: number,
  panelId: string,
  ownerButtonId: string,
  toolId: string
): ToolOptionStateRecord | undefined {
  return state.ToolOptionStates?.find(
    (entry) =>
      entry.ProgramTabId === programId &&
      entry.PanelId === panelId &&
      entry.OwnerButtonId === ownerButtonId &&
      entry.ToolId === toolId
  );
}

export function updateToolOptionState(
  state: FlowCellState,
  programId: number,
  panelId: string,
  ownerButtonId: string,
  toolId: string,
  values: Record<string, unknown>
): FlowCellState {
  const nextEntry: ToolOptionStateRecord = {
    ProgramTabId: programId,
    PanelId: panelId,
    OwnerButtonId: ownerButtonId,
    ToolId: toolId,
    Values: values
  };
  const existingEntries = state.ToolOptionStates ?? [];
  const matches = existingEntries.some(
    (entry) =>
      entry.ProgramTabId === programId &&
      entry.PanelId === panelId &&
      entry.OwnerButtonId === ownerButtonId &&
      entry.ToolId === toolId
  );

  return {
    ...state,
    ToolOptionStates: matches
      ? existingEntries.map((entry) =>
          entry.ProgramTabId === programId &&
          entry.PanelId === panelId &&
          entry.OwnerButtonId === ownerButtonId &&
          entry.ToolId === toolId
            ? nextEntry
            : entry
        )
      : [...existingEntries, nextEntry]
  };
}

export function getFanoutAssignment(
  state: FlowCellState,
  programId: number,
  panelId: string,
  ownerButtonId: string
): FlowCellButton["fanout"] | undefined {
  return findButton(state, programId, panelId, ownerButtonId)?.fanout;
}

export function updateFanoutAssignment(
  state: FlowCellState,
  programId: number,
  panelId: string,
  ownerButtonId: string,
  childButtonIds: string[],
  layout: "row" | "grid" | "radial",
  direction: NonNullable<FlowCellButton["fanout"]>["direction"]
): FlowCellState {
  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? {
            ...program,
            Panels: program.Panels.map((panel) =>
              panel.Id === panelId
                ? {
                    ...panel,
                    Buttons: panel.Buttons.map((button) =>
                      button.Id === ownerButtonId
                        ? {
                            ...button,
                            fanout:
                              childButtonIds.length > 0
                                ? {
                                    child_button_ids: childButtonIds,
                                    layout,
                                    direction: normalizeFanoutDirection(direction)
                                  }
                                : undefined
                          }
                        : button
                    )
                  }
                : panel
            )
          }
        : program
    )
  };
}

export function addPanel(
  state: FlowCellState,
  programId: number,
  name: string
): FlowCellState {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return state;
  }

  const nextPanel: FlowCellPanel = {
    Id: `panel_${createId("")}`,
    Name: trimmedName,
    IsPoppedOut: false,
    PopoutBounds: null,
    FanOptions: { ...DEFAULT_PANEL_FAN_OPTIONS },
    Buttons: []
  };

  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? {
            ...program,
            SelectedPanelId: nextPanel.Id,
            Panels: [...program.Panels, nextPanel]
          }
        : program
    )
  };
}

export function addProgram(
  state: FlowCellState,
  args: {
    programName: string;
    exePath: string;
    repoRoot: string;
  }
): FlowCellState {
  const trimmedProgramName = args.programName.trim();
  const trimmedExePath = args.exePath.trim();
  if (!trimmedProgramName || !trimmedExePath) {
    return state;
  }

  const nextProgramId =
    state.Programs.reduce((maxId, program) => Math.max(maxId, program.ProgramTabId), 0) + 1;
  const config = buildProgramConfig({
    programName: trimmedProgramName,
    exePath: trimmedExePath,
    repoRoot: args.repoRoot
  });
  const defaultPanels = buildDefaultPanels(
    getDefaultPanelNames(trimmedProgramName, trimmedExePath, config?.ProgramType ?? "generic")
  );

  const nextProgram: FlowCellProgram = {
    ProgramTabId: nextProgramId,
    SelectedPanelId: defaultPanels[0]?.Id,
    style_group_id: DEFAULT_PROGRAM_STYLE_GROUP_ID,
    ProgramConfig: config,
    Panels: defaultPanels
  };

  return {
    ...state,
    SelectedProgramTabId: nextProgramId,
    Programs: [...state.Programs, nextProgram]
  };
}

export function saveProgramSnapshot(
  state: FlowCellState,
  programId: number
): FlowCellState {
  const program = findProgram(state, programId);
  if (!program) {
    return state;
  }

  const nextRecord = normalizeSavedProgramRecord({
    SourceProgramTabId: programId,
    SavedAt: new Date().toISOString(),
    Program: clonePlainValue(program),
    AlignmentToolStates: clonePlainValue(
      (state.AlignmentToolStates ?? []).filter((entry) => entry.ProgramTabId === programId)
    ),
    ToolOptionStates: clonePlainValue(
      (state.ToolOptionStates ?? []).filter((entry) => entry.ProgramTabId === programId)
    ),
    ToolPopouts: clonePlainValue(
      (state.ToolPopouts ?? []).filter((entry) => entry.ProgramTabId === programId)
    ),
    PopoutClusters: clonePlainValue(
      (state.PopoutClusters ?? []).filter((cluster) =>
        cluster.MemberIds.some((memberId) => matchesProgramClusterMember(memberId, programId))
      )
    )
  });

  const nextSavedPrograms = (state.SavedPrograms ?? []).filter(
    (record) => record.SourceProgramTabId !== programId
  );
  nextSavedPrograms.push(nextRecord);
  nextSavedPrograms.sort((left, right) => left.SourceProgramTabId - right.SourceProgramTabId);

  return {
    ...state,
    SavedPrograms: nextSavedPrograms
  };
}

export function deleteProgram(
  state: FlowCellState,
  programId: number
): FlowCellState {
  const removedProgramIndex = state.Programs.findIndex(
    (program) => program.ProgramTabId === programId
  );
  if (removedProgramIndex < 0) {
    return state;
  }

  const nextPrograms = state.Programs.filter((program) => program.ProgramTabId !== programId);
  const currentSelectionStillExists = nextPrograms.some(
    (program) => program.ProgramTabId === state.SelectedProgramTabId
  );
  const fallbackProgram =
    nextPrograms[removedProgramIndex] ??
    nextPrograms[removedProgramIndex - 1] ??
    nextPrograms[0];

  return {
    ...state,
    SelectedProgramTabId: currentSelectionStillExists
      ? state.SelectedProgramTabId
      : fallbackProgram?.ProgramTabId ?? 0,
    Programs: nextPrograms,
    AlignmentToolStates: (state.AlignmentToolStates ?? []).filter(
      (entry) => entry.ProgramTabId !== programId
    ),
    ToolOptionStates: (state.ToolOptionStates ?? []).filter(
      (entry) => entry.ProgramTabId !== programId
    ),
    ToolPopouts: (state.ToolPopouts ?? []).filter((entry) => entry.ProgramTabId !== programId),
    PopoutClusters: (state.PopoutClusters ?? []).filter(
      (cluster) =>
        !cluster.MemberIds.some((memberId) => matchesProgramClusterMember(memberId, programId))
    )
  };
}

export function restoreSavedProgram(
  state: FlowCellState,
  sourceProgramTabId: number
): FlowCellState {
  const savedProgram = (state.SavedPrograms ?? []).find(
    (record) => record.SourceProgramTabId === sourceProgramTabId
  );
  if (!savedProgram) {
    return state;
  }
  if (state.Programs.some((program) => program.ProgramTabId === sourceProgramTabId)) {
    return state;
  }

  const restoredProgram = normalizeProgram(clonePlainValue(savedProgram.Program));
  const nextPrograms = [...state.Programs, restoredProgram].sort(
    (left, right) => left.ProgramTabId - right.ProgramTabId
  );

  return {
    ...state,
    SelectedProgramTabId: restoredProgram.ProgramTabId,
    Programs: nextPrograms,
    AlignmentToolStates: [
      ...(state.AlignmentToolStates ?? []).filter(
        (entry) => entry.ProgramTabId !== sourceProgramTabId
      ),
      ...clonePlainValue(savedProgram.AlignmentToolStates ?? [])
    ],
    ToolOptionStates: [
      ...(state.ToolOptionStates ?? []).filter(
        (entry) => entry.ProgramTabId !== sourceProgramTabId
      ),
      ...clonePlainValue(savedProgram.ToolOptionStates ?? [])
    ],
    ToolPopouts: [
      ...(state.ToolPopouts ?? []).filter((entry) => entry.ProgramTabId !== sourceProgramTabId),
      ...clonePlainValue(savedProgram.ToolPopouts ?? [])
    ],
    PopoutClusters: [
      ...(state.PopoutClusters ?? []).filter(
        (cluster) =>
          !cluster.MemberIds.some((memberId) =>
            matchesProgramClusterMember(memberId, sourceProgramTabId)
          )
      ),
      ...normalizePopoutClusters(clonePlainValue(savedProgram.PopoutClusters ?? []))
    ]
  };
}

export function addButtonsToPanel(
  state: FlowCellState,
  programId: number,
  panelId: string,
  buttons: FlowCellButton[]
): FlowCellState {
  if (buttons.length === 0) {
    return state;
  }

  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? {
            ...program,
            SelectedPanelId: panelId,
            Panels: program.Panels.map((panel) =>
              panel.Id === panelId
                ? {
                    ...panel,
                    Buttons: [...panel.Buttons, ...buttons]
                  }
                : panel
            )
          }
        : program
    )
  };
}

export function buildScriptButtonsFromPaths(paths: string[], commandId: CommandEnvelope["command_id"]): FlowCellButton[] {
  return paths.map((path) => ({
    Id: `button_${createId("")}`,
    Kind: commandId === "flowcell.run_macro" ? "macro" : "script",
    command_id: commandId,
    Label: buttonDisplayLabelFromPath(path),
    Target: path,
    Shortcut: "",
    BindingId: 0,
    style_group_id: ""
  }));
}

export function buildLayoutSnapshot(
  state: FlowCellState,
  runtime: RuntimeInfo
): LayoutSnapshot {
  const programLabels = new Map<number, string>();
  const panelLabels = new Map<string, string>();

  state.Programs.forEach((program) => {
    programLabels.set(
      program.ProgramTabId,
      program.ProgramConfig?.NormalizedName ?? `Program ${program.ProgramTabId}`
    );
    program.Panels.forEach((panel) => {
      panelLabels.set(`${program.ProgramTabId}:${panel.Id}`, panel.Name);
    });
  });

  return {
    SavedAt: new Date().toISOString(),
    Version: 3,
    LayoutKind: "PopoutsOnly",
    FlowCellStatePath: runtime.statePath,
    PanelPopouts: state.Programs.flatMap((program) =>
      program.Panels
        .filter(
          (panel) =>
            panel.IsPoppedOut &&
            panel.PopoutBounds &&
            isPersistableBounds(panel.PopoutBounds)
        )
        .map((panel) => ({
          ProgramTabId: program.ProgramTabId,
          ProgramName:
            program.ProgramConfig?.NormalizedName ?? `Program ${program.ProgramTabId}`,
          PanelId: panel.Id,
          PanelName: panel.Name,
          Bounds: panel.PopoutBounds as FlowCellBounds
        }))
    ),
    ToolPopouts:
      state.ToolPopouts?.map((toolPopout) => ({
        ProgramTabId: toolPopout.ProgramTabId,
        ProgramName: programLabels.get(toolPopout.ProgramTabId) ?? "",
        PanelId: toolPopout.PanelId,
        PanelName:
          panelLabels.get(`${toolPopout.ProgramTabId}:${toolPopout.PanelId}`) ?? "",
        ButtonIds: [...toolPopout.ButtonIds],
        ButtonLabels: toolPopout.ButtonIds.map((buttonId) =>
          findButton(state, toolPopout.ProgramTabId, toolPopout.PanelId, buttonId)?.Label ??
          buttonId
        ),
        LayoutMode: toolPopout.LayoutMode,
        Bounds: toolPopout.Bounds ?? null
      })) ?? [],
    PopoutClusters: state.PopoutClusters ?? []
  };
}

export function applyLayoutSnapshot(
  state: FlowCellState,
  snapshot: LayoutSnapshot
): FlowCellState {
  const panelLookup = new Map(
    (snapshot.PanelPopouts ?? []).map((entry) => [
      `${entry.ProgramTabId}:${entry.PanelId}`,
      entry.Bounds
    ])
  );

  return {
    ...state,
    Programs: state.Programs.map((program) => ({
      ...program,
      Panels: program.Panels.map((panel) => {
        const bounds = panelLookup.get(`${program.ProgramTabId}:${panel.Id}`);
        return {
          ...panel,
          IsPoppedOut: Boolean(bounds),
          PopoutBounds: bounds ?? null
        };
      })
    })),
    ToolPopouts:
      (snapshot.ToolPopouts ?? []).map((entry) => ({
        ProgramTabId: entry.ProgramTabId,
        PanelId: entry.PanelId,
        ButtonIds: [...entry.ButtonIds],
        LayoutMode: entry.LayoutMode,
        Bounds: entry.Bounds ?? null
      })) ?? [],
    PopoutClusters: snapshot.PopoutClusters ?? []
  };
}

export function updateButtonLabel(
  state: FlowCellState,
  programId: number,
  panelId: string,
  buttonId: string,
  label: string
): FlowCellState {
  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? {
            ...program,
            Panels: program.Panels.map((panel) =>
              panel.Id === panelId
                ? {
                    ...panel,
                    Buttons: panel.Buttons.map((button) =>
                      button.Id === buttonId
                        ? {
                            ...button,
                            Label: label
                          }
                        : button
                    )
                  }
                : panel
            )
          }
        : program
    )
  };
}

export function updateButtonTooltip(
  state: FlowCellState,
  programId: number,
  panelId: string,
  buttonId: string,
  tooltip: string
): FlowCellState {
  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? {
            ...program,
            Panels: program.Panels.map((panel) =>
              panel.Id === panelId
                ? {
                    ...panel,
                    Buttons: panel.Buttons.map((button) =>
                      button.Id === buttonId
                        ? {
                            ...button,
                            Tooltip: tooltip
                          }
                        : button
                    )
                  }
                : panel
            )
          }
        : program
    )
  };
}

export function deleteButtonFromPanel(
  state: FlowCellState,
  programId: number,
  panelId: string,
  buttonId: string
): FlowCellState {
  const nextPrograms = state.Programs.map((program) =>
    program.ProgramTabId === programId
      ? {
          ...program,
          Panels: program.Panels.map((panel) => ({
            ...panel,
            Buttons:
              panel.Id === panelId
                ? panel.Buttons
                    .filter((button) => button.Id !== buttonId)
                    .map((button) =>
                      button.fanout
                        ? {
                            ...button,
                            fanout:
                              button.fanout.child_button_ids.includes(buttonId)
                                ? {
                                    ...button.fanout,
                                    child_button_ids: button.fanout.child_button_ids.filter(
                                      (childId) => childId !== buttonId
                                    )
                                  }
                                : button.fanout
                          }
                        : button
                    )
                : panel.Buttons.map((button) =>
                    button.fanout
                      ? {
                          ...button,
                          fanout:
                            button.fanout.child_button_ids.includes(buttonId)
                              ? {
                                  ...button.fanout,
                                  child_button_ids: button.fanout.child_button_ids.filter(
                                    (childId) => childId !== buttonId
                                  )
                                }
                              : button.fanout
                        }
                      : button
                  )
          }))
        }
      : program
  );

  return {
    ...state,
    Programs: nextPrograms,
    AlignmentToolStates:
      state.AlignmentToolStates?.filter(
        (entry) =>
          !(
            entry.ProgramTabId === programId &&
            entry.PanelId === panelId &&
            entry.OwnerButtonId === buttonId
          )
      ) ?? [],
    ToolOptionStates:
      state.ToolOptionStates?.filter(
        (entry) =>
          !(
            entry.ProgramTabId === programId &&
            entry.PanelId === panelId &&
            entry.OwnerButtonId === buttonId
          )
      ) ?? [],
    ToolPopouts:
      state.ToolPopouts?.map((entry) =>
        entry.ProgramTabId === programId
          ? {
              ...entry,
              ButtonIds: entry.ButtonIds.filter((entryButtonId) => entryButtonId !== buttonId)
            }
          : entry
      ).filter(
        (entry) =>
          !(
            entry.ProgramTabId === programId &&
            entry.PanelId === panelId &&
            entry.ButtonIds.length === 0
          )
      ) ?? []
  };
}

export function upsertToolPopout(
  state: FlowCellState,
  record: ToolPopoutRecord
): FlowCellState {
  const ownerButtonId = record.ButtonIds[0] ?? "";
  const filteredPopouts = (state.ToolPopouts ?? []).filter(
    (toolPopout) =>
      !(
        toolPopout.ProgramTabId === record.ProgramTabId &&
        toolPopout.PanelId === record.PanelId &&
        (toolPopout.ButtonIds[0] ?? "") === ownerButtonId
      )
  );

  return {
    ...state,
    ToolPopouts: [...filteredPopouts, record]
  };
}

function mapRepoPath(rawPath: string, runtime: RuntimeInfo): string {
  if (!rawPath) {
    return "";
  }

  const normalizedPath = rawPath.replace(/\//g, "\\");
  if (/^[a-zA-Z]:\\/.test(normalizedPath) || normalizedPath.startsWith("\\\\")) {
    return normalizedPath;
  }

  const pathLower = normalizedPath.toLowerCase();
  const rootSegments = [
    "\\flowcell\\",
    "\\illustrator\\",
    "\\blender\\",
    "\\windows\\",
    "\\photoshop\\"
  ];

  for (const segment of rootSegments) {
    const index = pathLower.lastIndexOf(segment);
    if (index >= 0) {
      const suffix = normalizedPath.slice(index + 1);
      return `${runtime.repoRoot}\\${suffix}`;
    }
  }

  return normalizedPath;
}

export function buildCommandEnvelope(args: {
  runtime: RuntimeInfo;
  program: FlowCellProgram;
  panel: FlowCellPanel;
  button: FlowCellButton;
  sourceSurface: string;
  ownerButtonId?: string;
  childSlotId?: string;
  toolAction?: string;
  toolOptionState?: Record<string, unknown>;
}): CommandEnvelope {
  const {
    runtime,
    program,
    panel,
    button,
    sourceSurface,
    ownerButtonId,
    childSlotId,
    toolAction,
    toolOptionState
  } = args;
  const programConfig = program.ProgramConfig ?? {};
  const resolvedTarget = mapRepoPath(button.Target, runtime);
  const programLabel = programConfig.NormalizedName
    ? programConfig.NormalizedName.replace(/(^|-)([a-z])/g, (_, sep, char) =>
        `${sep}${char.toUpperCase()}`
      )
    : `Program ${program.ProgramTabId}`;

  const requestId = `${Date.now()}-${slugify(button.Id || button.Label || "flowcell")}`;
  const payload: Record<string, unknown> = {
    kind: button.Kind,
    label: button.Label,
    target: button.Target,
    resolved_target: resolvedTarget,
    tooltip: button.Tooltip ?? "",
    shortcut: button.Shortcut ?? "",
    binding_id: button.BindingId ?? 0,
    style_group_id: button.style_group_id ?? "",
    compound_tool_id: button.compound_tool_id ?? ""
  };

  if (toolOptionState && Object.keys(toolOptionState).length > 0) {
    payload.tool_option_state = toolOptionState;
  }

  return {
    command_id: button.command_id,
    program_id: program.ProgramTabId,
    panel_id: panel.Id,
    button_id: button.Id,
    style_group_id: button.style_group_id ?? "",
    owner_button_id: ownerButtonId,
    source_surface: sourceSurface,
    child_slot_id: childSlotId,
    tool_action: toolAction,
    request_id: requestId,
    timestamp: new Date().toISOString(),
    tool_option_state: toolOptionState,
    payload,
    program: {
      id: program.ProgramTabId,
      label: programLabel,
      normalized_name: programConfig.NormalizedName ?? "",
      program_type: programConfig.ProgramType ?? "",
      run_method: programConfig.RunMethod ?? "",
      script_folder: mapRepoPath(programConfig.ScriptFolder ?? "", runtime),
      bridge_folder: mapRepoPath(programConfig.BridgeFolder ?? "", runtime),
      exe_path: mapRepoPath(programConfig.ExePath ?? "", runtime),
      requires_restart: programConfig.RequiresRestart ?? false,
      process_names: programConfig.ProcessNames ?? []
    }
  };
}

export function buildToolActionEnvelope(args: {
  runtime: RuntimeInfo;
  program: FlowCellProgram;
  panel: FlowCellPanel;
  ownerButton: FlowCellButton;
  sourceButton: FlowCellButton;
  sourceSurface: string;
  toolId: string;
  toolCommand: string;
  childSlotId?: string;
  toolAction?: string;
  payload?: Record<string, unknown>;
  kind?: string;
  toolOptionState?: Record<string, unknown>;
}): CommandEnvelope {
  const baseEnvelope = buildCommandEnvelope({
    runtime: args.runtime,
    program: args.program,
    panel: args.panel,
    button: args.sourceButton,
    sourceSurface: args.sourceSurface,
    ownerButtonId: args.ownerButton.Id,
    childSlotId: args.childSlotId,
    toolAction: args.toolAction ?? args.toolCommand,
    toolOptionState: args.toolOptionState
  });

  return {
    ...baseEnvelope,
    command_id: "flowcell.run_tool_action",
    payload: {
      ...baseEnvelope.payload,
      kind: args.kind ?? "tool_action",
      tool: args.toolId,
      command: args.toolCommand,
      owner_button_id: args.ownerButton.Id,
      owner_panel_id: args.panel.Id,
      compound_tool_id: args.ownerButton.compound_tool_id ?? args.toolId,
      ...args.payload
    }
  };
}

export function updateProgramSelection(
  state: FlowCellState,
  programId: number
): FlowCellState {
  return {
    ...state,
    SelectedProgramTabId: programId
  };
}

export function updatePanelSelection(
  state: FlowCellState,
  programId: number,
  panelId: string
): FlowCellState {
  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? { ...program, SelectedPanelId: panelId }
        : program
    )
  };
}

export function updatePanelPopout(
  state: FlowCellState,
  programId: number,
  panelId: string,
  updater: (panel: FlowCellPanel) => FlowCellPanel
): FlowCellState {
  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? {
            ...program,
            Panels: program.Panels.map((panel) =>
              panel.Id === panelId ? updater(panel) : panel
            )
          }
        : program
    )
  };
}

export function updatePanelFanOptions(
  state: FlowCellState,
  programId: number,
  panelId: string,
  options: PanelFanOptions
): FlowCellState {
  return updatePanelPopout(state, programId, panelId, (panel) => ({
    ...panel,
    FanOptions: normalizePanelFanOptions(options)
  }));
}

export function updateButtonStyleGroup(
  state: FlowCellState,
  programId: number,
  panelId: string,
  buttonId: string,
  styleGroupId: string
): FlowCellState {
  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? {
            ...program,
            Panels: program.Panels.map((panel) =>
              panel.Id === panelId
                ? {
                    ...panel,
                    Buttons: panel.Buttons.map((button) =>
                      button.Id === buttonId
                        ? { ...button, style_group_id: styleGroupId }
                        : button
                    )
                  }
                : panel
            )
          }
        : program
    )
  };
}

export function updateButtonTransparentPopout(
  state: FlowCellState,
  programId: number,
  panelId: string,
  buttonId: string,
  transparentPopout: boolean
): FlowCellState {
  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? {
            ...program,
            Panels: program.Panels.map((panel) =>
              panel.Id === panelId
                ? {
                    ...panel,
                    Buttons: panel.Buttons.map((button) =>
                      button.Id === buttonId
                        ? { ...button, transparent_popout: transparentPopout }
                        : button
                    )
                  }
                : panel
            )
          }
        : program
    )
  };
}

export function updatePanelButtonStyleGroup(
  state: FlowCellState,
  programId: number,
  panelId: string,
  styleGroupId: string
): FlowCellState {
  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? {
            ...program,
            Panels: program.Panels.map((panel) =>
              panel.Id === panelId
                ? {
                    ...panel,
                    Buttons: panel.Buttons.map((button) => ({
                      ...button,
                      style_group_id: styleGroupId
                    }))
                  }
                : panel
            )
          }
        : program
    )
  };
}

export function updatePanelButtonTransparentPopout(
  state: FlowCellState,
  programId: number,
  panelId: string,
  transparentPopout: boolean
): FlowCellState {
  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? {
            ...program,
            Panels: program.Panels.map((panel) =>
              panel.Id === panelId
                ? {
                    ...panel,
                    Buttons: panel.Buttons.map((button) => ({
                      ...button,
                      transparent_popout: transparentPopout
                    }))
                  }
                : panel
            )
          }
        : program
    )
  };
}

export function updateProgramStyleGroup(
  state: FlowCellState,
  programId: number,
  styleGroupId: string
): FlowCellState {
  return {
    ...state,
    Programs: state.Programs.map((program) =>
      program.ProgramTabId === programId
        ? {
            ...program,
            style_group_id: styleGroupId
          }
        : program
    )
  };
}

export function updateAllProgramStyleGroups(
  state: FlowCellState,
  styleGroupId: string
): FlowCellState {
  return {
    ...state,
    Programs: state.Programs.map((program) => ({
      ...program,
      style_group_id: styleGroupId
    }))
  };
}

export function updateSurfaceStyleAssignment(
  state: FlowCellState,
  surfaceId: SurfaceStyleSectionId,
  styleGroupId: string
): FlowCellState {
  const assignments = state.SurfaceStyleAssignments ?? [];
  const nextAssignments = assignments.some((assignment) => assignment.surface_id === surfaceId)
    ? assignments.map((assignment) =>
        assignment.surface_id === surfaceId
          ? {
              ...assignment,
              style_group_id: styleGroupId
            }
          : assignment
      )
    : [...assignments, { surface_id: surfaceId, style_group_id: styleGroupId }];

  return {
    ...state,
    SurfaceStyleAssignments: nextAssignments
  };
}

export function updateStyleGroups(
  state: FlowCellState,
  styleGroups: StyleGroup[]
): FlowCellState {
  return {
    ...state,
    StyleGroups: styleGroups
  };
}

export function updateImportedSkins(
  state: FlowCellState,
  importedSkins: FlowCellState["ImportedSkins"]
): FlowCellState {
  return {
    ...state,
    ImportedSkins: importedSkins
  };
}

export function updateAppTheme(state: FlowCellState, appTheme: AppTheme): FlowCellState {
  return {
    ...state,
    AppTheme: normalizeAppTheme(appTheme)
  };
}

export function updateToolPopout(
  state: FlowCellState,
  programId: number,
  panelId: string,
  ownerButtonId: string,
  bounds: FlowCellBounds
): FlowCellState {
  return {
    ...state,
    ToolPopouts:
      state.ToolPopouts?.map((toolPopout) =>
        toolPopout.ProgramTabId === programId &&
        toolPopout.PanelId === panelId &&
        toolPopout.ButtonIds[0] === ownerButtonId
          ? {
              ...toolPopout,
              Bounds: bounds
            }
          : toolPopout
      ) ?? []
  };
}

export function removeToolPopout(
  state: FlowCellState,
  programId: number,
  panelId: string,
  ownerButtonId: string
): FlowCellState {
  return {
    ...state,
    ToolPopouts:
      state.ToolPopouts?.filter(
        (toolPopout) =>
          !(
            toolPopout.ProgramTabId === programId &&
            toolPopout.PanelId === panelId &&
            toolPopout.ButtonIds[0] === ownerButtonId
          )
      ) ?? []
  };
}
