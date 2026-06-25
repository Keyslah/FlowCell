import type {
  AmbiguousFilePrompt,
  LooseFileInfo,
  OrganizationProfile,
  OrganizationRole,
  ProgramFolderDecision,
  RoleResolution,
} from "./types";

const UNKNOWN_ROLE_ID = "unknown";
const PROJECT_ROOT_ROLE_ID = "project_root";
const UNKNOWN_ROLE_DESCRIPTION =
  "Unknown catches loose files whose file type does not match another role.";

export function normalizeFileTypes(value: string | string[] | undefined | null): string[] {
  const rawItems = Array.isArray(value) ? value : String(value ?? "").split(/[,\s;]+/);
  const seen = new Set<string>();
  const output: string[] = [];

  for (const raw of rawItems) {
    let extension = String(raw).trim().toLowerCase();
    if (!extension) continue;
    if (!extension.startsWith(".")) extension = `.${extension}`;
    if (extension === "." || seen.has(extension)) continue;
    seen.add(extension);
    output.push(extension);
  }

  return output;
}

export function createStarterOrganizationProfile(projectRoot: string): OrganizationProfile {
  return normalizeOrganizationProfile({
    profileVersion: 1,
    projectRoot,
    // The required presets plus exactly three default roles (Images, SVG, 3D).
    // They are available in the Role dropdown but unassigned (folder ""), so
    // nothing is added to any folder automatically. No program folders are
    // auto-assigned — the default programs live only as Add Folder presets.
    roles: [
      {
        roleId: PROJECT_ROOT_ROLE_ID,
        displayName: "Project Root",
        folder: ".",
        fileTypes: [],
        preset: true,
        description: "The project root itself. Files may intentionally stay loose here.",
      },
      {
        roleId: UNKNOWN_ROLE_ID,
        displayName: "Unknown Files",
        folder: "",
        fileTypes: [],
        preset: true,
        catchAllUnmatched: true,
        description: UNKNOWN_ROLE_DESCRIPTION,
      },
      {
        roleId: "images",
        displayName: "Images",
        folder: "",
        fileTypes: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"],
      },
      {
        roleId: "svg",
        displayName: "SVG",
        folder: "",
        fileTypes: [".svg", ".eps"],
      },
      {
        roleId: "3d",
        displayName: "3D",
        folder: "",
        fileTypes: [
          ".stl", ".obj", ".fbx", ".glb", ".gltf", ".3mf", ".ply", ".dae", ".usd",
          ".usdz", ".abc", ".x3d", ".step", ".stp", ".iges", ".igs", ".blend",
        ],
      },
    ],
    programFolders: [],
    rememberedChoices: {},
  });
}

export function normalizeOrganizationProfile(profile: OrganizationProfile): OrganizationProfile {
  const roles = new Map<string, OrganizationRole>();

  for (const role of profile.roles ?? []) {
    const roleId = String(role.roleId ?? "").trim();
    if (!roleId || roles.has(roleId)) continue;

    roles.set(roleId, {
      ...role,
      roleId,
      displayName: String(role.displayName || roleId),
      folder: String(role.folder ?? "").trim(),
      fileTypes: normalizeFileTypes(role.fileTypes),
      preset: Boolean(role.preset),
      catchAllUnmatched: Boolean(role.catchAllUnmatched),
      description: String(role.description || ""),
    });
  }

  roles.set(PROJECT_ROOT_ROLE_ID, {
    ...(roles.get(PROJECT_ROOT_ROLE_ID) ?? {}),
    roleId: PROJECT_ROOT_ROLE_ID,
    displayName: roles.get(PROJECT_ROOT_ROLE_ID)?.displayName || "Project Root",
    folder: ".",
    fileTypes: [],
    preset: true,
    catchAllUnmatched: false,
    description:
      roles.get(PROJECT_ROOT_ROLE_ID)?.description ||
      "The project root itself. Files may intentionally stay loose here.",
  });

  roles.set(UNKNOWN_ROLE_ID, {
    ...(roles.get(UNKNOWN_ROLE_ID) ?? {}),
    roleId: UNKNOWN_ROLE_ID,
    displayName: "Unknown Files",
    folder: roles.get(UNKNOWN_ROLE_ID)?.folder ?? "",
    fileTypes: [],
    preset: true,
    catchAllUnmatched: true,
    description: UNKNOWN_ROLE_DESCRIPTION,
  });

  return {
    profileVersion: 1,
    projectRoot: profile.projectRoot,
    roles: [...roles.values()],
    programFolders: (profile.programFolders ?? []).map((program) => ({
      programId: String(program.programId),
      displayName: String(program.displayName || program.programId),
      folder: String(program.folder || program.programId),
      fileTypes: normalizeFileTypes(program.fileTypes),
      roles: [...(program.roles ?? [])],
      createOnlyIfMatchingFilesOrRolesPresent: Boolean(
        program.createOnlyIfMatchingFilesOrRolesPresent,
      ),
    })),
    rememberedChoices: profile.rememberedChoices ?? {},
  };
}

export function getRole(profile: OrganizationProfile, roleId: string): OrganizationRole | null {
  return profile.roles.find((role) => role.roleId === roleId) ?? null;
}

