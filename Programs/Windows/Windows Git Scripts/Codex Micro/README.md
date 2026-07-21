# Codex Micro

Catalog-only, independently assignable FlowCell source packages for the installed Codex desktop app. No FlowCell Button, binding, panel, UI, or installed Local Script is included.

The automation contract was verified against `OpenAI.CodexBeta 26.707.3351.0` (desktop bundle `26.707.30751`, embedded CLI `0.144.0-alpha.4`). Version-sensitive package names, waits, and reasoning labels are together at the top of every package's `CodexMicroHelpers.ps1`. Each folder is closed by its own `flowcell.script.json`; the helper is a companion file and is not a selectable action.

## Created actions

| Action | Entry file | What it does | Verified Codex interface |
| --- | --- | --- | --- |
| Open Codex | `Open Codex/open_codex.ps1` | Discovers the installed Beta or stable package, activates its exact AppUserModelId, and focuses the real main window. | Windows AppsFolder AUMID activation plus UI Automation main-window discovery (`RootWebArea`, name `Codex`). |
| New Task | `New Task/new_task.ps1` | Opens a blank task composer. | UI Automation `InvokePattern` on the visible enabled `New task` button. |
| Voice Prompt | `Voice Prompt/voice_prompt.ps1` | Starts Codex's own voice-input control. | UI Automation `InvokePattern` on the visible enabled `Dictate` button. No separate speech system. |
| Previous Thread | `Previous Thread/previous_thread.ps1` | Moves to the previous Codex task. | UI Automation on `View` > `Previous Task`; no synthesized shortcut. |
| Next Thread | `Next Thread/next_thread.ps1` | Moves to the next Codex task. | UI Automation on `View` > `Next Task`; no synthesized shortcut. |
| Stop Current Task | `Stop Current Task/stop_current_task.ps1` | Stops only the task currently displayed in the Codex main window. | UI Automation `InvokePattern` on the visible enabled `Stop` button. |
| Reasoning Level Up | `Reasoning Level Up/reasoning_level_up.ps1` | Selects the next verified effort level, stopping at the upper limit. | UI Automation `ExpandCollapsePattern` and `InvokePattern` on the composer model menu and its exact effort items. |
| Reasoning Level Down | `Reasoning Level Down/reasoning_level_down.ps1` | Selects the previous verified effort level, stopping at the lower limit. | UI Automation `ExpandCollapsePattern` and `InvokePattern` on the composer model menu and its exact effort items. |
| Refresh Thread Status | `Refresh Thread Status/refresh_thread_status.ps1` | Read-only status action. Prints exactly one of `Idle`, `Working`, `Needs Input`, `Changes Ready`, `Completed`, `Error`, or `Unknown`. | Current task accessibility state: Codex overlay labels; exact enabled `Apply changes`, `Apply`, `Deny`, or `Stop` controls; and exact `Worked for ` text. |

`Refresh Thread Status` returns `Unknown` when no trustworthy marker is present. The installed build has no explicit selected-task Idle marker exposed to UI Automation, so it does not infer Idle from the process, window title, pixels, or elapsed time. Exact overlay mappings are `Running` -> `Working`, `Needs input` -> `Needs Input`, `Ready` -> `Completed`, and `Blocked` -> `Error`.

## Restart and install behavior

Neither Codex nor FlowCell needs to restart or rescan for this catalog-only change. Assign an action later through Add Button by selecting that package's manifest or declared entry. An already installed copy does not auto-sync with future catalog edits; use FlowCell's existing update/re-add flow for that Button.

## Direct verification

Commands were run from the repository root with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <entry>`.

| Entry | Exact script output | Observable check |
| --- | --- | --- |
| `Open Codex/open_codex.ps1` | `Open Codex: OpenAI.CodexBeta 26.707.3351.0` | A minimized main window returned as `After=Normal`. |
| `New Task/new_task.ps1` | `New Task: invoked` | The main UI exposed a blank composer (`DraftSurface=True`); the original task was then restored. |
| `Voice Prompt/voice_prompt.ps1` | `Voice Prompt: invoked Dictate` | Codex changed the control to `Stop dictation`; invoking that verified control restored `Dictate` (`VoiceStopped=True`). |
| `Previous Thread/previous_thread.ps1` | `Previous Thread: invoked Previous Task` | The selected task changed from `Create Codex Micro scripts` to `Set 1/8 wood CAM tool`; the original task was restored. |
| `Next Thread/next_thread.ps1` | `Next Thread: invoked Next Task` | The selected task changed to `Fix Illustrator first-click focus`; the original task was restored. |
| `Stop Current Task/stop_current_task.ps1` | `Stop Current Task: invoked Stop` | A disposable running subtask changed from a visible Stop control to `StopCount=0` and `You stopped after 2m 37s`; its runtime status became interrupted. |
| `Reasoning Level Down/reasoning_level_down.ps1` | `Reasoning Level: Ultra -> Extra High` | The exact selected effort item changed to Extra High. |
| `Reasoning Level Up/reasoning_level_up.ps1` | `Reasoning Level: Extra High -> Ultra` | The exact selected effort item changed back to Ultra. |
| `Refresh Thread Status/refresh_thread_status.ps1` | `Working` | A visible enabled Stop control was present for the selected running task. |

## OpenMicro audit

[OpenMicro](https://github.com/stephenleo/OpenMicro) was inspected at commit `5914db5b8f4271d93dc5e0063e578b2d1bf4a5c8`. Its [Codex harness](https://github.com/stephenleo/OpenMicro/blob/5914db5b8f4271d93dc5e0063e578b2d1bf4a5c8/src/harness/codex.ts) controls Codex CLI through a PTY; it does not expose Windows desktop UI Automation, stable desktop task slots, voice input, or deterministic reasoning controls. No OpenMicro code was copied into these packages.

See `UNSUPPORTED.md` for requested actions that have no reliable verified desktop interface.
