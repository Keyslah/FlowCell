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
  ImportedSkin,
  LayoutSnapshot,
  ManagedScriptInstallResultItem,
  PanelFanOptions,
  RuntimeInfo,
  SavedProgramRecord,
  SavedVisualTheme,
  SurfaceStyleAssignment,
  SurfaceStyleSectionId,
  StyleGroup,
  ToolOptionStateRecord,
  ToolPopoutRecord
} from "../types";
import { DEFAULT_PANEL_FAN_OPTIONS } from "../types";
import {
  DEFAULT_FLOW_IMPORTED_SKIN,
  DEFAULT_GLASS_HOVER_IMPORTED_SKIN,
  DEFAULT_IMPORTED_SKINS,
  isLegacyGlassHoverImportedSkin,
  isLegacyShadeImportedSkin,
  normalizeAppTheme
} from "./theme";

const DEFAULT_IMPORTED_SKIN_ID = DEFAULT_FLOW_IMPORTED_SKIN.id;
const DEFAULT_IMPORTED_STYLE_GROUP_ID = "style-group-03";
const DEFAULT_PROGRAM_STYLE_GROUP_ID = "style-group-03";
const IMPORTED_SKIN_LIBRARY_STYLE_GROUP_PREFIX = "style-group-imported-";
const DEDICATED_BUTTON_STYLE_GROUP_PREFIX = "button-style-";
const DEDICATED_BUTTON_IMPORTED_SKIN_PREFIX = "button-skin-";
const ILLUSTRATOR_RUNTIME_SCRIPT_FOLDER =
  "C:\\Program Files\\Adobe\\Adobe Illustrator 2026\\Presets\\en_US\\Scripts";
const PHOTOSHOP_RUNTIME_SCRIPT_FOLDER =
  "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Presets\\Scripts";
const DEFAULT_SURFACE_STYLE_ASSIGNMENTS: SurfaceStyleAssignment[] = [
  {
    surface_id: "main-panels",
    style_group_id: ""
  },
  {
    surface_id: "main-program-buttons",
    style_group_id: ""
  },
  {
    surface_id: "main-rails",
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
    surface_id: "main-window-buttons",
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
const MAX_DEDICATED_IMPORTED_SKIN_PAYLOAD_CHARS = 200000;

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

function sanitizeStyleGroupToken(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9\-/:_]/g, "_");
  return sanitized.length > 0 ? sanitized : "imported-skin";
}

function buildImportedSkinLibraryStyleGroupId(importedSkinId: string): string {
  return `${IMPORTED_SKIN_LIBRARY_STYLE_GROUP_PREFIX}${sanitizeStyleGroupToken(importedSkinId)}`;
}

function buildImportedSkinLibraryStyleGroupName(importedSkin: ImportedSkin): string {
  const skinName = importedSkin.name.trim() || importedSkin.id;
  return `Skin - ${skinName}`;
}

function isImportedSkinLibraryStyleGroupId(styleGroupId: string): boolean {
  return styleGroupId.startsWith(IMPORTED_SKIN_LIBRARY_STYLE_GROUP_PREFIX);
}

function isDedicatedButtonImportedSkinId(importedSkinId: string): boolean {
  return importedSkinId.startsWith(DEDICATED_BUTTON_IMPORTED_SKIN_PREFIX);
}

function isDedicatedButtonStyleGroupId(styleGroupId: string): boolean {
  return styleGroupId.startsWith(DEDICATED_BUTTON_STYLE_GROUP_PREFIX);
}

function buildDedicatedButtonStyleGroupId(programId: number, panelId: string, buttonId: string): string {
  return `button-style-${programId}-${sanitizeStyleGroupToken(panelId)}-${sanitizeStyleGroupToken(buttonId)}`;
}

function buildDedicatedButtonImportedSkinId(
  programId: number,
  panelId: string,
  buttonId: string
): string {
  return `button-skin-${programId}-${sanitizeStyleGroupToken(panelId)}-${sanitizeStyleGroupToken(buttonId)}`;
}

function buildPanelButtonStyleGroupId(programId: number, panelId: string): string {
  return `button-style-${programId}-${sanitizeStyleGroupToken(panelId)}-all`;
}

function buildPanelButtonImportedSkinId(programId: number, panelId: string): string {
  return `button-skin-${programId}-${sanitizeStyleGroupToken(panelId)}-all`;
}

function normalizeDisplayName(value: unknown, fallback: string, maxLength = 120): string {
  const rawValue = typeof value === "string" ? value : "";
  const normalized = rawValue.replace(/\u00c2?\u00b7/g, "-").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, maxLength);
}

function remapStyleGroupId(
  styleGroupId: string | undefined,
  aliases: ReadonlyMap<string, string>
): string {
  let nextId = (styleGroupId ?? "").trim();
  if (!nextId) {
    return "";
  }

  const visited = new Set<string>();
  while (nextId && aliases.has(nextId) && !visited.has(nextId)) {
    visited.add(nextId);
    nextId = (aliases.get(nextId) ?? "").trim();
  }
  return nextId;
}

function migrateLegacyImportedSkinState(args: {
  importedSkins: ImportedSkin[];
  styleGroups: StyleGroup[];
}): {
  importedSkins: ImportedSkin[];
  styleGroups: StyleGroup[];
  styleGroupAliases: Map<string, string>;
} {
  const legacyShadeSkinIds = new Set(
    args.importedSkins.filter((skin) => isLegacyShadeImportedSkin(skin)).map((skin) => skin.id)
  );
  const styleGroupAliases = new Map<string, string>();

  const importedSkins = args.importedSkins
    .map((skin) => {
      if (skin.id === DEFAULT_FLOW_IMPORTED_SKIN.id) {
        return { ...DEFAULT_FLOW_IMPORTED_SKIN };
      }
      return isLegacyGlassHoverImportedSkin(skin)
        ? { ...DEFAULT_GLASS_HOVER_IMPORTED_SKIN }
        : skin;
    })
    .filter((skin) => !legacyShadeSkinIds.has(skin.id));

  const styleGroups = args.styleGroups.flatMap((styleGroup) => {
    const importedSkinId = (styleGroup.importedSkinId ?? "").trim();
    const referencesLegacyShade =
      styleGroup.skinId === "imported-skin" && legacyShadeSkinIds.has(importedSkinId);

    if (referencesLegacyShade && isImportedSkinLibraryStyleGroupId(styleGroup.id)) {
      styleGroupAliases.set(styleGroup.id, DEFAULT_IMPORTED_STYLE_GROUP_ID);
      return [];
    }

    if (
      styleGroup.skinId === "imported-skin" &&
      (referencesLegacyShade || styleGroup.id === DEFAULT_IMPORTED_STYLE_GROUP_ID)
    ) {
      return [
        {
          ...styleGroup,
          importedSkinId: DEFAULT_IMPORTED_SKIN_ID
        }
      ];
    }

    return [{ ...styleGroup }];
  });

  return {
    importedSkins,
    styleGroups,
    styleGroupAliases
  };
}

function getImportedSkinPayloadChars(importedSkin: ImportedSkin): number {
  return (
    (importedSkin.html?.length ?? 0) +
    (importedSkin.css?.length ?? 0) +
    (importedSkin.svg?.length ?? 0) +
    (importedSkin.bridgeJs?.length ?? 0) +
    (importedSkin.cardHtml?.length ?? 0) +
    (importedSkin.cardCss?.length ?? 0) +
    (importedSkin.cardSvg?.length ?? 0)
  );
}

