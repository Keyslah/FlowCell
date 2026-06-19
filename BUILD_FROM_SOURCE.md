# Build FlowCell From Source

This is the developer path. Use this when you want to edit FlowCell, test code changes, build the frontend app, or create portable release ZIPs.

Normal users should use the GitHub Releases download instead of this path.

## Requirements

Install these on Windows:

- Git
- Node.js LTS
- Rust stable
- AutoHotkey v2 for source/dev mode
- PowerShell

Blender, Illustrator, and Photoshop are only needed for the integrations you want to use or test.

## Clone

```cmd
git clone https://github.com/Keyslah/FlowCell.git
cd FlowCell
git checkout FlowCell
```

## Developer launcher

Use the existing source/dev launcher:

```cmd
run.cmd
```

That existing launcher path is intentionally separate from the portable release launcher.

## Build the frontend app

This step creates the actual FlowCell app executable. This is the only part that needs Node, npm, Rust, and Tauri build tools.

```cmd
cd FlowCellFrontend
npm install
npm run tauri build
```

The built executable is expected at:

```text
FlowCellFrontend/src-tauri/target/release/flowcell_frontend.exe
```

## Create portable ZIPs from the already-built app

The packaging script does not build the app. It only wraps an already-built executable into release folders and ZIPs.

From the repo root:

```powershell
.\release-tools\package-portable.ps1 -BuiltExe ".\FlowCellFrontend\src-tauri\target\release\flowcell_frontend.exe" -AutoHotkeyExe "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe"
```

If the AutoHotkey license file is not found automatically, pass it explicitly:

```powershell
.\release-tools\package-portable.ps1 -BuiltExe ".\FlowCellFrontend\src-tauri\target\release\flowcell_frontend.exe" -AutoHotkeyExe "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe" -AutoHotkeyLicenseFile "C:\path\to\GPL-2.0.txt"
```

The generated release assets are:

```text
dist/FlowCell-Core.zip
dist/FlowCell-Blender.zip
dist/FlowCell-Illustrator.zip
dist/FlowCell-Photoshop.zip
dist/FlowCell-Windows.zip
```

Program ZIPs are generated from the direct folders currently under `Programs/`, so the exact list follows the repo's program folders. `FlowCell-Core.zip` contains the full app with an empty `Programs` folder. Each program ZIP contains only `Programs\<ProgramName>` and is meant to be extracted into the Core root.

Upload the ZIP files from `dist/` to GitHub Releases as release assets. Do not commit `dist/` into the repo.

## Launch path separation

```text
run.cmd
= source/developer path

Start FlowCell.cmd
= portable release path
```

The portable launcher directly uses bundled AutoHotkey from `FlowCell/runtime/AutoHotkey64.exe` inside the generated release package. It does not call npm, Cargo, Tauri build, or the source/dev backend launcher.
