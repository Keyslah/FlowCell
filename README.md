# FlowCell

FlowCell is a desktop app to fire scripts with buttons, macros, and hotkeys without digging through menus or using tiny buttons.

Its like a small control deck that only stays on top of its respective program.

## Two Ways To Use FlowCell

### Just use FlowCell

Download the portable ZIP from GitHub Releases:

```text
FlowCell-portable.zip
```

Extract it, open the extracted folder, and double-click:

```text
Start FlowCell.cmd
```

The portable package includes the built FlowCell app and bundled AutoHotkey v2 runtime. Normal users do not need Node, npm, Rust, Cargo, Tauri build tools, or a separate AutoHotkey install.

Do not use GitHub's automatic `Source code (zip)` download as the app download. That source archive is for developers.

See [SETUP.md](SETUP.md) for normal-user setup.

### Build or develop FlowCell

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

In order for the files panel scripts of each program to work you need to have the scripts configured to work with your file structure. I use the one below. If you have a different one, you'll have to change the scripts to work with it.

The Windows `Files` panel's `Organize Folder` button uses the folder or file path copied to the clipboard, then creates the shared project folders without renumbering existing program folders:

```text
<project folder>/
  01 src/
    00 assets/
      01 images/
      02 svg/
      03 3d/
      04 textures/
      05 unknown/
    <existing or detected program folders>/
      01 live/
      02 snapshots/
      03 archive/
      04 trash/
  02 builds/
  03 releases/
  04 archive/
```

Assets always use `00 assets`. Program folders are created only when matching files are found, and existing numbered program folders keep their current names. Known saved files move into the matching program `01 live` folder, while older clear `.ai`, `.psd`, `.psb`, or `.blend` duplicates are stored in `02 snapshots`.

Each run writes `organize-folder.log.txt` plus `organize-folder.undo.json` in the project folder. The JSON manifest records file moves, structure-folder renames, created folders, recycled empty folders, timestamp stamps, conflicts, and unresolved items for AI/manual rollback. If the selected folder looks like a parent folder containing several separate projects, the organizer prints a warning and stops before writing a log or changing files.

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
