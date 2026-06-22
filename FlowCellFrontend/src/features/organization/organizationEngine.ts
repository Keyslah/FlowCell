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
        folder: "Unknown Files",
        fileTypes: [],
        preset: true,
        catchAllUnmatched: true,
        description: "Catches loose files whose file type does not match any other role.",
      },
      {
        roleId: "illustrator_source",
        displayName: "Illustrator Source",
        folder: "Illustrator/Source AI",
        fileTypes: [".ai", ".ait"],
      },
      {
        roleId: "svg_export",
        displayName: "SVG Export",
        folder: "Illustrator/SVG Exports",
        fileTypes: [".svg", ".eps"],
      },
      {
        roleId: "laser_svg",
        displayName: "Laser SVG",
        folder: "Illustrator/Laser SVG",
        fileTypes: [],
      },
      {
        roleId: "dirty_stl",
        displayName: "Dirty STL",
        folder: "Meshes/Dirty STLs",
        fileTypes: [],
      },
      {
        roleId: "clean_stl",
        displayName: "Clean STL",
        folder: "Meshes/Clean STLs",
        fileTypes: [],
      },
      {
        roleId: "gcode",
        displayName: "GCode",
        folder: "Orca/GCode",
        fileTypes: [".gcode", ".nc", ".tap"],
      },
      {
        roleId: "reference",
        displayName: "Reference",
        folder: "References",
        fileTypes: [".pdf", ".txt", ".md"],
      },
    ],
    programFolders: [
      {
        programId: "illustrator",
        displayName: "Illustrator",
        folder: "Illustrator",
        createOnlyIfMatchingFilesOrRolesPresent: true,
        roles: ["illustrator_source", "svg_export", "laser_svg"],
      },
      {
        programId: "meshes",
        displayName: "Meshes",
        folder: "Meshes",
        createOnlyIfMatchingFilesOrRolesPresent: true,
        roles: ["dirty_stl", "clean_stl"],
      },
      {
        programId: "orca",
        displayName: "Orca",
        folder: "Orca",
        createOnlyIfMatchingFilesOrRolesPresent: true,
        roles: ["gcode"],
      },
      {
        programId: "reference",
        displayName: "Reference",
        folder: "References",
        createOnlyIfMatchingFilesOrRolesPresent: true,
        roles: ["reference"],
      },
    ],
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
      folder: String(role.folder || roleId),
      fileTypes: normalizeFileTypes(role.fileTypes),
      preset: Boolean(role.preset),
      catchAllUnmatched: Boolean(role.catchAllUnmatched),
      description: String(role.description || ""),
    });
  }

  if (!roles.has(PROJECT_ROOT_ROLE_ID)) {
    roles.set(PROJECT_ROOT_ROLE_ID, {
      roleId: PROJECT_ROOT_ROLE_ID,
      displayName: "Project Root",
      folder: ".",
      fileTypes: [],
      preset: true,
      description: "The project root itself. Files may intentionally stay loose here.",
    });
  }

  roles.set(UNKNOWN_ROLE_ID, {
    ...(roles.get(UNKNOWN_ROLE_ID) ?? {}),
    roleId: UNKNOWN_ROLE_ID,
    displayName: "Unknown Files",
    folder: roles.get(UNKNOWN_ROLE_ID)?.folder || "Unknown Files",
    fileTypes: [],
    preset: true,
    catchAllUnmatched: true,
    description: "Catches loose files whose file type does not match any other role.",
  });

  return {
    profileVersion: 1,
    projectRoot: profile.projectRoot,
    roles: [...roles.values()],
    programFolders: (profile.programFolders ?? []).map((program) => ({
      programId: String(program.programId),
      displayName: String(program.displayName || program.programId),
      folder: String(program.folder || program.programId),
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
  if (unknownRole) {
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
    reason: "no-matching-role-and-no-unknown-role",
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
