# FlowCell Native Ownership Map

`FlowCellFrontend/src-tauri/src/main.rs` is the native composition root. It
declares modules, registers Tauri commands, installs managed state, applies the
shared window setup hook, starts the scoped-topmost worker, and runs the app.
Feature logic does not live in the composition function.

## Command Modules

| Module | Ownership |
| --- | --- |
| `commands/programs.rs` | Program and panel folder discovery/mutation, registered-program commands, source labels, and program catalog paths. |
| `commands/bindings.rs` | Bindings INI parsing/writes, program-registration sections, shortcut profiles, bindable source discovery, and bind commands. |
| `commands/macros.rs` | Frontend macro schema, persistence, import/export, recording commands, and macro shortcut commands. |
| `commands/windows.rs` | Native foreground-window inspection, scoped topmost/owner behavior, taskbar-preview handling, host refresh, and the scoped worker. |
| `commands/filesystem.rs` | Shared repository/local roots, path normalization, PowerShell process helpers, and Recycle Bin primitives used by source transactions. |
| `commands/execution.rs` | Backend and bridge adapters, Blender/Illustrator/Windows execution, macro recording/execution, and installed-source event dispatch. |
| `commands/layouts.rs` | Layout and generic file/folder dialogs plus layout snapshot persistence. |
| `commands/organization.rs` | Organization project scanning, profiles, folder creation, recycling, and restoration. |
| `commands/illustrator.rs` | Installed Illustrator Layer Tree source resolution and bridge commands. |
| `commands/slicers.rs` | Slicer executable selection and launch behavior. |
| `commands/themes.rs` | Theme file I/O, image color sampling, and theme export support. |

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
