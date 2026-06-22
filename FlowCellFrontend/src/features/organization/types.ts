export type OrganizationRole = {
  roleId: string;
  displayName: string;
  folder: string;
  fileTypes?: string[];
  preset?: boolean;
  catchAllUnmatched?: boolean;
  description?: string;
};

export type ProgramFolderRule = {
  programId: string;
  displayName: string;
  folder: string;
  roles: string[];
  createOnlyIfMatchingFilesOrRolesPresent: boolean;
};

export type RememberedChoice =
  | string
  | {
      roleId: string;
      scope?: "project" | "run";
    };

export type OrganizationProfile = {
  profileVersion: 1;
  projectRoot: string;
  roles: OrganizationRole[];
  programFolders: ProgramFolderRule[];
  rememberedChoices?: Record<string, RememberedChoice>;
};

export type LooseFileInfo = {
  path: string;
  fileName: string;
  extension: string;
};

export type RoleResolution =
  | {
      status: "resolved";
      role: OrganizationRole;
      reason: "button-role" | "file-type" | "remembered-choice" | "unknown-files-catch-all";
      choices: [];
    }
  | {
      status: "ambiguous";
      role: null;
      reason: "multiple-file-type-roles";
      choices: OrganizationRole[];
    }
  | {
      status: "unresolved";
      role: null;
      reason: "role-not-found" | "no-matching-role-and-no-unknown-role";
      choices: [];
    };

export type ProgramFolderDecision = {
  programId: string;
  folder: string;
  createOnlyIfMatchingFilesOrRolesPresent: boolean;
  needed: boolean;
  reason: "always" | "matching-file" | "requested-role" | "not-needed";
};

export type AmbiguousFilePrompt = {
  title: string;
  fileName: string;
  extension: string;
  choices: Array<{
    roleId: string;
    displayName: string;
    folder: string;
  }>;
  scopes: Array<"file" | "run" | "project">;
};
