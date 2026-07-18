# FlowCell Setup

This is the normal-user path. Use this when you just want to run FlowCell, not build it.

## Download

Download from the GitHub Releases page:

```text
https://github.com/Keyslah/FlowCell/releases/latest
```

Do not use GitHub's automatic `Source code (zip)` download as the app download. That source archive is for developers and does not include the built app or bundled runtime files.

## Pick a package

```text
FlowCell-Core.zip
```

Base app only. Smallest package.

```text
FlowCell-Blender.zip
FlowCell-Illustrator.zip
FlowCell-Windows.zip
```

Optional program payloads. Start with `FlowCell-Core.zip`, then download whichever payload ZIPs you want.

## Install

1. Extract `FlowCell-Core.zip`.
2. Extract each optional program payload ZIP into that same FlowCell Core folder and allow its `Programs` folder to merge.
3. Open the extracted FlowCell Core folder.
4. Double-click `Start FlowCell.cmd`.
5. In FlowCell, use `Add Program` once for each extracted payload. Keep the package name exactly `Blender`, `Illustrator`, or `Windows`, and select that program's EXE (for Windows, select `C:\Windows\explorer.exe`).

AutoHotkey v2 is bundled inside the Core package, so normal users do not need to install AutoHotkey separately.

Normal users also do not need Node, npm, Rust, Cargo, or Tauri build tools.

## Expected portable folder

```text
<FlowCell Core folder>/
  Start FlowCell.cmd
  FlowCell.exe
  flowcellbackend/
    FlowCellBackend.ahk
    FlowCellCommandBackend.ps1
    runtime/
      AutoHotkey64.exe
      AutoHotkey-LICENSE.txt
      AutoHotkey-SOURCE.txt
  Programs/
  tools/
  docs/
```

`FlowCell-Core.zip` has an empty `Programs` folder. Each program payload ZIP contains only `Programs\<ProgramName>`, so extracting it into the Core root makes that package available without replacing Core files. Extraction does not register or start the program integration; `Add Program` does that explicitly.

## Blender tools

After registering the Blender payload with `Add Program`, FlowCell installs or repairs the bridge from `Programs\Blender`, writes the Blender startup bootstrap, and keeps panel creation separate. Restart Blender once after adding Blender. If Blender has never created its user settings folder, open Blender once, close it, then restart FlowCell and add Blender again.

## If FlowCell does not start

Run `Start FlowCell.cmd` again from the extracted portable folder and read the error shown in the command window. The launcher checks for the built app, bundled AutoHotkey runtime, and backend script before starting.
