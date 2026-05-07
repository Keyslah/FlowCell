# FlowCell release notes

FlowCell source stays binary-free. Release ZIPs may include portable runtimes that are intentionally ignored by Git.

For a normal user-facing release, include AutoHotkey v2 in:

`FlowCell/runtime/AutoHotkey64.exe`

FlowCell/run.cmd looks for AutoHotkey in this order:

1. `FlowCell/runtime/AutoHotkey64.exe`
2. `FlowCell/runtime/AutoHotkey.exe`
3. `FlowCell/local/bin/AutoHotkey64.exe`
4. `FlowCell/local/bin/AutoHotkey.exe`
5. `C:/Program Files/AutoHotkey/v2/AutoHotkey64.exe`
6. `C:/Program Files/AutoHotkey/v2/AutoHotkey.exe`

This lets release downloads run without asking users to install AutoHotkey system-wide, while still allowing source users to provide their own local or installed AutoHotkey v2 runtime.
