# FlowCell

FlowCell is a desktop app to fire scripts with buttons, macros, and hotkeys without digging through menus or using tiny buttons.

Its like a small control deck that only stays on top of its respective program.

## Download

Use the GitHub Releases page, not GitHub's automatic source-code ZIP:

```text
https://github.com/Keyslah/FlowCell/releases/latest
```

Pick the download that matches what you want:

```text
FlowCell-Core.zip
```

Base app only. Use this when you want the smallest FlowCell package.

```text
FlowCell-Blender.zip
FlowCell-Illustrator.zip
FlowCell-Photoshop.zip
FlowCell-Windows.zip
```

Optional program payloads. Download `FlowCell-Core.zip`, then extract any payload ZIPs you want into the extracted FlowCell Core folder. Each payload merges into `Programs\<ProgramName>` and does not contain the Core app.

After downloading, extract the ZIP, open the extracted folder, and double-click:

```text
Start FlowCell.cmd
```

Normal users do not need Node, npm, Rust, Cargo, Tauri build tools, or a separate AutoHotkey install. The Core package includes the built FlowCell app and bundled AutoHotkey v2 runtime.

Do not use GitHub's automatic `Source code (zip)` download as the app download. That source archive is for developers.

See [SETUP.md](SETUP.md) for normal-user setup.

## Build or develop FlowCell

Developers should use the existing source launcher and build path.

See [BUILD_FROM_SOURCE.md](BUILD_FROM_SOURCE.md) for the developer setup and portable package build command.

## What It Is

FlowCell has a React, TypeScript, and Vite frontend in [FlowCellFrontend](FlowCellFrontend/) running inside Tauri. That frontend draws the main window, panels, binds station, macro lab, popouts, and tool windows.

The functional backend lives mainly in [FlowCell](FlowCell/): the PowerShell command host, AutoHotkey hotkey backend, launch helpers, logs, bindings, layouts, and local runtime state. Program scripts live under [Programs](Programs/), where each program keeps shared Git scripts, private local backups, and panel copies for the buttons you actually run.

Source/dev mode still uses [AutoHotkey V2](https://www.autohotkey.com/download/ahk-v2.exe). Portable release mode bundles AutoHotkey inside the generated release package.

[Toggle AutoHotkey for anti-cheat games](docs/toggle-autohotkey-for-anticheat.md): use this to disable AutoHotkey to play anti-cheat video games.

## Programs

- [Blender](Programs/Blender/README.md): bridge-based tools and special toolboxes for workflows like rotate, align, boolean, remesh, theme/HDRI, dimensions, and snap.
- [Illustrator](Programs/Illustrator/README.md): JSX script panels plus Illustrator-aware toolsets such as alignment and rotate.
- [Photoshop](Programs/Photoshop/README.md): JSX script panels using the shared Git/local/panel script workflow.
- [Windows](Programs/Windows/README.md): utility scripts, repo helpers, monitor tools, Codex usage, and other desktop helpers.

## Organization

The Windows `Files` panel `Setup Organization` button is the setup flow. The panel script at `Programs/Windows/Panels/Files/setup_organization.ps1` is only a marker; FlowCell intercepts the `setup_organization.ps1` filename before running a script and opens the native `organization-setup` Tauri/React window instead. The older WinForms script under `Programs/Windows/Windows Git Scripts/Files/setup_organization.ps1` is a standalone fallback, not the normal panel flow.

In the setup window:

1. Use `Project root` to browse to the project folder, then `Rescan` if the folder changes on disk.
2. Select a folder in the Project root tree. The root is shown as `.`.
3. Assign existing roles from the Role dropdown, use `Add Role` to create or edit a role and its file types, or use the direct `File types` field for one folder.
4. Use `Add Folder` to add a folder under the selected folder. `Add folder` creates it immediately; `Add when files match` creates it later only when its file types are present. The program presets are Illustrator, Photoshop, Blender, and Fusion 360, and folders with file types preview `01 live`, `02 snapshots`, `03 archive`, and `04 trash`.
5. Assign the `Unknown Files` role to a scanned folder before saving. It is the catch-all for loose files whose extension does not match another role.
6. Use `Apply to tree` to write the current setup to the project, or `Apply & rescan` to write it and refresh the scanned tree.

The project profile is written as a visible sidecar at the project root:

```text
<project folder>/organize-folder.profile.json
```

Older `.flowcell/organization-profile.json` files are still read as a fallback and migrate on the next save.

The Load profile side of the window is for reusable folder trees. `Save Profile` stores the current setup in two places:

```text
FlowCell/local/Folder Trees/<profile name>/
FlowCell/local/Folder Tree Profiles/<profile name>.json
```

`Load profile` loads that reusable setup into the editor without changing the current project root. `Apply profile to root` builds the loaded profile into the selected project root, writes `organize-folder.profile.json`, and runs the profile's conditional program-folder rules. If a subfolder is selected, it builds only the saved folder structure inside that subfolder and does not write a project profile there. `Apply to profile` saves the current editor state back into the loaded profile so you can build it up incrementally.

Applying a saved profile to a root first rebuilds the saved empty folder skeleton. Program-folder rules are then applied under the shared source area:

```text
<project folder>/
  01 src/
    00 assets/
    <profile program folders>/
      01 live/
      02 snapshots/
      03 archive/
      04 trash/
```

Program folders are conditional working-file destinations. Applying a profile reuses an existing matching program folder when possible, moves the newest clear version family member to `01 live`, moves older family members to `02 snapshots` as `(S01)`, `(S02)`, and so on, and records conflicts instead of overwriting files.

`Make script` generates a profile-specific script in `Programs/Windows/Windows Git Scripts/Files/apply_profile_<name>.ps1`. That script reads a destination folder or file path from the clipboard, applies the saved profile through `Programs/Windows/SupportScripts/Apply-OrganizationProfileCore.ps1`, and can be added to a panel with Add Script.

The legacy Windows `Files` panel `Organize Folder` button is separate. It still uses the clipboard path and writes `organize-folder.undo.json` in the project folder with file moves, structure renames, created folders, recycled empty folders, timestamp stamps, conflicts, unresolved items, and rollback data. It no longer writes `organize-folder.log.txt`.

## Important Links

- [SETUP.md](SETUP.md) for normal-user portable setup.
- [BUILD_FROM_SOURCE.md](BUILD_FROM_SOURCE.md) for developer setup and portable ZIP creation.
- [PROGRAM_SUMMARY.txt](PROGRAM_SUMMARY.txt) for the current architecture and runtime behavior.
- [Repository layout](docs/repository-layout.md) for the Git/local/panel script workflow.
- [Blender scripts](docs/blender-scripts.md) for Blender Add Script and bridge behavior.
- [Root launcher](run.cmd), [command host](FlowCell/FlowCellCommandBackend.ps1), and [AutoHotkey backend](FlowCell/FlowCellBackend.ahk).
- [Frontend package](FlowCellFrontend/package.json) and [Tauri backend](FlowCellFrontend/src-tauri/src/main.rs).
- [Agent instructions](AGENTS.md) for repo rules.

## Codex Skills

Use [AI skills](docs/ai-skills.md) as the FlowCell prompt reference. It embeds the FlowCell skills for maintenance, layouts, toolsets, fanouts, exact SVG toolboxes, Blender theme work, and the button-skin contract.
