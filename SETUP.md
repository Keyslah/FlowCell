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
FlowCell-Photoshop.zip
FlowCell-Windows.zip
```

Base app plus one program.

```text
FlowCell-All.zip
```

Base app plus every included program.

## Install

1. Right-click the ZIP you downloaded.
2. Choose `Extract All`.
3. Open the extracted `FlowCell-*` folder.
4. Double-click `Start FlowCell.cmd`.

AutoHotkey v2 is bundled inside each portable package, so normal users do not need to install AutoHotkey separately.

Normal users also do not need Node, npm, Rust, Cargo, or Tauri build tools.

## Expected portable folder

```text
FlowCell-*/
  Start FlowCell.cmd
  FlowCell.exe
  FlowCell/
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

`FlowCell-Core.zip` has an empty `Programs` folder. `FlowCell-Blender.zip`, `FlowCell-Illustrator.zip`, `FlowCell-Photoshop.zip`, and `FlowCell-Windows.zip` include only that matching program folder. `FlowCell-All.zip` includes every program folder.

## Blender tools

Blender integration still needs the FlowCell Blender add-on files installed into Blender.

Use the paste-ready Blender add-on folder in:

```text
Programs/Blender/Blender Addons - Copy contents Into Blender/
```

Copy those files into Blender's user `scripts/addons` folder, enable the FlowCell add-on in Blender, then restart or reload Blender so the bridge is available.

## If FlowCell does not start

Run `Start FlowCell.cmd` again from the extracted portable folder and read the error shown in the command window. The launcher checks for the built app, bundled AutoHotkey runtime, and backend script before starting.
