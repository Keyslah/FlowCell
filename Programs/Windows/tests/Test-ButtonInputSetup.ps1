# Check first-run setup routes without opening dialogs or running button actions.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$catalog = Join-Path (Split-Path -Parent $PSScriptRoot) 'Windows Git Scripts'
$script:checks = 0
function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:checks++
}
function Read-ScriptAst([string]$Path) {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
    Assert ($errors.Count -eq 0) "PowerShell parses: $Path"
    return $ast
}
function Get-FunctionSource($Ast, [string]$Name) {
    $function = $Ast.Find({ param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $Name
    }, $true)
    if ($null -eq $function) { throw "Missing function: $Name" }
    return $function.Extent.Text
}

$routes = @(
    @{ Folder='Utility/Snapshots'; Id='windows.snapshots'; Source='Snapshots.ps1'; Argument='-ConfigureOnly' },
    @{ Folder='Utility/shortcycle'; Id='windows.shortcycle'; Source='shortcycle.ps1'; Argument='-Configure' },
    @{ Folder='Files/Save Clipboard Text'; Id='windows.save-clipboard-text'; Source='save_clipboard_text.ps1'; Argument='-ConfigureOnly' },
    @{ Folder='Utility/Toggle Monitors'; Id='windows.toggle-monitors'; Source='Configure-Inputs.ps1'; Argument='' },
    @{ Folder='Files/FlowCell Backup'; Id='windows.flowcell-backup'; Source='file_flow_cell_back_up.ps1'; Argument='-ConfigureOnly' },
    @{ Folder='Files/GitHub Backup'; Id='windows.github-backup'; Source='file_github_back_up.ps1'; Argument='-ConfigureOnly' }
)
foreach ($route in $routes) {
    $package = Join-Path $catalog $route.Folder
    $manifest = Get-Content -LiteralPath (Join-Path $package 'flowcell.script.json') -Raw | ConvertFrom-Json
    Assert ($manifest.id -ceq $route.Id) "Correct package identity: $($route.Folder)"
    Assert ($manifest.inputSetup.source -ceq $route.Source -and
        ($manifest.inputSetup.arguments -join ' ') -ceq $route.Argument -and
        $manifest.inputSetup.firstRun -eq $false) "Explicit edit-only setup route: $($route.Id)"
    $null = Read-ScriptAst (Join-Path $package $route.Source)
}
Assert (-not (Test-Path -LiteralPath (Join-Path $catalog 'Files/Update GitHub/flowcell.script.json'))) 'Commit messages are not first-run Button setup.'

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-input-setup-tests-' + [guid]::NewGuid().ToString('N'))
try {
    [void][IO.Directory]::CreateDirectory($fixture)
    # Execute the real shortcycle setup/save path with only its dialog and action mocked.
    & {
        $ast = Read-ScriptAst (Join-Path $catalog 'Utility/shortcycle/shortcycle.ps1')
        . ([scriptblock]::Create((Get-FunctionSource $ast 'Invoke-Shortcycle')))
        . ([scriptblock]::Create((Get-FunctionSource $ast 'Write-AtomicJson')))
        $Configure = $true
        $script:shortcycleDirectory = Join-Path $fixture 'shortcycle'
        $script:shortcycleChoice = @('Ctrl+S', 'F5')
        function Get-SettingsDirectory { return $script:shortcycleDirectory }
        function Show-ShortcutSetup { return ,$script:shortcycleChoice }
        function Send-ShortcutToWindow { throw 'Edit Inputs must not send keys.' }
        Invoke-Shortcycle
        $settings = Join-Path $script:shortcycleDirectory 'shortcycle.json'
        $saved = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
        Assert (($saved.shortcuts -join ',') -ceq 'Ctrl+S,F5') 'shortcycle saves the selected setup without sending keys.'
        $before = [IO.File]::ReadAllText($settings)
        $script:shortcycleChoice = $null
        Invoke-Shortcycle
        Assert ([IO.File]::ReadAllText($settings) -ceq $before) 'Cancelling shortcycle setup preserves the saved list.'
    }

    # Execute the real clipboard dispatch, with no clipboard access or dialog.
    & {
        Add-Type -AssemblyName System.Windows.Forms
        $ast = Read-ScriptAst (Join-Path $catalog 'Files/Save Clipboard Text/save_clipboard_text.ps1')
        $dispatch = @($ast.EndBlock.Statements | Where-Object {
            $_ -is [Management.Automation.Language.TryStatementAst] -and $_.Extent.Text.Contains('$shiftHeld')
        })
        Assert ($dispatch.Count -eq 1) 'Clipboard setup/action dispatch is unique.'
        $ConfigureOnly = $true; $Configure = $false
        $settingsDirectory = 'unused'; $settingsPath = 'unused'
        $script:clipboardChoice = $fixture
        $script:clipboardPrompts = 0
        function Resolve-DestinationFolder {
            param($SettingsDirectory, $SettingsPath, [switch]$ForcePrompt)
            Assert ([bool]$ForcePrompt) 'Clipboard Edit Inputs reopens setup even when configured.'
            $script:clipboardPrompts++
            return $script:clipboardChoice
        }
        function Get-ClipboardTextResult { throw 'Edit Inputs must not read the clipboard.' }
        function Write-TextToNewFile { throw 'Edit Inputs must not create a clipboard file.' }
        function Show-UserMessage { throw 'Unexpected action failure in edit-only clipboard dispatch.' }
        & ([scriptblock]::Create($dispatch[0].Extent.Text))
        $script:clipboardChoice = ''
        & ([scriptblock]::Create($dispatch[0].Extent.Text))
        Assert ($script:clipboardPrompts -eq 2) 'Clipboard save and cancel both stop before the action.'
    }

    foreach ($folder in @('Files/FlowCell Backup', 'Files/GitHub Backup')) {
        & {
            $ast = Read-ScriptAst (Join-Path $catalog "$folder/file_github_back_up.ps1")
            . ([scriptblock]::Create((Get-FunctionSource $ast 'Resolve-BackupRootInteractive')))
            $script:backupChoice = $fixture; $script:backupSaved = ''; $script:backupPrompts = 0
            function Read-PersistedBackupRoot { return 'existing-choice' }
            function Get-BackupRoot { return 'existing-choice' }
            function Get-NormalizedFullPath { param($Path) return $Path }
            function Select-BackupRootFolder {
                param($InitialPath)
                Assert ($InitialPath -ceq 'existing-choice') 'Backup setup starts from its saved destination.'
                $script:backupPrompts++
                return $script:backupChoice
            }
            function Save-PersistedBackupRoot { param($Path) $script:backupSaved = $Path }
            Assert (Resolve-BackupRootInteractive) 'Configured backup normally skips setup.'
            Assert ($script:backupPrompts -eq 0) 'Normal configured backup does not reprompt.'
            Assert (Resolve-BackupRootInteractive -ForcePrompt) 'Edit Inputs reopens backup setup.'
            Assert ($script:backupSaved -ceq $fixture) 'Backup setup saves its new destination.'
            $script:backupChoice = ''
            Assert (-not (Resolve-BackupRootInteractive -ForcePrompt)) 'Backup setup cancellation is reported.'
            Assert ($script:backupSaved -ceq $fixture) 'Backup cancellation preserves its saved destination.'
            $dispatch = @($ast.EndBlock.Statements | Where-Object { $_.Extent.Text.StartsWith('if ($ConfigureOnly -or') })
            Assert ($dispatch.Count -eq 1) 'Backup edit-only dispatch is unique.'
            $tryBlock = $dispatch[0].Clauses[0].Item2.Statements[0]
            $configureBlock = $tryBlock.Body.Statements[0]
            Assert ($configureBlock.Clauses[0].Item1.Extent.Text -eq '$ConfigureOnly' -and
                $configureBlock.Clauses[0].Item2.Statements[-1] -is [Management.Automation.Language.ExitStatementAst]) 'Backup setup exits before starting its worker.'
        }
    }

    $launcher = [IO.File]::ReadAllText((Join-Path $catalog 'Utility/Toggle Monitors/Toggle Monitors.vbs'))
    $exitPosition = $launcher.IndexOf('If configureOnly Then WScript.Quit 0')
    Assert ($launcher.Contains('If LCase(argument) = "--configure-only" Then')) 'Monitor launcher accepts its explicit edit-only route.'
    Assert ($exitPosition -gt $launcher.IndexOf('If Not ResolveMonitorGroups(pythonwPath, forceConfigure)') -and
        $exitPosition -lt $launcher.IndexOf('RefreshStartupSafety pythonwPath') -and
        $exitPosition -lt $launcher.IndexOf(' --toggle-once --button-config ')) 'Monitor setup exits before startup registration and display toggling.'
    $snapshots = [IO.File]::ReadAllText((Join-Path $catalog 'Utility/Snapshots/Snapshots.ps1'))
    Assert ($snapshots.Contains('-ConfigureOnly:$ConfigureOnly -Mode snapshots')) 'Snapshots forwards configure-only mode to its shared folder setup.'
    Write-Output "Button input setup checks: $script:checks passed. No dialogs, captures, clipboard files, display changes, backups, browser actions, or Git actions ran."
}
finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notlike 'flowcell-input-setup-tests-*') { throw 'Unsafe fixture cleanup.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
