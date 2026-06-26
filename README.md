# FlowCell

FlowCell is a desktop app to fire scripts with buttons, macros, and hotkeys without digging through menus or using tiny pathetic buttons.

Its a small control deck that only stays on top of its respective program.

## Download

Use the GitHub Releases page, not GitHub's automatic source-code ZIP:

```text
https://github.com/Keyslah/FlowCell/releases/latest
```
The core of flowcell
```text
FlowCell-Core.zip
```
Download the program files, extract to flowcell\Programs folder and follow the instructions to integrate.
```text
FlowCell-Blender.zip
FlowCell-Illustrator.zip
FlowCell-Photoshop.zip
FlowCell-Windows.zip
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


## Organization
To use the files panels, you have to set up the file organizer with your filing system. 

https://github.com/Keyslah/FlowCell/blob/FlowCell/docs/File%20organizer.md  


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
