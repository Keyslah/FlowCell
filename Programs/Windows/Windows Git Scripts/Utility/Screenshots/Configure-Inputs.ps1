# Declared input handler: FlowCell commits returned values and name together.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$context = $env:FLOWCELL_BUTTON_INPUTS_JSON | ConvertFrom-Json
$InitialName = if ($context.label) { [string]$context.label } else { 'Screenshots' }
$InitialFolder = if ($context.values.PSObject.Properties['folder']) { [string]$context.values.folder } else { '' }
# Preserve only an original migrated Button's old destination. An existing
# disabled owner cache must never fall back to that shared setting.
if (-not $context.editInputs -and -not $InitialFolder -and
    ([string]$context.ownerButtonId).StartsWith('button-migrated-') -and
    -not (Test-Path -LiteralPath ([string]$context.configPath))) {
    $legacyCache = Join-Path ([string]$context.localRoot) 'windows/temp-shots/temp-shots.folder.txt'
    if (Test-Path -LiteralPath $legacyCache -PathType Leaf) {
        $InitialFolder = [IO.File]::ReadAllText($legacyCache).Trim().Trim([char]0xFEFF)
        if (Test-Path -LiteralPath $InitialFolder -PathType Container) {
            [pscustomobject]@{
                label = $InitialName
                tooltip = "Capture a rectangle to $InitialFolder. Escape cancels without saving."
                values = @{ folder = $InitialFolder }
            } | ConvertTo-Json -Compress
            exit 0
        }
    }
}
Add-Type -AssemblyName System.Windows.Forms

$dialog = [Windows.Forms.FolderBrowserDialog]::new()
try {
    $dialog.Description = 'Choose the folder where this Screenshots button will save every capture.'
    $dialog.ShowNewFolderButton = $true
    $dialog.SelectedPath = if ($InitialFolder -and (Test-Path -LiteralPath $InitialFolder -PathType Container)) {
        $InitialFolder
    } else { [Environment]::GetFolderPath('MyPictures') }
    if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) {
        Write-Output '{"cancelled":true}'
        exit 0
    }
    $folder = [IO.Path]::GetFullPath($dialog.SelectedPath)
    $nameDialog = [Windows.Forms.Form]::new()
    try {
        $nameDialog.Text = 'Name Screenshots Button'
        $nameDialog.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
        $nameDialog.ClientSize = [Drawing.Size]::new(600, 170)
        $nameDialog.FormBorderStyle = [Windows.Forms.FormBorderStyle]::FixedDialog
        $nameDialog.MaximizeBox = $false
        $nameDialog.MinimizeBox = $false
        $nameDialog.ShowInTaskbar = $true
        $nameDialog.TopMost = $true
        $nameDialog.Font = [Drawing.Font]::new('Segoe UI', 10)

        $prompt = [Windows.Forms.Label]::new()
        $prompt.Location = [Drawing.Point]::new(12, 12)
        $prompt.Size = [Drawing.Size]::new(576, 68)
        $prompt.Text = "Name this screenshot button.`r`nEvery capture from this button will go to:`r`n$folder"
        $nameInput = [Windows.Forms.TextBox]::new()
        $nameInput.Location = [Drawing.Point]::new(12, 84)
        $nameInput.Size = [Drawing.Size]::new(576, 28)
        $nameInput.Text = $InitialName
        $ok = [Windows.Forms.Button]::new()
        $ok.Text = 'OK'
        $ok.Location = [Drawing.Point]::new(376, 125)
        $ok.Size = [Drawing.Size]::new(100, 32)
        $ok.DialogResult = [Windows.Forms.DialogResult]::OK
        $cancel = [Windows.Forms.Button]::new()
        $cancel.Text = 'Cancel'
        $cancel.Location = [Drawing.Point]::new(488, 125)
        $cancel.Size = [Drawing.Size]::new(100, 32)
        $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
        $nameDialog.Controls.AddRange(@($prompt, $nameInput, $ok, $cancel))
        $nameDialog.AcceptButton = $ok
        $nameDialog.CancelButton = $cancel
        $nameDialog.Add_Shown({ $nameDialog.Activate(); [void]$nameInput.Focus(); $nameInput.SelectAll() })
        $name = if ($nameDialog.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) { $nameInput.Text.Trim() } else { '' }
    }
    finally { $nameDialog.Dispose() }
    if (-not $name) {
        Write-Output '{"cancelled":true}'
        exit 0
    }
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
        throw 'The selected screenshot folder no longer exists. Choose the folder again.'
    }
    [pscustomobject]@{
        label = $name
        tooltip = "Capture a rectangle to $folder. Escape cancels without saving."
        values = @{ folder = $folder }
    } | ConvertTo-Json -Compress
}
finally { $dialog.Dispose() }
