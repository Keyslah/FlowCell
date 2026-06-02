# FlowCell

FlowCell is a desktop app to fire program scripts with big buttons(or small), macros, and hotkeys. It is for turning repeated work into nearby buttons, popouts, and shortcuts without digging through folders and menus or tiny buttons.

Its like a small control deck that stays on top of Blender, Illustrator, Photoshop, Windows, or any added program: pick a program, add a panel, click or bind a script.

## What It Is

FlowCell has a React, TypeScript, and Vite frontend in [FlowCellFrontend](FlowCellFrontend/) running inside Tauri. That frontend draws the main window, panels, binds station, macro lab, popouts, and tool windows.

The functional backend lives mainly in [FlowCell](FlowCell/): the PowerShell command host, AutoHotkey hotkey backend, launch helpers, logs, bindings, layouts, and local runtime state. Program scripts live under [Programs](Programs/), where each program keeps shared Git scripts, private local backups, and panel copies for the buttons you actually run.

## Programs

- [Blender](Programs/Blender/README.md): bridge-based tools and special toolboxes for workflows like rotate, align, boolean, remesh, theme/HDRI, dimensions, and snap.
- [Illustrator](Programs/Illustrator/README.md): JSX script panels plus Illustrator-aware toolsets such as alignment and rotate.
- [Photoshop](Programs/Photoshop/README.md): JSX script panels using the shared Git/local/panel script workflow.
- [Windows](Programs/Windows/README.md): utility scripts, repo helpers, monitor tools, Codex usage, and other desktop helpers.

## Organization

The Windows `Files` panel's `Fix This Folder` button uses the folder or file path copied to the clipboard, then normalizes that project folder into this numbered tree:

```text
<project folder>/
  01 src/
    01 Illustrator/
      01 live/
      02 snapshots/
      03 archive/
      04 trash/
    02 Photoshop/
      01 live/
      02 snapshots/
      03 archive/
      04 trash/
    03 Blender/
      01 live/
      02 snapshots/
      03 archive/
      04 trash/
    04 assets/
      01 images/
      02 svg/
      03 3d/
      04 textures/
      05 reference/
  02 builds/
  03 releases/
  04 archive/
```

Known work files move into the matching `01 live` folder, assets move into `04 assets`, and older clear `.ai`, `.psd`, or `.blend` duplicates are stored in `02 snapshots`.

## Important Links

- [PROGRAM_SUMMARY.txt](PROGRAM_SUMMARY.txt) for the current architecture and runtime behavior.
- [Repository layout](docs/repository-layout.md) for the Git/local/panel script workflow.
- [Blender scripts](docs/blender-scripts.md) for Blender Add Script and bridge behavior.
- [Root launcher](run.cmd), [command host](FlowCell/FlowCellCommandBackend.ps1), and [AutoHotkey backend](FlowCell/FlowCellBackend.ahk).
- [Frontend package](FlowCellFrontend/package.json) and [Tauri backend](FlowCellFrontend/src-tauri/src/main.rs).
- [Agent instructions](AGENTS.md) for repo rules.

## Codex Skills

Use [AI skills](docs/ai-skills.md) as the FlowCell prompt reference. It embeds the FlowCell/FlowTest skills for maintenance, layouts, toolsets, fanouts, exact SVG toolboxes, Blender theme work, and the button-skin contract.
