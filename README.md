# FlowCell

FlowCell is a desktop app to fire scripts with buttons, macros, and hotkeys without digging through menus or using tiny pathetic buttons.

Its a small control deck that only stays on top of its respective program.

## Download Here

```text
https://github.com/Keyslah/FlowCell/releases/latest
```


## What It Is

FlowCell has a React, TypeScript, and Vite frontend in [FlowCellFrontend](FlowCellFrontend/) running inside Tauri. 

The backend lives mainly in [flowcellbackend](flowcellbackend/): the PowerShell command host, AutoHotkey hotkey, launch helpers, logs, layouts, and local runtime state. Program scripts live under [Programs](Programs/), where each program keeps shared Git scripts, private local backups, and panel copies for the buttons you actually run.

Requires [AutoHotkey V2](https://www.autohotkey.com/download/ahk-v2.exe). AutoHotkey is inside the generated release.

[Toggle AutoHotkey for anti-cheat games](docs/toggle-autohotkey-for-anticheat.md): use this to disable AutoHotkey to play anti-cheat video games.


## Organization
To use the files panel, you have to set up the file organizer with your filing system. 

https://github.com/Keyslah/FlowCell/blob/FlowCell/docs/File%20organizer.md  

## Build or develop FlowCell

Developers should use the existing source launcher and build path.

See [BUILD_FROM_SOURCE.md](BUILD_FROM_SOURCE.md) for the developer setup and portable package build command.


## Codex Skills

Use [AI skills](docs/ai-skills.md) as the FlowCell prompt reference. It embeds the FlowCell skills for maintenance, layouts, toolsets, fanouts, and the button-skin contract.
