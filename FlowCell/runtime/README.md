# FlowCell runtime

Release ZIPs can include portable runtime files here so FlowCell works without requiring separate system installs.

Expected AutoHotkey v2 runtime names:

- `AutoHotkey64.exe`
- `AutoHotkey.exe`

The source repository keeps EXE files ignored. Do not commit runtime binaries here. Add them only when building a release ZIP or place them locally in `FlowCell/local/bin`.
