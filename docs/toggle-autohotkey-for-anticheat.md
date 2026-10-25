# Toggle AutoHotkey

FlowCell Setup includes the AutoHotkey runtime, background launcher, toggle and existing green/red icons. The **Create a Toggle AutoHotkey desktop shortcut** option is checked by default. The shortcut runs from the current user's installed FlowCell resources and works with both AutoHotkey and the FlowCell interface closed.

## Startup bindings

Add script Buttons to **Windows > Startup** and assign shortcuts with the existing Binds controls. Windows sign-in starts the installed background backend and registers the saved bindings. Each script runs when its shortcut is pressed. Closing FlowCell leaves those bindings available.

Saving or removing bindings reloads them while AutoHotkey is ON. Saves made while OFF are loaded on the next ON. Startup uses the same Button ownership, installed script paths and deletion lifecycle as other Windows panels.

## ON and OFF

- OFF records the choice before stopping every `AutoHotkey*.exe` process. Red/OFF is reported only after the process count reaches zero. A failed stop reports the remaining processes and keeps further FlowCell AutoHotkey launches disabled.
- ON ensures the current installed backend is ready and restores saved scripts without duplicating already-running commands. It never blindly toggles an existing backend OFF.
- OFF lasts for the current Windows authentication session, including FlowCell restarts, binding saves, recovery, sleep and unlock. A new Windows sign-in explicitly starts ON.
- Process status is separate from the user's choice. Refreshing the icon or status never enables or disables AutoHotkey.
- The installed backend reports its process ID and binding load/registration failures before startup is reported successful. Green means AutoHotkey processes are running; a failure message can accompany green when a backend or script could not start.

The shared state directory is `%LOCALAPPDATA%\FlowCell\autohotkey-toggle`. Each Windows authentication session has its own `AutoHotkeySessionState-<session-id>.json`. Snapshot, process-status and log files are stored beside it. The identity includes the Windows authentication ID and logon time, so unlocking is not treated as a new sign-in.

Upgrades preserve the new session preference. The first upgrade also imports an older toggle's confirmed manual-OFF record when its timestamp belongs to this sign-in, plus its saved script snapshot. An old status-only observation cannot prove a manual choice and is not treated as one. Prior-sign-in OFF records never disable the new session.

## Status and explicit ON

The desktop shortcut is the normal control. Advanced callers can use the installed script:

```powershell
& '<installed FlowCell>\tools\autohotkey v2 on off\Toggle-AutoHotkey.ps1' -StatusOnly
& '<installed FlowCell>\tools\autohotkey v2 on off\Toggle-AutoHotkey.ps1' -EnsureOn
```

`-StatusOnly` leaves the preference, snapshot and processes unchanged. `-EnsureOn` is idempotent. `-Quiet` suppresses the popup without changing the operation. Failure details are recorded in `AutoHotkeyToggle.log` and process-status JSON; the shortcut tooltip also includes the measured status/failure.

The installer owns shortcut creation. Status refresh does not recreate an opted-out or removed desktop shortcut. Uninstall removes this installation's sign-in and desktop shortcuts and preserves user scripts/settings.

## Managed launchers

The saved process snapshot normally supplies the scripts to restore. If no snapshot is available, an optional `Managed-AutoHotkeyLaunchers.txt` in the shared state directory supplies additional launchers. Use one quoted path and optional arguments per line; blank lines and `#` comments are ignored. The current installed FlowCell backend is always ensured separately, and stale saved backend commands are not replayed.

Source: [Toggle-AutoHotkey.ps1](../tools/autohotkey%20v2%20on%20off/Toggle-AutoHotkey.ps1), [hidden launcher](../tools/autohotkey%20v2%20on%20off/Toggle-AutoHotkey.vbs), and [installer workflow](installer-release.md).