function isOversizedDedicatedImportedSkin(importedSkin: ImportedSkin): boolean {
  return (
    isDedicatedButtonImportedSkinId(importedSkin.id) &&
    getImportedSkinPayloadChars(importedSkin) > MAX_DEDICATED_IMPORTED_SKIN_PAYLOAD_CHARS
  );
}

function resolveValidStyleGroupId(
  styleGroupId: unknown,
  validStyleGroupIds: Set<string>
): string {
  const normalizedId = typeof styleGroupId === "string" ? styleGroupId.trim() : "";
  return normalizedId.length > 0 && validStyleGroupIds.has(normalizedId) ? normalizedId : "";
}

interface DedicatedButtonSkinTargets {
  allowedImportedSkinIds: Set<string>;
  allowedStyleGroupIds: Set<string>;
  canonicalStyleGroupNames: Map<string, string>;
}

function collectDedicatedButtonSkinTargets(programs: FlowCellProgram[]): DedicatedButtonSkinTargets {
  const allowedImportedSkinIds = new Set<string>();
  const allowedStyleGroupIds = new Set<string>();
  const canonicalStyleGroupNames = new Map<string, string>();

  programs.forEach((program) => {
    program.Panels.forEach((panel) => {
      const panelStyleGroupId = buildPanelButtonStyleGroupId(program.ProgramTabId, panel.Id);
      const panelImportedSkinId = buildPanelButtonImportedSkinId(program.ProgramTabId, panel.Id);
      const panelLabel = normalizeDisplayName(panel.Name, panel.Id, 80);
      allowedStyleGroupIds.add(panelStyleGroupId);
      allowedImportedSkinIds.add(panelImportedSkinId);
      canonicalStyleGroupNames.set(
        panelStyleGroupId,
        `Panel - ${panelLabel} / all buttons`
      );

      panel.Buttons.forEach((button) => {
        const buttonStyleGroupId = buildDedicatedButtonStyleGroupId(
          program.ProgramTabId,
          panel.Id,
          button.Id
        );
        const buttonImportedSkinId = buildDedicatedButtonImportedSkinId(
          program.ProgramTabId,
          panel.Id,
          button.Id
        );
        allowedStyleGroupIds.add(buttonStyleGroupId);
        allowedImportedSkinIds.add(buttonImportedSkinId);
        canonicalStyleGroupNames.set(
          buttonStyleGroupId,
          `Button - ${normalizeDisplayName(button.Label, button.Id, 80)}`
        );
      });
    });
  });

  return {
    allowedImportedSkinIds,
    allowedStyleGroupIds,
    canonicalStyleGroupNames
  };
}

function shouldKeepImportedSkinLibraryStyleGroup(
  styleGroup: StyleGroup,
  allStyleGroups: StyleGroup[]
): boolean {
  if (!isImportedSkinLibraryStyleGroupId(styleGroup.id)) {
    return true;
  }

  const importedSkinId = (styleGroup.importedSkinId ?? "").trim();
  if (!importedSkinId || isDedicatedButtonImportedSkinId(importedSkinId)) {
    return false;
  }

  return !allStyleGroups.some(
    (otherStyleGroup) =>
      otherStyleGroup.id !== styleGroup.id &&
      !isImportedSkinLibraryStyleGroupId(otherStyleGroup.id) &&
      !isDedicatedButtonStyleGroupId(otherStyleGroup.id) &&
      (otherStyleGroup.importedSkinId ?? "").trim() === importedSkinId
  );
}

function normalizeImportedSkinCollection(
  importedSkins: ImportedSkin[],
  targets: DedicatedButtonSkinTargets
): ImportedSkin[] {
  return importedSkins
    .filter(
      (skin) =>
        (!isDedicatedButtonImportedSkinId(skin.id) || targets.allowedImportedSkinIds.has(skin.id)) &&
        !isOversizedDedicatedImportedSkin(skin)
    )
    .map((skin) => ({
      ...skin,
      name: normalizeDisplayName(skin.name, skin.id || "Imported Skin"),
      bridgeJs: typeof skin.bridgeJs === "string" ? skin.bridgeJs : ""
    }));
}

function normalizeStyleGroupCollection(args: {
  styleGroups: StyleGroup[];
  importedSkins: ImportedSkin[];
  defaultImportedSkinId: string;
  targets: DedicatedButtonSkinTargets;
}): StyleGroup[] {
  const importedSkinById = new Map(
    args.importedSkins.map((importedSkin) => [importedSkin.id, importedSkin])
  );

  return args.styleGroups
    .map((styleGroup) =>
      styleGroup.skinId === "imported-skin" && !(styleGroup.importedSkinId ?? "").trim()
        ? {
            ...styleGroup,
            importedSkinId: args.defaultImportedSkinId
          }
        : styleGroup
    )
    .filter((styleGroup, _index, allStyleGroups) => {
      if (!shouldKeepImportedSkinLibraryStyleGroup(styleGroup, allStyleGroups)) {
        return false;
      }

      if (
        styleGroup.skinId === "imported-skin" &&
        (styleGroup.importedSkinId ?? "").trim().length > 0 &&
        !importedSkinById.has((styleGroup.importedSkinId ?? "").trim())
      ) {
        return false;
      }

      return (
        !isDedicatedButtonStyleGroupId(styleGroup.id) ||
        args.targets.allowedStyleGroupIds.has(styleGroup.id)
      );
    })
    .map((styleGroup) => {
      const canonicalName = args.targets.canonicalStyleGroupNames.get(styleGroup.id);
      if (canonicalName) {
        return {
          ...styleGroup,
          name: canonicalName
        };
      }

      if (isImportedSkinLibraryStyleGroupId(styleGroup.id)) {
        const importedSkin = importedSkinById.get((styleGroup.importedSkinId ?? "").trim());
        if (importedSkin) {
          return {
            ...styleGroup,
            name: `Skin - ${importedSkin.name.trim() || importedSkin.id}`
          };
        }
      }

      return {
        ...styleGroup,
        name: normalizeDisplayName(styleGroup.name, styleGroup.id || "Style Group")
      };
    });
}

