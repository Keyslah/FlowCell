[CmdletBinding()]
param(
    [Parameter()]
    [string]$ModelPath,

    [Parameter()]
    [string]$ResultPath,

    [Parameter()]
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Get-RequiredProperty {
    param(
        [Parameter(Mandatory = $true)]
        [object]$InputObject,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [int]$MonitorNumber
    )

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        throw "Monitor $MonitorNumber is missing required '$Name' data."
    }
    return $property.Value
}

function Read-PickerModel {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Toggle Monitors picker model was not found: $Path"
    }

    try {
        $model = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
    }
    catch {
        throw "Toggle Monitors picker model is not valid JSON: $($_.Exception.Message)"
    }

    if ($null -eq $model -or $null -eq $model.PSObject.Properties['monitors']) {
        throw "Toggle Monitors picker model must contain a 'monitors' array."
    }

    $items = @($model.monitors)
    if ($items.Count -eq 0) {
        throw 'Toggle Monitors picker model contains no monitors.'
    }

    $seenTokens = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $normalized = [System.Collections.Generic.List[object]]::new()

    for ($index = 0; $index -lt $items.Count; $index++) {
        $monitorNumber = $index + 1
        $item = $items[$index]
        if ($null -eq $item) {
            throw "Monitor $monitorNumber is null."
        }

        $label = [string](Get-RequiredProperty -InputObject $item -Name 'label' -MonitorNumber $monitorNumber)
        $token = [string](Get-RequiredProperty -InputObject $item -Name 'token' -MonitorNumber $monitorNumber)
        $group1 = Get-RequiredProperty -InputObject $item -Name 'group1' -MonitorNumber $monitorNumber
        $group2 = Get-RequiredProperty -InputObject $item -Name 'group2' -MonitorNumber $monitorNumber

        if ([string]::IsNullOrWhiteSpace($label)) {
            throw "Monitor $monitorNumber has an empty label."
        }
        if (-not [System.Text.RegularExpressions.Regex]::IsMatch($token, '^tm1\.[A-Za-z0-9_-]+$')) {
            throw "Monitor $monitorNumber has an invalid target token."
        }
        if (-not $seenTokens.Add($token)) {
            throw "Monitor $monitorNumber repeats target token '$token'."
        }
        if ($group1 -isnot [bool] -or $group2 -isnot [bool]) {
            throw "Monitor $monitorNumber group values must be JSON booleans."
        }

        [void]$normalized.Add([pscustomobject][ordered]@{
            label = $label.Trim()
            token = $token
            group1 = [bool]$group1
            group2 = [bool]$group2
        })
    }

    return $normalized.ToArray()
}

function Get-GroupValidationError {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$Group1,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$Group2
    )

    $group1Set = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]@($Group1),
        [System.StringComparer]::Ordinal
    )
    $group2Set = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]@($Group2),
        [System.StringComparer]::Ordinal
    )

    if ($group1Set.Count -eq 0) {
        return 'Select at least one monitor in Group 1.'
    }
    if ($group2Set.Count -eq 0) {
        return 'Select at least one monitor in Group 2.'
    }
    if ($group1Set.SetEquals($group2Set)) {
        return 'Group 1 and Group 2 must be different. A monitor may still belong to both.'
    }
    return ''
}

function New-PickerResult {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Cancelled,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$Group1,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$Group2
    )

    return [pscustomobject][ordered]@{
        schemaVersion = 1
        cancelled = $Cancelled
        group1 = [string[]]@($Group1)
        group2 = [string[]]@($Group2)
    }
}

function Write-PickerResult {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [object]$Result
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $parent = [System.IO.Path]::GetDirectoryName($fullPath)
    if ([string]::IsNullOrWhiteSpace($parent)) {
        throw "Toggle Monitors result path has no parent folder: $Path"
    }
    [void][System.IO.Directory]::CreateDirectory($parent)

    $json = $Result | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($fullPath, $json, $script:Utf8NoBom)
}

function Get-CheckedTokens {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Forms.CheckedListBox]$List,

        [Parameter(Mandatory = $true)]
        [object[]]$Monitors
    )

    $tokens = [System.Collections.Generic.List[string]]::new()
    foreach ($checkedIndex in $List.CheckedIndices) {
        [void]$tokens.Add([string]$Monitors[[int]$checkedIndex].token)
    }
    return $tokens.ToArray()
}