export function resolveButtonRole(profile: OrganizationProfile, roleId: string): RoleResolution {
  const role = getRole(profile, roleId);
  if (!role) {
    return {
      status: "unresolved",
      role: null,
      reason: "role-not-found",
      choices: [],
    };
  }
  if (role.roleId === UNKNOWN_ROLE_ID && (!role.folder.trim() || role.folder.trim() === ".")) {
    return {
      status: "unresolved",
      role: null,
      reason: "unknown-role-needs-folder",
      choices: [],
    };
  }

  return {
    status: "resolved",
    role,
    reason: "button-role",
    choices: [],
  };
}

export function resolveLooseFile(profile: OrganizationProfile, file: LooseFileInfo): RoleResolution {
  const extension = normalizeFileTypes([file.extension])[0] ?? "";
  const rememberedChoice = profile.rememberedChoices?.[extension];
  const rememberedRoleId =
    typeof rememberedChoice === "string" ? rememberedChoice : rememberedChoice?.roleId;

  if (rememberedRoleId) {
    const rememberedRole = getRole(profile, rememberedRoleId);
    if (rememberedRole) {
      return {
        status: "resolved",
        role: rememberedRole,
        reason: "remembered-choice",
        choices: [],
      };
    }
  }

  const matches = profile.roles.filter((role) => {
    if (role.catchAllUnmatched) return false;
    return normalizeFileTypes(role.fileTypes).includes(extension);
  });

  if (matches.length === 1) {
    return {
      status: "resolved",
      role: matches[0],
      reason: "file-type",
      choices: [],
    };
  }

  if (matches.length > 1) {
    return {
      status: "ambiguous",
      role: null,
      reason: "multiple-file-type-roles",
      choices: matches,
    };
  }

  const unknownRole = getRole(profile, UNKNOWN_ROLE_ID);
  if (unknownRole && unknownRole.folder.trim() && unknownRole.folder.trim() !== ".") {
    return {
      status: "resolved",
      role: unknownRole,
      reason: "unknown-files-catch-all",
      choices: [],
    };
  }

  return {
    status: "unresolved",
    role: null,
    reason: unknownRole ? "unknown-role-needs-folder" : "no-matching-role-and-no-unknown-role",
    choices: [],
  };
}

export function roleDestinationPath(
  profile: OrganizationProfile,
  roleId: string,
  fileName?: string,
): string | null {
  const role = getRole(profile, roleId);
  if (!role) return null;

  const folder = role.folder.trim();
  if (role.roleId === UNKNOWN_ROLE_ID && (!folder || folder === ".")) return null;
  const folderPath =
    !folder || folder === "."
      ? profile.projectRoot
      : `${profile.projectRoot.replace(/[\\/]+$/, "")}/${folder.replace(/^[\\/]+/, "")}`;

  return fileName ? `${folderPath.replace(/[\\/]+$/, "")}/${fileName}` : folderPath;
}

export function getProgramFolderDecisions(
  profile: OrganizationProfile,
  looseFiles: LooseFileInfo[],
  requestedRoles: string[] = [],
): ProgramFolderDecision[] {
  return profile.programFolders.map((program): ProgramFolderDecision => {
    if (!program.createOnlyIfMatchingFilesOrRolesPresent) {
      return {
        programId: program.programId,
        folder: program.folder,
        createOnlyIfMatchingFilesOrRolesPresent: false,
        needed: true,
        reason: "always",
      };
    }

    if (requestedRoles.some((roleId) => program.roles.includes(roleId))) {
      return {
        programId: program.programId,
        folder: program.folder,
        createOnlyIfMatchingFilesOrRolesPresent: true,
        needed: true,
        reason: "requested-role",
      };
    }

    for (const file of looseFiles) {
      const extension = normalizeFileTypes([file.extension])[0] ?? "";
      if (normalizeFileTypes(program.fileTypes).includes(extension)) {
        return {
          programId: program.programId,
          folder: program.folder,
          createOnlyIfMatchingFilesOrRolesPresent: true,
          needed: true,
          reason: "matching-file",
        };
      }

      const resolution = resolveLooseFile(profile, file);
      if (resolution.status === "resolved" && program.roles.includes(resolution.role.roleId)) {
        return {
          programId: program.programId,
          folder: program.folder,
          createOnlyIfMatchingFilesOrRolesPresent: true,
          needed: true,
          reason: "matching-file",
        };
      }

      if (
        resolution.status === "ambiguous" &&
        resolution.choices.some((role) => program.roles.includes(role.roleId))
      ) {
        return {
          programId: program.programId,
          folder: program.folder,
          createOnlyIfMatchingFilesOrRolesPresent: true,
          needed: true,
          reason: "matching-file",
        };
      }
    }

    return {
      programId: program.programId,
      folder: program.folder,
      createOnlyIfMatchingFilesOrRolesPresent: true,
      needed: false,
      reason: "not-needed",
    };
  });
}

export function makeAmbiguousFilePrompt(file: LooseFileInfo, choices: OrganizationRole[]): AmbiguousFilePrompt {
  return {
    title: `Where should this ${file.extension || "file"} go?`,
    fileName: file.fileName,
    extension: file.extension,
    choices: choices.map((role) => ({
      roleId: role.roleId,
      displayName: role.displayName,
      folder: role.folder,
    })),
    scopes: ["file", "run", "project"],
  };
}
