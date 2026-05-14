# Description: Runs set active monitor layout profile dialog.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

. (Join-Path $PSScriptRoot 'DummyMonitorHelpers.ps1')

$targetDisplay = Get-DummyMonitorTargetDisplay
$profilesResult = Invoke-DummyMonitorPython -Arguments @('--list-layouts-json')
if ($profilesResult.ExitCode -ne 0) {
    $detail = "Listing saved monitor layouts failed with exit code $($profilesResult.ExitCode)."
    $logTail = Get-DummyMonitorLastLogLines
    if (-not [string]::IsNullOrWhiteSpace($logTail)) {
        $detail += "`r`n`r`nRecent helper log:`r`n$logTail"
    }
    Write-DummyMonitorStatus -Text $detail
    throw $detail
}

$profilesJson = ($profilesResult.Output -join [Environment]::NewLine).Trim()
$profiles = @($profilesJson | ConvertFrom-Json)
if ($profiles.Count -eq 0) {
    [System.Windows.Forms.MessageBox]::Show(
        'No saved monitor layouts were found yet.',
        'Use Monitor Layout',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    exit 0
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Use Monitor Layout'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(760, 420)
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.AutoSize = $false
$label.Text = 'Choose a saved layout to apply now and use for future dummy restores.'
$label.Location = New-Object System.Drawing.Point(12, 12)
$label.Size = New-Object System.Drawing.Size(720, 22)
$form.Controls.Add($label)

$listView = New-Object System.Windows.Forms.ListView
$listView.Location = New-Object System.Drawing.Point(12, 42)
$listView.Size = New-Object System.Drawing.Size(720, 290)
$listView.View = [System.Windows.Forms.View]::Details
$listView.FullRowSelect = $true
$listView.GridLines = $true
$listView.HideSelection = $false
$listView.MultiSelect = $false
$listView.Columns.Add('Name', 330) | Out-Null
$listView.Columns.Add('Saved', 170) | Out-Null
$listView.Columns.Add('Active', 80) | Out-Null
$listView.Columns.Add('Paths', 70) | Out-Null

for ($i = 0; $i -lt $profiles.Count; $i++) {
    $profile = $profiles[$i]
    $item = New-Object System.Windows.Forms.ListViewItem($profile.name)
    [void]$item.SubItems.Add([string]$profile.saved_at)
    [void]$item.SubItems.Add($(if ($profile.is_active) { 'Yes' } else { '' }))
    [void]$item.SubItems.Add([string]$profile.path_count)
    $item.Tag = $i
    [void]$listView.Items.Add($item)
}

$selectedIndex = 0
foreach ($profile in $profiles) {
    if ($profile.is_active) {
        break
    }
    $selectedIndex++
}

if ($listView.Items.Count -gt 0) {
    $listView.Items[$selectedIndex].Selected = $true
    $listView.Items[$selectedIndex].Focused = $true
}
$form.Controls.Add($listView)

$useButton = New-Object System.Windows.Forms.Button
$useButton.Text = 'Apply Selected'
$useButton.Location = New-Object System.Drawing.Point(532, 342)
$useButton.Size = New-Object System.Drawing.Size(95, 30)
$useButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.Add($useButton)
$form.AcceptButton = $useButton

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = 'Cancel'
$cancelButton.Location = New-Object System.Drawing.Point(637, 342)
$cancelButton.Size = New-Object System.Drawing.Size(95, 30)
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($cancelButton)
$form.CancelButton = $cancelButton

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK -or $listView.SelectedItems.Count -eq 0) {
    exit 0
}

$targetName = $profiles[[int]$listView.SelectedItems[0].Tag].name

$applyResult = Invoke-DummyMonitorPython -Arguments @('--apply-layout', $targetName, '--target-display', $targetDisplay)
if ($applyResult.ExitCode -ne 0) {
    $detail = "Applying monitor layout '$targetName' failed with exit code $($applyResult.ExitCode)."
    $logTail = Get-DummyMonitorLastLogLines
    if (-not [string]::IsNullOrWhiteSpace($logTail)) {
        $detail += "`r`n`r`nRecent helper log:`r`n$logTail"
    }
    Write-DummyMonitorStatus -Text $detail
    throw $detail
}

Write-DummyMonitorStatus -Text ("Applied monitor layout '{0}'.`r`nTarget display: {1}`r`nHelper: {2}" -f $targetName, $targetDisplay, $applyResult.ScriptPath)
[System.Windows.Forms.MessageBox]::Show(
    "Applied layout '$targetName'. It is also now the active layout for future dummy restores.",
    'Use Monitor Layout',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null