function Show-MonitorGroupPicker {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Monitors
    )

    if ([System.Threading.Thread]::CurrentThread.ApartmentState -ne [System.Threading.ApartmentState]::STA) {
        throw 'Toggle Monitors Picker must be launched in an STA PowerShell process.'
    }

    [System.Windows.Forms.Application]::EnableVisualStyles()

    $listHeight = [Math]::Min(420, [Math]::Max(150, ($Monitors.Count * 19) + 10))
    $groupTop = 76
    $groupHeight = $listHeight + 44
    $noteTop = $groupTop + $groupHeight + 10
    $errorTop = $noteTop + 42
    $buttonTop = $errorTop + 42

    $form = New-Object System.Windows.Forms.Form
    try {
        $form.Text = 'Toggle Monitors - choose groups'
        $form.ClientSize = New-Object System.Drawing.Size(860, ($buttonTop + 54))
        $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
        $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
        $form.MaximizeBox = $false
        $form.MinimizeBox = $false
        $form.ShowInTaskbar = $true
        $form.TopMost = $true
        $form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
        $form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

        $instruction = New-Object System.Windows.Forms.Label
        $instruction.AutoSize = $false
        $instruction.Location = New-Object System.Drawing.Point(16, 14)
        $instruction.Size = New-Object System.Drawing.Size(828, 50)
        $instruction.Text = 'Choose the exact monitors for each side. Group 1 is also the normal set restored at sign-in and wake, so include at least one screen you can physically see.'
        $form.Controls.Add($instruction)

        $group1Box = New-Object System.Windows.Forms.GroupBox
        $group1Box.Text = 'Group 1 - normal / startup'
        $group1Box.Location = New-Object System.Drawing.Point(16, $groupTop)
        $group1Box.Size = New-Object System.Drawing.Size(408, $groupHeight)
        $form.Controls.Add($group1Box)

        $group2Box = New-Object System.Windows.Forms.GroupBox
        $group2Box.Text = 'Group 2'
        $group2Box.Location = New-Object System.Drawing.Point(436, $groupTop)
        $group2Box.Size = New-Object System.Drawing.Size(408, $groupHeight)
        $form.Controls.Add($group2Box)

        $group1List = New-Object System.Windows.Forms.CheckedListBox
        $group1List.CheckOnClick = $true
        $group1List.HorizontalScrollbar = $true
        $group1List.IntegralHeight = $false
        $group1List.Location = New-Object System.Drawing.Point(12, 24)
        $group1List.Size = New-Object System.Drawing.Size(384, $listHeight)
        $group1Box.Controls.Add($group1List)

        $group2List = New-Object System.Windows.Forms.CheckedListBox
        $group2List.CheckOnClick = $true
        $group2List.HorizontalScrollbar = $true
        $group2List.IntegralHeight = $false
        $group2List.Location = New-Object System.Drawing.Point(12, 24)
        $group2List.Size = New-Object System.Drawing.Size(384, $listHeight)
        $group2Box.Controls.Add($group2List)

        foreach ($monitor in $Monitors) {
            [void]$group1List.Items.Add([string]$monitor.label, [bool]$monitor.group1)
            [void]$group2List.Items.Add([string]$monitor.label, [bool]$monitor.group2)
        }

        $note = New-Object System.Windows.Forms.Label
        $note.AutoSize = $false
        $note.Location = New-Object System.Drawing.Point(16, $noteTop)
        $note.Size = New-Object System.Drawing.Size(828, 36)
        $note.Text = 'A monitor may belong to both groups; unchecked in both means off on both sides. Disconnected saved members are ignored while the connected members continue toggling.'
        $form.Controls.Add($note)

        $errorLabel = New-Object System.Windows.Forms.Label
        $errorLabel.AutoSize = $false
        $errorLabel.ForeColor = [System.Drawing.Color]::Firebrick
        $errorLabel.Location = New-Object System.Drawing.Point(16, $errorTop)
        $errorLabel.Size = New-Object System.Drawing.Size(600, 34)
        $errorLabel.Text = ''
        $form.Controls.Add($errorLabel)

        $saveButton = New-Object System.Windows.Forms.Button
        $saveButton.Text = 'Save'
        $saveButton.Size = New-Object System.Drawing.Size(100, 30)
        $saveButton.Location = New-Object System.Drawing.Point(634, $buttonTop)
        $form.Controls.Add($saveButton)

        $cancelButton = New-Object System.Windows.Forms.Button
        $cancelButton.Text = 'Cancel'
        $cancelButton.Size = New-Object System.Drawing.Size(100, 30)
        $cancelButton.Location = New-Object System.Drawing.Point(744, $buttonTop)
        $form.Controls.Add($cancelButton)

        $form.AcceptButton = $saveButton
        $form.CancelButton = $cancelButton

        $saveButton.Add_Click({
            $group1 = @(Get-CheckedTokens -List $group1List -Monitors $Monitors)
            $group2 = @(Get-CheckedTokens -List $group2List -Monitors $Monitors)
            $validationError = Get-GroupValidationError -Group1 $group1 -Group2 $group2
            if (-not [string]::IsNullOrEmpty($validationError)) {
                $errorLabel.Text = $validationError
                return
            }

            $form.Tag = New-PickerResult -Cancelled $false -Group1 $group1 -Group2 $group2
            $form.Close()
        })

        $cancelButton.Add_Click({
            $form.Tag = New-PickerResult -Cancelled $true -Group1 @() -Group2 @()
            $form.Close()
        })

        $form.Add_FormClosing({
            param($sender, $eventArgs)

            if ($null -eq $sender.Tag) {
                $sender.Tag = New-PickerResult -Cancelled $true -Group1 @() -Group2 @()
            }
        })

        [void]$form.ShowDialog()
        if ($null -eq $form.Tag) {
            return New-PickerResult -Cancelled $true -Group1 @() -Group2 @()
        }
        return $form.Tag
    }
    finally {
        $form.Dispose()
    }
}

