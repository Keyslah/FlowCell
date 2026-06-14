# Illustrator Program Workflow

Illustrator uses the shared Git/local/panel script workflow.

- `Illustrator Git Scripts/`: tracked shareable source scripts, organized by panel subfolder.
- `Illustrator Local Scripts/`: ignored flat private backup/core copies. FlowCell never auto-deletes these.
- `Panels/`: ignored local panel runnable script copies.
- `HelperScripts/`: internal Illustrator helpers only.
- `SupportScripts/`: FlowCell-owned Illustrator runner helpers.
- `illustrator-actions.json`: manifest of action IDs mapped to tracked JSX sources.
- `Illustrator Git Scripts/FlowCell Buttons/`: tracked wrapper button sources that send action IDs to the warm Illustrator bridge.
- `ScriptDump/`: ignored loose/testing/old scripts.

Add Script copies the selected source into both `Illustrator Local Scripts` and the selected panel folder. Deleting a panel button never deletes the Local Scripts copy.

## Fast action bridge

The fast bridge keeps one STA Windows PowerShell process alive with an Illustrator COM connection. Button wrappers call `SupportScripts/Invoke-IllustratorFlowCellAction.ps1`, which validates the action ID against `illustrator-actions.json`, starts the bridge if needed, sends one named-pipe request, and returns as soon as the bridge accepts the action.

Useful commands:

```powershell
Programs\Illustrator\SupportScripts\Invoke-IllustratorFlowCellAction.ps1 -ListActions
Programs\Illustrator\SupportScripts\Invoke-IllustratorFlowCellAction.ps1 -StartOnly
Programs\Illustrator\SupportScripts\Invoke-IllustratorFlowCellAction.ps1 -ActionId ill-align
Programs\Illustrator\SupportScripts\Invoke-IllustratorFlowCellAction.ps1 -ActionId ill-align -Wait
Programs\Illustrator\SupportScripts\New-IllustratorFlowCellButtonWrappers.ps1
```

Add new fast buttons by adding an action entry to `illustrator-actions.json`, then run `New-IllustratorFlowCellButtonWrappers.ps1` to write the matching wrapper under `Illustrator Git Scripts/FlowCell Buttons/`.
