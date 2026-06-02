# FlowCell

FlowCell is a desktop app to fire program scripts with big buttons(or small), macros, and hotkeys. It is for turning repeated work into nearby buttons, popouts, and shortcuts without digging through folders and menus or tiny buttons.

Its like a small control deck that stays on top of Blender, Illustrator, Photoshop, Windows, or any added program: pick a program, pick a panel, click or bind a script.

## What It Is

FlowCell has a React, TypeScript, and Vite frontend in [FlowCellFrontend](FlowCellFrontend/) running inside Tauri. That frontend draws the main window, panels, binds station, macro lab, popouts, and tool windows.

The functional backend lives mainly in [FlowCell](FlowCell/): the PowerShell command host, AutoHotkey hotkey backend, launch helpers, logs, bindings, layouts, and local runtime state. Program scripts live under [Programs](Programs/), where each program keeps shared Git scripts, private local backups, and panel copies for the buttons you actually run.

## Programs

- [Blender](Programs/Blender/README.md): bridge-based tools and special toolboxes for workflows like rotate, align, boolean, remesh, theme/HDRI, dimensions, and snap.
- [Illustrator](Programs/Illustrator/README.md): JSX script panels plus Illustrator-aware toolsets such as alignment and rotate.
- [Photoshop](Programs/Photoshop/README.md): JSX script panels using the shared Git/local/panel script workflow.
- [Windows](Programs/Windows/README.md): utility scripts, repo helpers, monitor tools, Codex usage, and other desktop helpers.

## Important Links

- [PROGRAM_SUMMARY.txt](PROGRAM_SUMMARY.txt) for the current architecture and runtime behavior.
- [Repository layout](docs/repository-layout.md) for the Git/local/panel script workflow.
- [Blender buttons](docs/blender-buttons.md) for Blender Add Button and bridge behavior.
- [Root launcher](run.cmd), [command host](FlowCell/FlowCellCommandBackend.ps1), and [AutoHotkey backend](FlowCell/FlowCellBackend.ahk).
- [Frontend package](FlowCellFrontend/package.json) and [Tauri backend](FlowCellFrontend/src-tauri/src/main.rs).
- [Agent instructions](AGENTS.md) for repo rules.

## Codex Skills

- [flow-test](C:/Users/aaron/AppData/Local/CodexClean/skills/flow-test/SKILL.md): main FlowCell/FlowTest maintenance workflow.
- [layout](C:/Users/aaron/AppData/Local/CodexClean/skills/layout/SKILL.md): window, popout, layout, and saved-bounds issues.
- [blender-theme](C:/Users/aaron/AppData/Local/CodexClean/skills/blender-theme/SKILL.md): Blender theme color mapping and theme/HDRI work.
- [toolsets](C:/Users/aaron/AppData/Local/CodexClean/skills/flowtest-tool-set-buttons/SKILL.md): FlowCell toolset and popout button work.