function normalizeSavedVisualThemeRecord(
  savedTheme: SavedVisualTheme,
  targets: DedicatedButtonSkinTargets
): SavedVisualTheme {
  const importedSkinsSource = (savedTheme.importedSkins ?? []).map((skin) => ({ ...skin }));
  DEFAULT_IMPORTED_SKINS.forEach((defaultSkin) => {
    if (!importedSkinsSource.some((skin) => skin.id === defaultSkin.id)) {
      importedSkinsSource.push({ ...defaultSkin });
    }
  });

  const styleGroupsSource = (savedTheme.styleGroups ?? []).map((styleGroup) => ({ ...styleGroup }));
  DEFAULT_STYLE_GROUPS.forEach((defaultStyleGroup) => {
    if (!styleGroupsSource.some((styleGroup) => styleGroup.id === defaultStyleGroup.id)) {
      styleGroupsSource.push({ ...defaultStyleGroup });
    }
  });

  const legacyMigration = migrateLegacyImportedSkinState({
    importedSkins: importedSkinsSource,
    styleGroups: styleGroupsSource
  });
  const importedSkins = normalizeImportedSkinCollection(legacyMigration.importedSkins, targets);
  const defaultImportedSkinId =
    importedSkins.find((skin) => skin.id === DEFAULT_IMPORTED_SKIN_ID)?.id ??
    importedSkins[0]?.id ??
    DEFAULT_IMPORTED_SKIN_ID;
  const styleGroups = normalizeStyleGroupCollection({
    styleGroups: legacyMigration.styleGroups,
    importedSkins,
    defaultImportedSkinId,
    targets
  });
  const validStyleGroupIds = new Set(styleGroups.map((styleGroup) => styleGroup.id));

  return {
    ...savedTheme,
    name: normalizeDisplayName(savedTheme.name, savedTheme.id || "Visual Theme"),
    appTheme: normalizeAppTheme(savedTheme.appTheme),
    styleGroups,
    importedSkins,
    surfaceStyleAssignments: (savedTheme.surfaceStyleAssignments ?? [])
      .map((assignment) => ({
        ...assignment,
        style_group_id: resolveValidStyleGroupId(
          remapStyleGroupId(assignment.style_group_id, legacyMigration.styleGroupAliases),
          validStyleGroupIds
        )
      })),
    programStyleAssignments: (savedTheme.programStyleAssignments ?? [])
      .map((assignment) => ({
        ...assignment,
        style_group_id: resolveValidStyleGroupId(
          remapStyleGroupId(assignment.style_group_id, legacyMigration.styleGroupAliases),
          validStyleGroupIds
        )
      }))
      .filter((assignment) => assignment.style_group_id.length > 0),
    buttonStyleAssignments: (savedTheme.buttonStyleAssignments ?? [])
      .map((assignment) => ({
        ...assignment,
        style_group_id: resolveValidStyleGroupId(
          remapStyleGroupId(assignment.style_group_id, legacyMigration.styleGroupAliases),
          validStyleGroupIds
        )
      }))
      .filter((assignment) => assignment.style_group_id.length > 0)
  };
}

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

function getButtonBindingTargets(button: FlowCellButton): string[] {
  return Array.from(
    new Set(
      [button.ExecutionTarget, button.Target]
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0)
    )
  );
}

