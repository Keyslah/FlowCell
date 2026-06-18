# Build FlowCell From Source

This is the developer path. Use this when you want to edit FlowCell, test code changes, or create a portable release ZIP.

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

## Manual frontend build

```cmd
cd FlowCellFrontend
npm install
npm run tauri build
```

The built executable is expected at:

```text
FlowCellFrontend/src-tauri/target/release/flowcell_frontend.exe
```

## Create the portable ZIP

From the repo root:

```powershell
.\release-tools\package-portable.ps1 -AutoHotkeyExe "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe"
```

If the AutoHotkey license file is not found automatically, pass it explicitly:

```powershell
.\release-tools\package-portable.ps1 -AutoHotkeyExe "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe" -AutoHotkeyLicenseFile "C:\path\to\GPL-2.0.txt"
```

The generated output is:

```text
dist/FlowCell-portable/
dist/FlowCell-portable.zip
```

Upload `dist/FlowCell-portable.zip` to GitHub Releases as a release asset. Do not commit `dist/` into the repo.

## Launch path separation

```text
run.cmd
= source/developer path

Start FlowCell.cmd
= portable release path
```

The portable launcher directly uses bundled AutoHotkey from `FlowCell/runtime/AutoHotkey64.exe` inside the generated release package. It does not call npm, Cargo, Tauri build, or the source/dev backend launcher.