function Assert-ValidationCondition {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not $Condition) {
        throw "Toggle Monitors Picker validation failed: $Message"
    }
}

function Invoke-PickerContractValidation {
    $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('flowcell-toggle-monitors-picker-' + [guid]::NewGuid().ToString('N'))
    [void][System.IO.Directory]::CreateDirectory($temporaryRoot)
    try {
        $modelPath = Join-Path $temporaryRoot 'model.json'
        $resultPath = Join-Path $temporaryRoot 'result.json'
        $model = [pscustomobject][ordered]@{
            monitors = @(
                [pscustomobject][ordered]@{ label = 'Monitor One [main, active]'; token = 'tm1.alpha'; group1 = $true; group2 = $false },
                [pscustomobject][ordered]@{ label = 'Monitor Two [active]'; token = 'tm1.beta'; group1 = $true; group2 = $true },
                [pscustomobject][ordered]@{ label = 'Monitor Three [inactive]'; token = 'tm1.gamma'; group1 = $false; group2 = $true }
            )
        }
        [System.IO.File]::WriteAllText($modelPath, ($model | ConvertTo-Json -Depth 4), $script:Utf8NoBom)

        $monitors = @(Read-PickerModel -Path $modelPath)
        Assert-ValidationCondition -Condition ($monitors.Count -eq 3) -Message 'model monitor count changed'
        Assert-ValidationCondition -Condition ($monitors[1].group1 -and $monitors[1].group2) -Message 'overlapping membership was not preserved'

        $validError = Get-GroupValidationError -Group1 @('tm1.alpha', 'tm1.beta') -Group2 @('tm1.beta', 'tm1.gamma')
        Assert-ValidationCondition -Condition ([string]::IsNullOrEmpty($validError)) -Message 'valid overlapping groups were rejected'
        Assert-ValidationCondition -Condition (-not [string]::IsNullOrEmpty((Get-GroupValidationError -Group1 @() -Group2 @('tm1.beta')))) -Message 'empty Group 1 was accepted'
        Assert-ValidationCondition -Condition (-not [string]::IsNullOrEmpty((Get-GroupValidationError -Group1 @('tm1.alpha') -Group2 @()))) -Message 'empty Group 2 was accepted'
        Assert-ValidationCondition -Condition (-not [string]::IsNullOrEmpty((Get-GroupValidationError -Group1 @('tm1.alpha', 'tm1.beta') -Group2 @('tm1.beta', 'tm1.alpha')))) -Message 'equal groups were accepted'

        $saved = New-PickerResult -Cancelled $false -Group1 @('tm1.alpha', 'tm1.beta') -Group2 @('tm1.beta', 'tm1.gamma')
        Write-PickerResult -Path $resultPath -Result $saved
        $bytes = [System.IO.File]::ReadAllBytes($resultPath)
        $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
        Assert-ValidationCondition -Condition (-not $hasBom) -Message 'result JSON contains a UTF-8 BOM'
        $savedRoundTrip = [System.IO.File]::ReadAllText($resultPath) | ConvertFrom-Json
        Assert-ValidationCondition -Condition (-not [bool]$savedRoundTrip.cancelled) -Message 'saved result was marked cancelled'
        Assert-ValidationCondition -Condition (@($savedRoundTrip.group1).Count -eq 2) -Message 'saved Group 1 tokens changed'
        Assert-ValidationCondition -Condition (@($savedRoundTrip.group2).Count -eq 2) -Message 'saved Group 2 tokens changed'

        $cancelled = New-PickerResult -Cancelled $true -Group1 @() -Group2 @()
        Write-PickerResult -Path $resultPath -Result $cancelled
        $cancelledRoundTrip = [System.IO.File]::ReadAllText($resultPath) | ConvertFrom-Json
        Assert-ValidationCondition -Condition ([bool]$cancelledRoundTrip.cancelled) -Message 'cancel result was not marked cancelled'
        Assert-ValidationCondition -Condition (@($cancelledRoundTrip.group1).Count -eq 0 -and @($cancelledRoundTrip.group2).Count -eq 0) -Message 'cancel result retained monitor selections'
    }
    finally {
        if ([System.IO.Directory]::Exists($temporaryRoot)) {
            [System.IO.Directory]::Delete($temporaryRoot, $true)
        }
    }

    Write-Output 'FLOWCELL_TOGGLE_MONITORS_PICKER_VALIDATE_OK'
}

if ($ValidateOnly) {
    Invoke-PickerContractValidation
    return
}

if ([string]::IsNullOrWhiteSpace($ModelPath)) {
    throw 'ModelPath is required unless ValidateOnly is used.'
}
if ([string]::IsNullOrWhiteSpace($ResultPath)) {
    throw 'ResultPath is required unless ValidateOnly is used.'
}

$pickerMonitors = @(Read-PickerModel -Path $ModelPath)
$pickerResult = Show-MonitorGroupPicker -Monitors $pickerMonitors
Write-PickerResult -Path $ResultPath -Result $pickerResult