export function resolveButtonExecutionTarget(button: FlowCellButton): string {
  return getButtonBindingTargets(button)[0] ?? "";
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

function normalizeWindowsPath(value: string): string {
  return value.replace(/\//g, "\\").replace(/[\\]+$/, "");
}

function resolveWorkspaceRootFromRepoRoot(repoRoot: string): string {
  const normalizedRepoRoot = normalizeWindowsPath(repoRoot);
  return normalizedRepoRoot.toLowerCase().endsWith("\\programs")
    ? normalizedRepoRoot.slice(0, -("\\programs".length))
    : normalizedRepoRoot;
}

function resolveProgramsRootFromRepoRoot(repoRoot: string): string {
  const normalizedRepoRoot = normalizeWindowsPath(repoRoot);
  return normalizedRepoRoot.toLowerCase().endsWith("\\programs")
    ? normalizedRepoRoot
    : joinWindowsPath(normalizedRepoRoot, "Programs");
}

function resolveWindowsProgramRoot(repoRoot: string): string {
  return joinWindowsPath(resolveProgramsRootFromRepoRoot(repoRoot), "Windows");
}

function programScriptsFolderName(programName: string, bucketName: "Git" | "Local"): string {
  return `${programName} ${bucketName} Scripts`;
}

function resolveProgramRoot(repoRoot: string, programName: string): string {
  return joinWindowsPath(resolveProgramsRootFromRepoRoot(repoRoot), programName);
}

function resolveProgramGitScriptsFolder(repoRoot: string, programName: string): string {
  return joinWindowsPath(resolveProgramRoot(repoRoot, programName), programScriptsFolderName(programName, "Git"));
}

function resolveProgramLocalScriptsFolder(repoRoot: string, programName: string): string {
  return joinWindowsPath(resolveProgramRoot(repoRoot, programName), programScriptsFolderName(programName, "Local"));
}

function migrateLegacyWindowsProgramPath(path: string, repoRoot: string): string {
  const normalizedPath = normalizeWindowsPath(path);
  if (!normalizedPath) {
    return "";
  }

  const workspaceRoot = resolveWorkspaceRootFromRepoRoot(repoRoot);
  const legacyRoot = joinWindowsPath(workspaceRoot, "Windows");
  const managedRoot = resolveWindowsProgramRoot(repoRoot);
  const normalizedPathLower = normalizedPath.toLowerCase();
  const legacyRootLower = legacyRoot.toLowerCase();

  if (normalizedPathLower === legacyRootLower) {
    return managedRoot;
  }
  if (normalizedPathLower.startsWith(`${legacyRootLower}\\`)) {
    return `${managedRoot}${normalizedPath.slice(legacyRoot.length)}`;
  }

  return normalizedPath;
}

function pathsEqual(left: string, right: string): boolean {
  return normalizeWindowsPath(left).toLowerCase() === normalizeWindowsPath(right).toLowerCase();
}

function isPathWithinFolder(path: string, folder: string): boolean {
  const normalizedPath = normalizeWindowsPath(path);
  const normalizedFolder = normalizeWindowsPath(folder);
  if (!normalizedPath || !normalizedFolder) {
    return false;
  }
  const pathLower = normalizedPath.toLowerCase();
  const folderLower = normalizedFolder.toLowerCase();
  return pathLower === folderLower || pathLower.startsWith(`${folderLower}\\`);
}

function joinWindowsPath(root: string, ...segments: string[]): string {
  const trimmedRoot = normalizeWindowsPath(root);
  const trimmedSegments = segments.map((segment) =>
    segment.replace(/^[/\\]+|[/\\]+$/g, "")
  );
  return [trimmedRoot, ...trimmedSegments].filter((segment) => segment.length > 0).join("\\");
}

function normalizeManagedPathForProgram(
  value: string,
  folders: ProgramManagedFolders | null
): string {
  const normalizedValue = normalizeWindowsPath(value);
  if (!normalizedValue || !folders) {
    return normalizedValue;
  }

  if (folders.templateKey === "windows") {
    return migrateLegacyWindowsProgramPath(normalizedValue, folders.repoRoot);
  }

  return normalizedValue;
}

function normalizeManagedProgramFolderPath(
  value: string,
  preferredPath: string,
  folders: ProgramManagedFolders | null
): string {
  const normalizedValue = normalizeManagedPathForProgram(value, folders);
  if (!normalizedValue || !folders) {
    return normalizedValue || preferredPath;
  }

  return folders.legacyScriptFolders.some((folder) => isPathWithinFolder(normalizedValue, folder))
    ? preferredPath
    : normalizedValue;
}

function inferRepoRootFromKnownPath(path: string): string {
  const normalizedPath = normalizeWindowsPath(path);
  const pathLower = normalizedPath.toLowerCase();
  const rootSegments = ["\\blender\\", "\\illustrator\\", "\\photoshop\\", "\\windows\\"];

  for (const segment of rootSegments) {
    const index = pathLower.lastIndexOf(segment);
    if (index > 0) {
      return normalizedPath.slice(0, index);
    }
  }

  return "";
}

interface ProgramManagedFolders {
  templateKey: string;
  repoRoot: string;
  // Library folders are public/downloadable sources. Active folders are FlowCell-managed copies.
  libraryFolder: string;
  activeFolder: string;
  // Runtime folders are where the actual runnable copy or wrapper lives for that program.
  runtimeFolder: string;
  legacyScriptFolders: string[];
  wrapperFolder?: string;
}

function resolveProgramManagedFolders(program: FlowCellProgram): ProgramManagedFolders | null {
  const programConfig = program.ProgramConfig ?? {};
  const templateKey = inferProgramTemplateKey(
    programConfig.NormalizedName ?? "",
    programConfig.ExePath ?? ""
  );
  if (templateKey === "generic") {
    return null;
  }

  const repoRootCandidates = [
    programConfig.ScriptFolder ?? "",
    programConfig.ActiveScriptFolder ?? "",
    programConfig.RuntimeScriptFolder ?? "",
    programConfig.BridgeFolder ?? "",
    ...program.Panels.flatMap((panel) =>
      panel.Buttons.flatMap((button) => [button.Target ?? "", button.ExecutionTarget ?? ""])
    )
  ]
    .map((value) => inferRepoRootFromKnownPath(value))
    .filter((value) => value.length > 0);
  const repoRoot = repoRootCandidates[0] ?? "";
  if (!repoRoot) {
    return null;
  }

  switch (templateKey) {
    case "illustrator":
      return {
        templateKey,
        repoRoot,
        libraryFolder: resolveProgramGitScriptsFolder(repoRoot, "Illustrator"),
        activeFolder: resolveProgramLocalScriptsFolder(repoRoot, "Illustrator"),
        runtimeFolder: ILLUSTRATOR_RUNTIME_SCRIPT_FOLDER,
        legacyScriptFolders: [
          joinWindowsPath(resolveProgramRoot(repoRoot, "Illustrator"), "Illustrator Scripts"),
          joinWindowsPath(resolveProgramRoot(repoRoot, "Illustrator"), "Illustrator Active Scripts"),
          joinWindowsPath(resolveProgramRoot(repoRoot, "Illustrator"), "ScriptBank"),
          ILLUSTRATOR_RUNTIME_SCRIPT_FOLDER
        ]
      };
    case "photoshop":
      return {
        templateKey,
        repoRoot,
        libraryFolder: resolveProgramGitScriptsFolder(repoRoot, "Photoshop"),
        activeFolder: resolveProgramLocalScriptsFolder(repoRoot, "Photoshop"),
        runtimeFolder: PHOTOSHOP_RUNTIME_SCRIPT_FOLDER,
        legacyScriptFolders: [
          joinWindowsPath(resolveProgramRoot(repoRoot, "Photoshop"), "Photoshop Scripts"),
          joinWindowsPath(resolveProgramRoot(repoRoot, "Photoshop"), "Photoshop Active Scripts"),
          joinWindowsPath(resolveProgramRoot(repoRoot, "Photoshop"), "ScriptBank"),
          PHOTOSHOP_RUNTIME_SCRIPT_FOLDER
        ]
      };
    case "blender":
      return {
        templateKey,
        repoRoot,
        libraryFolder: resolveProgramGitScriptsFolder(repoRoot, "Blender"),
        activeFolder: resolveProgramLocalScriptsFolder(repoRoot, "Blender"),
        runtimeFolder: joinWindowsPath(resolveProgramRoot(repoRoot, "Blender"), "FlowCellButtons"),
        wrapperFolder: joinWindowsPath(resolveProgramRoot(repoRoot, "Blender"), "FlowCellButtons"),
        legacyScriptFolders: [
          joinWindowsPath(resolveProgramRoot(repoRoot, "Blender"), "Blender Scripts"),
          joinWindowsPath(resolveProgramRoot(repoRoot, "Blender"), "Blender Active Scripts"),
          joinWindowsPath(resolveProgramRoot(repoRoot, "Blender"), "ScriptBank"),
          joinWindowsPath(resolveProgramRoot(repoRoot, "Blender"), "ManagedActions"),
          joinWindowsPath(resolveProgramRoot(repoRoot, "Blender"), "FlowCellButtons")
        ]
      };
    case "windows":
      {
        const workspaceRoot = resolveWorkspaceRootFromRepoRoot(repoRoot);
        const programRoot = resolveWindowsProgramRoot(repoRoot);
        return {
          templateKey,
          repoRoot,
          libraryFolder: resolveProgramGitScriptsFolder(repoRoot, "Windows"),
          activeFolder: resolveProgramLocalScriptsFolder(repoRoot, "Windows"),
          runtimeFolder: resolveProgramLocalScriptsFolder(repoRoot, "Windows"),
          legacyScriptFolders: [
            joinWindowsPath(programRoot, "Windows Scripts"),
            joinWindowsPath(programRoot, "Windows Active Scripts"),
            joinWindowsPath(programRoot, "ScriptBank"),
            joinWindowsPath(workspaceRoot, "Windows"),
            joinWindowsPath(workspaceRoot, "Windows", "ScriptBank")
          ]
        };
      }
    default:
      return null;
  }
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
        ScriptFolder: resolveProgramGitScriptsFolder(args.repoRoot, "Illustrator"),
        ActiveScriptFolder: resolveProgramLocalScriptsFolder(args.repoRoot, "Illustrator"),
        RuntimeScriptFolder: ILLUSTRATOR_RUNTIME_SCRIPT_FOLDER,
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
        ScriptFolder: resolveProgramGitScriptsFolder(args.repoRoot, "Photoshop"),
        ActiveScriptFolder: resolveProgramLocalScriptsFolder(args.repoRoot, "Photoshop"),
        RuntimeScriptFolder: PHOTOSHOP_RUNTIME_SCRIPT_FOLDER,
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
        ScriptFolder: resolveProgramGitScriptsFolder(args.repoRoot, "Blender"),
        ActiveScriptFolder: resolveProgramLocalScriptsFolder(args.repoRoot, "Blender"),
        RuntimeScriptFolder: joinWindowsPath(resolveProgramRoot(args.repoRoot, "Blender"), "FlowCellButtons"),
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
      {
        const windowsProgramRoot = resolveWindowsProgramRoot(args.repoRoot);
        return {
          NormalizedName: args.programName.trim().toLowerCase(),
          ProgramType: "generic",
          ExePath: args.exePath,
          ScriptFolder: resolveProgramGitScriptsFolder(args.repoRoot, "Windows"),
          ActiveScriptFolder: resolveProgramLocalScriptsFolder(args.repoRoot, "Windows"),
          RuntimeScriptFolder: resolveProgramLocalScriptsFolder(args.repoRoot, "Windows"),
          RunMethod: "generic",
          AllowedScriptExtensions: [],
          BridgeFolder: "",
          RequiresRestart: false,
          ProcessNames: ["explorer", "dopus", "dopusrt"]
        };
      }
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

function normalizeProgramConfig(
  programConfig: FlowCellProgram["ProgramConfig"],
  folders: ProgramManagedFolders | null
): FlowCellProgram["ProgramConfig"] {
  if (!programConfig) {
    if (!folders) {
      return programConfig;
    }
    return {
      ScriptFolder: folders.libraryFolder,
      ActiveScriptFolder: folders.activeFolder,
      RuntimeScriptFolder: folders.runtimeFolder
    };
  }

  if (!folders) {
    return programConfig;
  }

  return {
    ...programConfig,
    ScriptFolder: normalizeManagedProgramFolderPath(
      programConfig.ScriptFolder ?? "",
      folders.libraryFolder,
      folders
    ),
    ActiveScriptFolder: normalizeManagedProgramFolderPath(
      programConfig.ActiveScriptFolder ?? "",
      folders.activeFolder,
      folders
    ),
    RuntimeScriptFolder: normalizeManagedProgramFolderPath(
      programConfig.RuntimeScriptFolder ?? "",
      folders.runtimeFolder,
      folders
    )
  };
}

function normalizeScriptButtonForProgram(
  button: FlowCellButton,
  folders: ProgramManagedFolders | null
): FlowCellButton {
  const normalizedExecutionTarget = normalizeManagedPathForProgram(
    button.ExecutionTarget ?? "",
    folders
  );
  if (!folders || button.Kind !== "script") {
    return {
      ...button,
      ExecutionTarget: normalizedExecutionTarget || undefined
    };
  }

  const normalizedTarget = normalizeManagedPathForProgram(button.Target ?? "", folders);
  const targetName = normalizedTarget.split("\\").pop() ?? "";
  if (!targetName) {
    return {
      ...button,
      ExecutionTarget: normalizedExecutionTarget || undefined
    };
  }

  switch (folders.templateKey) {
    case "illustrator":
    case "photoshop": {
      const runtimeTarget = joinWindowsPath(folders.runtimeFolder, targetName);
      if (isPathWithinFolder(normalizedTarget, folders.activeFolder)) {
        return {
          ...button,
          Target: normalizedTarget,
          ExecutionTarget: normalizedExecutionTarget || runtimeTarget
        };
      }
      if (folders.legacyScriptFolders.some((folder) => isPathWithinFolder(normalizedTarget, folder))) {
        return {
          ...button,
          Target: joinWindowsPath(folders.activeFolder, targetName),
          ExecutionTarget: normalizedExecutionTarget || runtimeTarget
        };
      }
      return {
        ...button,
        ExecutionTarget: normalizedExecutionTarget || undefined
      };
    }
    case "windows": {
      const activeTarget = joinWindowsPath(folders.activeFolder, targetName);
      if (isPathWithinFolder(normalizedTarget, folders.activeFolder)) {
        return {
          ...button,
          Target: normalizedTarget,
          ExecutionTarget: normalizedTarget
        };
      }
      if (
        folders.legacyScriptFolders.some((folder) => isPathWithinFolder(normalizedTarget, folder)) &&
        !isPathWithinFolder(normalizedTarget, folders.libraryFolder)
      ) {
        return {
          ...button,
          Target: activeTarget,
          ExecutionTarget: activeTarget
        };
      }
      return {
        ...button,
        ExecutionTarget: normalizedExecutionTarget || undefined
      };
    }
    case "blender": {
      if (folders.wrapperFolder && isPathWithinFolder(normalizedTarget, folders.wrapperFolder)) {
        return {
          ...button,
          ExecutionTarget: normalizedExecutionTarget || normalizedTarget
        };
      }
      return {
        ...button,
        ExecutionTarget: normalizedExecutionTarget || undefined
      };
    }
    default:
      return {
        ...button,
        ExecutionTarget: normalizedExecutionTarget || undefined
      };
  }
}

function buildWindowsChromeWorkspaceButtons(
  program: FlowCellProgram,
  folders: ProgramManagedFolders | null
): FlowCellButton[] {
  const activeRoot =
    normalizeWindowsPath(program.ProgramConfig?.ActiveScriptFolder ?? "") ||
    normalizeWindowsPath(program.ProgramConfig?.RuntimeScriptFolder ?? "") ||
    folders?.activeFolder ||
    "";
  if (!activeRoot) {
    return [];
  }

  return [
    {
      Id: "button_windows_save_chrome_workspace",
      Kind: "script",
      Label: "Save Chrome Workspace",
      Target: joinWindowsPath(activeRoot, "save_chrome_workspace.ps1"),
      ExecutionTarget: joinWindowsPath(activeRoot, "save_chrome_workspace.ps1"),
      Tooltip: "Capture the current Chrome windows, URLs, and placement into the local Chrome workspace JSON.",
      Shortcut: "",
      BindingId: 0,
      command_id: "windows.chrome_workspace.save",
      style_group_id: "",
      transparent_popout: false
    },
    {
      Id: "button_windows_open_chrome_workspace",
      Kind: "script",
      Label: "Open Chrome Workspace",
      Target: joinWindowsPath(activeRoot, "open_chrome_workspace.ps1"),
      ExecutionTarget: joinWindowsPath(activeRoot, "open_chrome_workspace.ps1"),
      Tooltip: "Open the saved Chrome workspace and place each Chrome window back on its saved monitor and bounds.",
      Shortcut: "",
      BindingId: 0,
      command_id: "windows.chrome_workspace.open",
      style_group_id: "",
      transparent_popout: false
    }
  ];
}

function ensureWindowsChromeWorkspaceButtons(
  program: FlowCellProgram,
  folders: ProgramManagedFolders | null
): FlowCellProgram {
  if (folders?.templateKey !== "windows") {
    return program;
  }

  const utilityPanelIndex = program.Panels.findIndex(
    (panel) => panel.Id === "panel_utility" || panel.Name.trim().toLowerCase() === "utility"
  );
  if (utilityPanelIndex < 0) {
    return program;
  }

  const requiredButtons = buildWindowsChromeWorkspaceButtons(program, folders);
  if (requiredButtons.length === 0) {
    return program;
  }

  const utilityPanel = program.Panels[utilityPanelIndex];
  const nextButtons = [...utilityPanel.Buttons];

  for (const requiredButton of requiredButtons) {
    const targetName = targetFileName(requiredButton.Target);
    const existingIndex = nextButtons.findIndex((button) => {
      if (button.Id === requiredButton.Id) {
        return true;
      }
      const existingTarget = resolveButtonExecutionTarget(button) || button.Target;
      return targetFileName(existingTarget) === targetName;
    });

    if (existingIndex >= 0) {
      const existingButton = nextButtons[existingIndex];
      nextButtons[existingIndex] = {
        ...existingButton,
        Kind: requiredButton.Kind,
        Target: requiredButton.Target,
        ExecutionTarget: requiredButton.ExecutionTarget,
        Tooltip:
          existingButton.Tooltip && existingButton.Tooltip.trim().length > 0
            ? existingButton.Tooltip
            : requiredButton.Tooltip,
        Label:
          existingButton.Label && existingButton.Label.trim().length > 0
            ? existingButton.Label
            : requiredButton.Label,
        command_id: requiredButton.command_id
      };
      continue;
    }

    nextButtons.push(requiredButton);
  }

  const nextPanels = [...program.Panels];
  nextPanels[utilityPanelIndex] = {
    ...utilityPanel,
    Buttons: nextButtons
  };

  return {
    ...program,
    Panels: nextPanels
  };
}

function normalizeProgram(program: FlowCellProgram): FlowCellProgram {
  const folders = resolveProgramManagedFolders(program);
  const normalizedPanels = program.Panels.map((panel) => ({
    ...panel,
    FanOptions: normalizePanelFanOptions(panel.FanOptions),
    Buttons: panel.Buttons.map((button) => ({
      ...normalizeScriptButtonForProgram(button, folders),
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
  return ensureWindowsChromeWorkspaceButtons({
    ...program,
    ProgramConfig: normalizeProgramConfig(program.ProgramConfig, folders),
    style_group_id:
      typeof program.style_group_id === "string" && program.style_group_id.trim().length > 0
        ? program.style_group_id
        : DEFAULT_PROGRAM_STYLE_GROUP_ID,
    Panels: normalizedPanels
  }, folders);
}

function getBindingNumericId(binding: FlowCellBindingsState["scriptBindings"][number]): number {
  return binding.id ?? binding.bindingId ?? 0;
}

function findMatchingScriptBinding(
  button: FlowCellButton,
  programId: number,
  bindings: FlowCellBindingsState,
  folders: ProgramManagedFolders | null
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

  const bindingTargets = getButtonBindingTargets(button).map((target) =>
    normalizeManagedPathForProgram(target, folders)
  );
  if (bindingTargets.length === 0) {
    return undefined;
  }

  for (const buttonTarget of bindingTargets) {
    const binding =
      bindings.scriptBindings.find(
        (candidate) =>
          normalizeManagedPathForProgram(candidate.target ?? "", folders) === buttonTarget &&
          (candidate.programTabId ?? 0) === programId
      ) ??
      bindings.scriptBindings.find(
        (candidate) => normalizeManagedPathForProgram(candidate.target ?? "", folders) === buttonTarget
      );
    if (binding) {
      return binding;
    }
  }

  return undefined;
}

export function ensureStateDefaults(state: FlowCellState): FlowCellState {
  const { ToolChildStyleStates: _legacyToolChildStyleStates, ...stateWithoutChildStyles } = state as
    FlowCellState & {
      ToolChildStyleStates?: unknown;
    };
  const dedicatedButtonSkinTargets = collectDedicatedButtonSkinTargets(
    stateWithoutChildStyles.Programs ?? []
  );
  const importedSkinsSource = stateWithoutChildStyles.ImportedSkins
    ? [...stateWithoutChildStyles.ImportedSkins]
    : [];

  DEFAULT_IMPORTED_SKINS.forEach((defaultSkin) => {
    if (!importedSkinsSource.some((skin) => skin.id === defaultSkin.id)) {
      importedSkinsSource.push({ ...defaultSkin });
    }
  });

  const styleGroupsSource =
    stateWithoutChildStyles.StyleGroups && stateWithoutChildStyles.StyleGroups.length > 0
      ? [...stateWithoutChildStyles.StyleGroups]
      : [...DEFAULT_STYLE_GROUPS];

  DEFAULT_STYLE_GROUPS.forEach((defaultStyleGroup) => {
    if (!styleGroupsSource.some((styleGroup) => styleGroup.id === defaultStyleGroup.id)) {
      styleGroupsSource.push(defaultStyleGroup);
    }
  });

  const legacyMigration = migrateLegacyImportedSkinState({
    importedSkins: importedSkinsSource,
    styleGroups: styleGroupsSource
  });
  const importedSkins = normalizeImportedSkinCollection(
    legacyMigration.importedSkins,
    dedicatedButtonSkinTargets
  );

  const defaultImportedSkinId =
    importedSkins.find((skin) => skin.id === DEFAULT_IMPORTED_SKIN_ID)?.id ??
    importedSkins[0]?.id ??
    DEFAULT_IMPORTED_SKIN_ID;
  const normalizedStyleGroups = normalizeStyleGroupCollection({
    styleGroups: legacyMigration.styleGroups,
    importedSkins,
    defaultImportedSkinId,
    targets: dedicatedButtonSkinTargets
  });
  const styleGroups = [...normalizedStyleGroups];
  let nextStyleGroupIndex =
    styleGroups.reduce((maxIndex, styleGroup) => Math.max(maxIndex, styleGroup.index ?? 0), 0) + 1;

  importedSkins.forEach((importedSkin) => {
    if (isDedicatedButtonImportedSkinId(importedSkin.id)) {
      return;
    }

    const hasExplicitStyleGroup = styleGroups.some(
      (styleGroup) =>
        !isImportedSkinLibraryStyleGroupId(styleGroup.id) &&
        !isDedicatedButtonStyleGroupId(styleGroup.id) &&
        (styleGroup.importedSkinId ?? "").trim() === importedSkin.id
    );
    if (hasExplicitStyleGroup) {
      return;
    }

    const autoStyleGroupId = buildImportedSkinLibraryStyleGroupId(importedSkin.id);
    const existingIndex = styleGroups.findIndex((styleGroup) => styleGroup.id === autoStyleGroupId);
    const nextStyleGroup: StyleGroup = {
      id: autoStyleGroupId,
      index: existingIndex >= 0 ? styleGroups[existingIndex].index : nextStyleGroupIndex++,
      name: `Skin - ${importedSkin.name.trim() || importedSkin.id}`,
      skinId: "imported-skin",
      importedSkinId: importedSkin.id,
      accent: existingIndex >= 0 ? styleGroups[existingIndex].accent : "#ffb870"
    };

    if (existingIndex >= 0) {
      styleGroups[existingIndex] = nextStyleGroup;
      return;
    }

    styleGroups.push(nextStyleGroup);
  });

  const surfaceStyleAssignments =
    stateWithoutChildStyles.SurfaceStyleAssignments &&
    stateWithoutChildStyles.SurfaceStyleAssignments.length > 0
      ? [...stateWithoutChildStyles.SurfaceStyleAssignments]
      : [...DEFAULT_SURFACE_STYLE_ASSIGNMENTS];

  const legacyMainWorkspaceAssignmentIndex = surfaceStyleAssignments.findIndex(
    (assignment) => assignment.surface_id === ("main-workspace-buttons" as SurfaceStyleSectionId)
  );
  const mainButtonsAssignmentIndex = surfaceStyleAssignments.findIndex(
    (assignment) => assignment.surface_id === "main-buttons"
  );
  if (legacyMainWorkspaceAssignmentIndex >= 0) {
    const legacyAssignment = surfaceStyleAssignments[legacyMainWorkspaceAssignmentIndex];
    if (
      legacyAssignment &&
      legacyAssignment.style_group_id.trim().length > 0 &&
      (mainButtonsAssignmentIndex < 0 ||
        surfaceStyleAssignments[mainButtonsAssignmentIndex].style_group_id.trim().length === 0)
    ) {
      if (mainButtonsAssignmentIndex >= 0) {
        surfaceStyleAssignments[mainButtonsAssignmentIndex] = {
          ...surfaceStyleAssignments[mainButtonsAssignmentIndex],
          style_group_id: legacyAssignment.style_group_id
        };
      } else {
        surfaceStyleAssignments.push({
          surface_id: "main-buttons",
          style_group_id: legacyAssignment.style_group_id
        });
      }
    }
    surfaceStyleAssignments.splice(legacyMainWorkspaceAssignmentIndex, 1);
  }

  DEFAULT_SURFACE_STYLE_ASSIGNMENTS.forEach((defaultAssignment) => {
    if (
      !surfaceStyleAssignments.some(
        (assignment) => assignment.surface_id === defaultAssignment.surface_id
      )
    ) {
      surfaceStyleAssignments.push(defaultAssignment);
    }
  });
  const validStyleGroupIds = new Set(styleGroups.map((styleGroup) => styleGroup.id));
  const normalizedSurfaceStyleAssignments = surfaceStyleAssignments.map((assignment) => ({
    ...assignment,
    style_group_id: resolveValidStyleGroupId(
      remapStyleGroupId(assignment.style_group_id, legacyMigration.styleGroupAliases),
      validStyleGroupIds
    )
  }));

  return {
    ...stateWithoutChildStyles,
    AlignmentToolStates: stateWithoutChildStyles.AlignmentToolStates ?? [],
    ToolOptionStates: stateWithoutChildStyles.ToolOptionStates ?? [],
    ToolPopouts: stateWithoutChildStyles.ToolPopouts ?? [],
    PopoutClusters: normalizePopoutClusters(stateWithoutChildStyles.PopoutClusters),
    SavedPrograms: (stateWithoutChildStyles.SavedPrograms ?? []).map((record) =>
      normalizeSavedProgramRecord(record)
    ),
    SavedVisualThemes: (stateWithoutChildStyles.SavedVisualThemes ?? []).map((record) =>
      normalizeSavedVisualThemeRecord(record, dedicatedButtonSkinTargets)
    ),
    AppTheme: normalizeAppTheme(stateWithoutChildStyles.AppTheme),
    StyleGroups: styleGroups,
    ImportedSkins: importedSkins,
    SurfaceStyleAssignments: normalizedSurfaceStyleAssignments,
    Programs: stateWithoutChildStyles.Programs.map((program) =>
      normalizeProgram({
        ...program,
        style_group_id: resolveValidStyleGroupId(
          remapStyleGroupId(program.style_group_id, legacyMigration.styleGroupAliases),
          validStyleGroupIds
        ),
        Panels: program.Panels.map((panel) => ({
          ...panel,
          Buttons: panel.Buttons.map((button) => ({
            ...button,
            style_group_id: resolveValidStyleGroupId(
              remapStyleGroupId(button.style_group_id, legacyMigration.styleGroupAliases),
              validStyleGroupIds
            )
          }))
        }))
      })
    )
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
      Panels: (() => {
        const folders = resolveProgramManagedFolders(program);
        return program.Panels.map((panel) => ({
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

            const binding = findMatchingScriptBinding(
              button,
              program.ProgramTabId,
              bindings,
              folders
            );
            return {
              ...button,
              Shortcut: binding?.shortcut ?? "",
              BindingId: binding ? getBindingNumericId(binding) : 0
            };
          })
        }));
      })()
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
  if (toolPopout.LayoutMode === "PanelFan") {
    return findPanel(state, toolPopout.ProgramTabId, toolPopout.PanelId)?.Buttons ?? [];
  }

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
    targetFileName(resolveButtonExecutionTarget(button) || button.Target) === "util_alignment_tools.ps1"
  );
}

export function isFlattenRevolveOwnerButton(button: FlowCellButton): boolean {
  return (
    targetFileName(resolveButtonExecutionTarget(button) || button.Target) ===
    "util_flatten_revolve_tools.ps1"
  );
}

export function isQuickRotateGroupOwnerButton(button: FlowCellButton): boolean {
  return (
    targetFileName(resolveButtonExecutionTarget(button) || button.Target) ===
    "util_quick_rotate_group_tools.ps1"
  );
}

export function isHdriWorldOwnerButton(button: FlowCellButton): boolean {
  return (
    targetFileName(resolveButtonExecutionTarget(button) || button.Target) ===
    "util_hdri_world_tools.ps1"
  );
}

export function getSmartAxisCommandForButton(button: FlowCellButton): string {
  return SMART_AXIS_TARGET_TO_COMMAND[targetFileName(resolveButtonExecutionTarget(button) || button.Target)] ?? "";
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
    !isHdriWorldOwnerButton(button) &&
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

function matchesPanelClusterMember(memberId: string, programId: number, panelId: string): boolean {
  return (
    memberId.startsWith(`panel|${programId}|${panelId}`) ||
    memberId.startsWith(`tool|${programId}|${panelId}|`)
  );
}

export function deletePanel(
  state: FlowCellState,
  programId: number,
  panelId: string
): FlowCellState {
  const program = findProgram(state, programId);
  const removedPanelIndex = program?.Panels.findIndex((panel) => panel.Id === panelId) ?? -1;
  if (!program || removedPanelIndex < 0 || program.Panels.length <= 1) {
    return state;
  }

  const removedPanel = program.Panels[removedPanelIndex];
  const removedButtonIds = new Set(removedPanel.Buttons.map((button) => button.Id));
  const nextPanels = program.Panels.filter((panel) => panel.Id !== panelId);
  const currentSelectionStillExists = nextPanels.some(
    (panel) => panel.Id === program.SelectedPanelId
  );
  const fallbackPanel =
    nextPanels[removedPanelIndex] ??
    nextPanels[removedPanelIndex - 1] ??
    nextPanels[0];

  return {
    ...state,
    Programs: state.Programs.map((candidateProgram) =>
      candidateProgram.ProgramTabId === programId
        ? {
            ...candidateProgram,
            SelectedPanelId: currentSelectionStillExists
              ? candidateProgram.SelectedPanelId
              : fallbackPanel?.Id,
            Panels: candidateProgram.Panels
              .filter((panel) => panel.Id !== panelId)
              .map((panel) => ({
                ...panel,
                Buttons: panel.Buttons.map((button) =>
                  button.fanout
                    ? {
                        ...button,
                        fanout: {
                          ...button.fanout,
                          child_button_ids: button.fanout.child_button_ids.filter(
                            (childId) => !removedButtonIds.has(childId)
                          )
                        }
                      }
                    : button
                )
              }))
          }
        : candidateProgram
    ),
    AlignmentToolStates: (state.AlignmentToolStates ?? []).filter(
      (entry) => !(entry.ProgramTabId === programId && entry.PanelId === panelId)
    ),
    ToolOptionStates: (state.ToolOptionStates ?? []).filter(
      (entry) => !(entry.ProgramTabId === programId && entry.PanelId === panelId)
    ),
    ToolPopouts: (state.ToolPopouts ?? []).filter(
      (entry) => !(entry.ProgramTabId === programId && entry.PanelId === panelId)
    ),
    PopoutClusters: (state.PopoutClusters ?? []).filter(
      (cluster) =>
        !cluster.MemberIds.some((memberId) => matchesPanelClusterMember(memberId, programId, panelId))
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

function collectInstalledButtonTargets(button: Pick<FlowCellButton, "Target" | "ExecutionTarget">): string[] {
  return [button.Target ?? "", button.ExecutionTarget ?? ""]
    .map((value) => normalizeWindowsPath(value))
    .filter((value) => value.length > 0);
}

function doesInstalledButtonMatch(
  existingButton: Pick<FlowCellButton, "Target" | "ExecutionTarget">,
  incomingButton: Pick<FlowCellButton, "Target" | "ExecutionTarget">
): boolean {
  const existingTargets = new Set(collectInstalledButtonTargets(existingButton));
  return collectInstalledButtonTargets(incomingButton).some((target) => existingTargets.has(target));
}

export function upsertButtonsToPanel(
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
            Panels: program.Panels.map((panel) => {
              if (panel.Id !== panelId) {
                return panel;
              }

              const nextButtons = [...panel.Buttons];
              for (const incomingButton of buttons) {
                const existingIndex = nextButtons.findIndex((existingButton) =>
                  doesInstalledButtonMatch(existingButton, incomingButton)
                );
                if (existingIndex < 0) {
                  nextButtons.push(incomingButton);
                  continue;
                }

                const existingButton = nextButtons[existingIndex];
                nextButtons[existingIndex] = {
                  ...existingButton,
                  ...incomingButton,
                  Id: existingButton.Id,
                  Label: existingButton.Label || incomingButton.Label,
                  Tooltip:
                    incomingButton.Tooltip && incomingButton.Tooltip.trim().length > 0
                      ? incomingButton.Tooltip
                      : existingButton.Tooltip,
                  Shortcut: existingButton.Shortcut ?? "",
                  BindingId: existingButton.BindingId ?? 0,
                  style_group_id: existingButton.style_group_id ?? "",
                  fanout: existingButton.fanout,
                  transparent_popout: existingButton.transparent_popout
                };
              }

              return {
                ...panel,
                Buttons: nextButtons
              };
            })
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

export function buildScriptButtonsFromInstallResults(
  results: ManagedScriptInstallResultItem[],
  commandId: CommandEnvelope["command_id"]
): FlowCellButton[] {
  return results
    .filter((result) => result.installed && result.sourcePath.trim().length > 0)
    .map((result) => ({
      Id: `button_${createId("")}`,
      Kind: commandId === "flowcell.run_macro" ? "macro" : "script",
      command_id: commandId,
      Label: result.label?.trim() || buttonDisplayLabelFromPath(result.sourcePath),
      Target: result.sourcePath,
      ExecutionTarget: result.executionTarget?.trim() || undefined,
      Tooltip: result.tooltip?.trim() || "",
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
  const resolvedTarget = mapRepoPath(resolveButtonExecutionTarget(button) || button.Target, runtime);
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
    execution_target: button.ExecutionTarget ?? "",
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
      active_script_folder: mapRepoPath(programConfig.ActiveScriptFolder ?? "", runtime),
      runtime_script_folder: mapRepoPath(programConfig.RuntimeScriptFolder ?? "", runtime),
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

function getSmartAxisGroupButtonIds(buttons: FlowCellButton[]): string[] {
  return [
    buttons.find((button) => getSmartAxisCommandForButton(button) === "baseline"),
    buttons.find((button) => getSmartAxisCommandForButton(button) === "cycle_x"),
    buttons.find((button) => getSmartAxisCommandForButton(button) === "cycle_y"),
    buttons.find((button) => getSmartAxisCommandForButton(button) === "cycle_z"),
    buttons.find((button) => getSmartAxisCommandForButton(button) === "toggle_live")
  ]
    .filter((button): button is FlowCellButton => Boolean(button))
    .map((button) => button.Id);
}

function getReorderGroupButtonIds(
  buttons: FlowCellButton[],
  buttonId: string
): string[] {
  const button = buttons.find((entry) => entry.Id === buttonId);
  if (!button) {
    return [];
  }

  if (!isSmartAxisButton(button)) {
    return [buttonId];
  }

  return getSmartAxisGroupButtonIds(buttons);
}

function movePanelButton(
  buttons: FlowCellButton[],
  sourceButtonId: string,
  targetButtonId: string,
  placement: "before" | "after"
): FlowCellButton[] {
  const sourceGroupButtonIds = getReorderGroupButtonIds(buttons, sourceButtonId);
  const targetGroupButtonIds = getReorderGroupButtonIds(buttons, targetButtonId);
  if (
    sourceGroupButtonIds.length === 0 ||
    targetGroupButtonIds.length === 0 ||
    sourceGroupButtonIds.some((buttonId) => targetGroupButtonIds.includes(buttonId))
  ) {
    return buttons;
  }

  const sourceButtonIdSet = new Set(sourceGroupButtonIds);
  const targetButtonIdSet = new Set(targetGroupButtonIds);
  const movedButtons = buttons.filter((button) => sourceButtonIdSet.has(button.Id));
  const remainingButtons = buttons.filter((button) => !sourceButtonIdSet.has(button.Id));
  if (movedButtons.length === 0) {
    return buttons;
  }

  const targetStartIndex = remainingButtons.findIndex((button) =>
    targetButtonIdSet.has(button.Id)
  );
  if (targetStartIndex < 0) {
    return [...remainingButtons, ...movedButtons];
  }

  const targetEndIndex = remainingButtons.reduce(
    (lastMatchIndex, button, index) =>
      targetButtonIdSet.has(button.Id) ? index : lastMatchIndex,
    -1
  );
  const insertIndex = placement === "after" ? targetEndIndex + 1 : targetStartIndex;
  const nextButtons = [...remainingButtons];
  nextButtons.splice(insertIndex, 0, ...movedButtons);
  return nextButtons;
}

function sortButtonIdsByPanelOrder(
  orderedButtons: FlowCellButton[],
  buttonIds: string[]
): string[] {
  const orderLookup = new Map(
    orderedButtons.map((button, index) => [button.Id, index] as const)
  );

  return buttonIds
    .filter((buttonId) => orderLookup.has(buttonId))
    .sort((left, right) => (orderLookup.get(left) ?? 0) - (orderLookup.get(right) ?? 0));
}

export function reorderPanelButtons(
  state: FlowCellState,
  programId: number,
  panelId: string,
  sourceButtonId: string,
  targetButtonId: string,
  placement: "before" | "after" = "before"
): FlowCellState {
  const currentPanel = findPanel(state, programId, panelId);
  if (!currentPanel) {
    return state;
  }

  const reorderedButtons = movePanelButton(
    currentPanel.Buttons,
    sourceButtonId,
    targetButtonId,
    placement
  );
  if (reorderedButtons === currentPanel.Buttons) {
    return state;
  }

  const reorderedButtonIds = sortButtonIdsByPanelOrder(
    reorderedButtons,
    reorderedButtons.map((button) => button.Id)
  );
  const nextButtons = reorderedButtons.map((button) =>
    button.fanout?.child_button_ids?.length
      ? {
          ...button,
          fanout: {
            ...button.fanout,
            child_button_ids: sortButtonIdsByPanelOrder(
              reorderedButtons,
              button.fanout.child_button_ids
            )
          }
        }
      : button
  );

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
                    Buttons: nextButtons
                  }
                : panel
            )
          }
        : program
    ),
    ToolPopouts:
      state.ToolPopouts?.map((toolPopout) => {
        if (toolPopout.ProgramTabId !== programId || toolPopout.PanelId !== panelId) {
          return toolPopout;
        }

        const ownerButtonId = toolPopout.ButtonIds[0] ?? "";
        const orderedChildIds = sortButtonIdsByPanelOrder(
          reorderedButtons,
          toolPopout.ButtonIds.filter((buttonId) => buttonId !== ownerButtonId)
        );
        const nextButtonIds =
          toolPopout.LayoutMode === "PanelFan"
            ? [ownerButtonId, ...reorderedButtons.map((button) => button.Id)]
            : ownerButtonId
              ? [ownerButtonId, ...orderedChildIds]
              : reorderedButtonIds;

        return {
          ...toolPopout,
          ButtonIds: nextButtonIds
        };
      }) ?? []
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

export function applySavedVisualTheme(
  state: FlowCellState,
  savedTheme: SavedVisualTheme
): FlowCellState {
  const programStyleAssignments = new Map(
    (savedTheme.programStyleAssignments ?? []).map((assignment) => [
      assignment.programId,
      assignment.style_group_id ?? ""
    ])
  );
  const buttonStyleAssignments = new Map(
    (savedTheme.buttonStyleAssignments ?? []).map((assignment) => [
      `${assignment.programId}::${assignment.panelId}::${assignment.buttonId}`,
      assignment.style_group_id ?? ""
    ])
  );

  return ensureStateDefaults({
    ...state,
    AppTheme: normalizeAppTheme(savedTheme.appTheme),
    StyleGroups: (savedTheme.styleGroups ?? []).map((styleGroup) => ({ ...styleGroup })),
    ImportedSkins: (savedTheme.importedSkins ?? []).map((skin) => ({ ...skin })),
    SurfaceStyleAssignments: (savedTheme.surfaceStyleAssignments ?? []).map((assignment) => ({
      ...assignment
    })),
    Programs: state.Programs.map((program) => ({
      ...program,
      style_group_id: programStyleAssignments.get(program.ProgramTabId) ?? "",
      Panels: program.Panels.map((panel) => ({
        ...panel,
        Buttons: panel.Buttons.map((button) => ({
          ...button,
          style_group_id:
            buttonStyleAssignments.get(
              `${program.ProgramTabId}::${panel.Id}::${button.Id}`
            ) ?? ""
        }))
      }))
    }))
  });
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
