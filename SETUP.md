# FlowCell Setup

This is the normal-user path. Use this when you just want to run FlowCell, not build it.

## Download

Download from the GitHub Releases page:

```text
https://github.com/Keyslah/FlowCell/releases/latest
```

Do not use GitHub's automatic `Source code (zip)` download as the app download. That source archive is for developers and does not include the built app or bundled runtime files.

## Install the current Windows release

1. Download `flowcellwindowsinstaller.zip` from Releases.
2. Extract it and run the included Windows setup executable.
3. Launch **FlowCell** from the Start Menu.
4. Download the desired `FlowCell-<Program>.zip` packages. This release includes
   Blender, Fresco, Fusion 360, Illustrator, Krita and Windows.
5. Paste `%APPDATA%\FlowCell\local` into Explorer's address bar. Extract each
   program ZIP **into this folder**, merging its `Programs` folder. The result is
   `%APPDATA%\FlowCell\local\Programs\Blender\flowcell.program.json`, for example.
   Do not extract into another `Programs` folder or into the application folder.
6. Use the existing **Add Program → Managed package** workflow to register and
   configure the package and its host executable. Choose Register program only,
   Add everything, or Custom as appropriate.
7. Use the program normally, following the package's host restart/reload notes.

Setup includes the backend and AutoHotkey runtime. Normal app/updater use needs
no Node, npm, Rust, Cargo, Git, GitHub CLI, separate AutoHotkey, or GitHub login.
WebView2 is installed through setup when missing (internet access required).
Application-specific tools can still have their documented host/dependency
requirements; for example, Toggle Monitors uses Python. Builds are unsigned.

`Update Git Scripts` is an optional ordinary Button offered in Files. It can also
be added to a personal panel, including Local, with normal Add Button. It downloads
only that program's available catalog; it preserves local conflicts and does not
replace scripts already installed into Buttons. The source picker reads new
downloads immediately. Removing the updater does not cause it to be reinstalled.

FlowCell works before any package is installed. Its empty Windows folder is only
a placeholder. Normal upgrades/uninstall preserve user data and program packages.
Restart Blender after bridge registration, and Fusion after add-in changes.
Restart FlowCell after manually changing a program manifest. See
[installer release details](docs/installer-release.md).

## Existing portable releases

The instructions below apply to older portable Core downloads. The current
installer release does not contain a new portable Core ZIP.

### Pick a package

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
