# Dynamic Organization

Dynamic Organization is FlowCell's role-based organization path for project folders.

Core rules:

- Roles are destinations or purposes. A role does not need file types.
- File types on roles are optional loose-file sorting hints.
- Button actions resolve outputRole directly instead of guessing from the file extension.
- unknown / Unknown Files is a preset role that catches loose files whose extension does not match any other role.
- If one loose file extension matches multiple roles, the engine leaves the file in place and reports an ambiguous result for the Tauri UI to ask the user.
- Program folders can be conditional. Conditional folders are created only when matching files or requested roles need them.
- Program-folder file types are separate from ordinary role routing. Matching working files create a numbered program folder under `01 src` beside `00 assets`, with `01 live`, `02 snapshots`, `03 archive`, and `04 trash`.
- Unrelated working files are all kept in `01 live`; only clear versions of the same filename family are split into newest-live and older-snapshots.

Files:

- Programs/Windows/SupportScripts/Dynamic-OrganizationCore.ps1
- Programs/Windows/Windows Git Scripts/Files/dynamic_organization.ps1
- FlowCellFrontend/src/features/organization/types.ts
- FlowCellFrontend/src/features/organization/organizationEngine.ts

Behavior split:

Button output uses button to outputRole to assigned folder. No extension guessing is used for button output.

Loose-file cleanup uses extension to matching role fileTypes to folder. If multiple roles match, the file is reported as ambiguous. If no roles match, the file goes to unknown / Unknown Files.

The Tauri/React setup window is wired into the Windows Files panel and exposes role assignment, named profiles, and conditional Program Folder rules.
