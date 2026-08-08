# FlowCell Native Ownership Map

`FlowCellFrontend/src-tauri/src/main.rs` is the native composition root. It
declares modules, registers Tauri commands, installs managed state, applies the
shared window setup hook, starts the scoped-topmost worker, and runs the app.
Feature logic does not live in the composition function.

## Command Modules

| Module | Ownership |
| --- | --- |
| `commands/programs.rs` | Managed program/panel discovery, setup, removal, transaction coordination, source labels, and program catalog paths. |
| `commands/bindings.rs` | Bindings INI parsing/writes, program-registration sections, shortcut profiles, bindable source discovery, and bind commands. |
| `commands/button_hotkeys.rs` | Tauri Tool Set owner/child shortcut validation, native registry synchronization, and mounted-Button event routing. |
| `commands/macros.rs` | Frontend macro schema, persistence, import/export, recording commands, and macro shortcut commands. |
| `commands/windows.rs` | Native foreground-window inspection, scoped topmost/owner behavior, taskbar-preview handling, host refresh, and the scoped worker. |
| `commands/filesystem.rs` | Shared repository/local roots, path normalization, PowerShell process helpers, and Recycle Bin primitives used by source transactions. |
| `commands/execution.rs` | Backend and bridge adapters, Blender/Illustrator/Windows execution, macro recording/execution, and installed-source event dispatch. |
| `commands/image_palette.rs` | Generic local-image decoding, sampling, and contrast-aware palette extraction for authorized installed-page requests. |
| `commands/layouts.rs` | Layout and generic file/folder dialogs plus layout snapshot persistence. |
| `commands/program_rename.rs` | Durable program-rename journals, exact native-state reconciliation, rollback/finalization, and startup recovery. |
| `commands/slicers.rs` | Slicer executable selection and launch behavior. |
| `commands/tool_packages.rs` | Capability-authorized tool-field files and package-library storage, including validated asset copying and listing. |

Canonical Button state and program-source ownership remain outside the command
modules:

- `button_state.rs` owns revisioned Button-state commits and uninstall
  coordination.
- `program_sources/` owns manifest validation, Local Scripts installation,
  active records, execution resolution, deletion, and first-start migration.

## Shared Native Interfaces

The composition root imports each command module's crate-visible interface so
the Tauri handler and existing `crate::...` calls in `program_sources/` keep one
implementation path. Source lifecycle code therefore still calls the same
validated program-root, bindings, recycle, and execution functions; the cleanup
does not add wrappers or parallel behavior.

The shared platform imports and small Windows timing/constants prelude remain in
`main.rs` because the command modules currently use the established
`use crate::*` pattern. Isolating every standard-library and Win32 import would
be a separate mechanical cleanup with no ownership or runtime benefit.
