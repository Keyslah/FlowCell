# Description: Setup Organization profiles.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-FlowCellRoot([string]$StartPath) {
    $currentPath = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($currentPath) -and (Test-Path -LiteralPath $currentPath -PathType Container)) {
        $summaryPath = Join-Path $currentPath 'PROGRAM_SUMMARY.txt'
        $flowCellPath = Join-Path $currentPath 'FlowCell'
        if ((Test-Path -LiteralPath $summaryPath -PathType Leaf) -and (Test-Path -LiteralPath $flowCellPath -PathType Container)) {
            return $currentPath
        }
        $parentPath = Split-Path -Parent $currentPath
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) { break }
        $currentPath = $parentPath
    }
    throw 'Could not locate the FlowCell repository root from this script location.'
}

$repoRoot = Find-FlowCellRoot -StartPath $PSScriptRoot
$corePath = Join-Path $repoRoot 'Programs\Windows\SupportScripts\Organization-ProfileCore.ps1'
if (-not (Test-Path -LiteralPath $corePath -PathType Leaf)) {
    throw "Organization profile core script not found: $corePath"
}
. $corePath

function Get-ClipboardFolderForSetup {
    try { $text = Get-Clipboard -Raw -ErrorAction Stop } catch { return '' }
    $candidate = ([string]$text).Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }
    if (Test-Path -LiteralPath $candidate -PathType Container) { return (Get-Item -LiteralPath $candidate).FullName }
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return (Split-Path -Parent (Get-Item -LiteralPath $candidate).FullName) }
    return ''
}

function Show-OrganizationSetupWindow {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'FlowCell Setup Organization'
    $form.StartPosition = 'CenterScreen'
    $form.Size = New-Object System.Drawing.Size(920, 620)
    $form.MinimumSize = New-Object System.Drawing.Size(820, 520)

    $labelProfile = New-Object System.Windows.Forms.Label
    $labelProfile.Text = 'Saved profiles'
    $labelProfile.Location = New-Object System.Drawing.Point(12, 14)
    $labelProfile.Size = New-Object System.Drawing.Size(100, 20)
    $form.Controls.Add($labelProfile)

    $comboProfiles = New-Object System.Windows.Forms.ComboBox
    $comboProfiles.DropDownStyle = 'DropDownList'
    $comboProfiles.Location = New-Object System.Drawing.Point(112, 10)
    $comboProfiles.Size = New-Object System.Drawing.Size(250, 24)
    $form.Controls.Add($comboProfiles)

    $buttonLoad = New-Object System.Windows.Forms.Button
    $buttonLoad.Text = 'Load'
    $buttonLoad.Location = New-Object System.Drawing.Point(372, 8)
    $buttonLoad.Size = New-Object System.Drawing.Size(70, 28)
    $form.Controls.Add($buttonLoad)

    $buttonNew = New-Object System.Windows.Forms.Button
    $buttonNew.Text = 'New'
    $buttonNew.Location = New-Object System.Drawing.Point(448, 8)
    $buttonNew.Size = New-Object System.Drawing.Size(70, 28)
    $form.Controls.Add($buttonNew)

    $labelProfileName = New-Object System.Windows.Forms.Label
    $labelProfileName.Text = 'Profile name'
    $labelProfileName.Location = New-Object System.Drawing.Point(12, 50)
    $labelProfileName.Size = New-Object System.Drawing.Size(100, 20)
    $form.Controls.Add($labelProfileName)

    $textProfileName = New-Object System.Windows.Forms.TextBox
    $textProfileName.Location = New-Object System.Drawing.Point(112, 46)
    $textProfileName.Size = New-Object System.Drawing.Size(250, 24)
    $form.Controls.Add($textProfileName)

    $labelProfileId = New-Object System.Windows.Forms.Label
    $labelProfileId.Text = 'Profile ID'
    $labelProfileId.Location = New-Object System.Drawing.Point(382, 50)
    $labelProfileId.Size = New-Object System.Drawing.Size(70, 20)
    $form.Controls.Add($labelProfileId)

    $textProfileId = New-Object System.Windows.Forms.TextBox
    $textProfileId.Location = New-Object System.Drawing.Point(454, 46)
    $textProfileId.Size = New-Object System.Drawing.Size(180, 24)
    $form.Controls.Add($textProfileId)

    $labelRoot = New-Object System.Windows.Forms.Label
    $labelRoot.Text = 'Project root'
    $labelRoot.Location = New-Object System.Drawing.Point(12, 84)
    $labelRoot.Size = New-Object System.Drawing.Size(100, 20)
    $form.Controls.Add($labelRoot)

    $textRoot = New-Object System.Windows.Forms.TextBox
    $textRoot.Location = New-Object System.Drawing.Point(112, 80)
    $textRoot.Size = New-Object System.Drawing.Size(610, 24)
    $form.Controls.Add($textRoot)

    $buttonBrowse = New-Object System.Windows.Forms.Button
    $buttonBrowse.Text = 'Browse'
    $buttonBrowse.Location = New-Object System.Drawing.Point(732, 78)
    $buttonBrowse.Size = New-Object System.Drawing.Size(75, 28)
    $form.Controls.Add($buttonBrowse)

    $buttonScan = New-Object System.Windows.Forms.Button
    $buttonScan.Text = 'Scan'
    $buttonScan.Location = New-Object System.Drawing.Point(812, 78)
    $buttonScan.Size = New-Object System.Drawing.Size(75, 28)
    $form.Controls.Add($buttonScan)

    $labelFolders = New-Object System.Windows.Forms.Label
    $labelFolders.Text = 'Folders in root'
    $labelFolders.Location = New-Object System.Drawing.Point(12, 120)
    $labelFolders.Size = New-Object System.Drawing.Size(150, 20)
    $form.Controls.Add($labelFolders)

    $listFolders = New-Object System.Windows.Forms.ListBox
    $listFolders.Location = New-Object System.Drawing.Point(12, 145)
    $listFolders.Size = New-Object System.Drawing.Size(260, 360)
    $form.Controls.Add($listFolders)

    $buttonAssignFolder = New-Object System.Windows.Forms.Button
    $buttonAssignFolder.Text = 'Assign selected folder to selected role'
    $buttonAssignFolder.Location = New-Object System.Drawing.Point(12, 514)
    $buttonAssignFolder.Size = New-Object System.Drawing.Size(260, 28)
    $form.Controls.Add($buttonAssignFolder)

    $labelRoles = New-Object System.Windows.Forms.Label
    $labelRoles.Text = 'Roles'
    $labelRoles.Location = New-Object System.Drawing.Point(290, 120)
    $labelRoles.Size = New-Object System.Drawing.Size(160, 20)
    $form.Controls.Add($labelRoles)

    $gridRoles = New-Object System.Windows.Forms.DataGridView
    $gridRoles.Location = New-Object System.Drawing.Point(290, 145)
    $gridRoles.Size = New-Object System.Drawing.Size(595, 360)
    $gridRoles.AllowUserToAddRows = $false
    $gridRoles.AllowUserToDeleteRows = $false
    $gridRoles.SelectionMode = 'FullRowSelect'
    $gridRoles.MultiSelect = $false
    $gridRoles.AutoSizeColumnsMode = 'Fill'
    $gridRoles.RowHeadersVisible = $false
    $null = $gridRoles.Columns.Add('roleId', 'Role ID')
    $null = $gridRoles.Columns.Add('label', 'Label')
    $null = $gridRoles.Columns.Add('extensions', 'File types')
    $null = $gridRoles.Columns.Add('folder', 'Folder')
    $gridRoles.Columns[0].FillWeight = 22
    $gridRoles.Columns[1].FillWeight = 24
    $gridRoles.Columns[2].FillWeight = 18
    $gridRoles.Columns[3].FillWeight = 36
    $form.Controls.Add($gridRoles)

    $buttonAddRole = New-Object System.Windows.Forms.Button
    $buttonAddRole.Text = 'Add Role'
    $buttonAddRole.Location = New-Object System.Drawing.Point(290, 514)
    $buttonAddRole.Size = New-Object System.Drawing.Size(90, 28)
    $form.Controls.Add($buttonAddRole)

    $buttonRemoveRole = New-Object System.Windows.Forms.Button
    $buttonRemoveRole.Text = 'Remove Role'
    $buttonRemoveRole.Location = New-Object System.Drawing.Point(388, 514)
    $buttonRemoveRole.Size = New-Object System.Drawing.Size(100, 28)
    $form.Controls.Add($buttonRemoveRole)

    $buttonSave = New-Object System.Windows.Forms.Button
    $buttonSave.Text = 'Save Profile'
    $buttonSave.Location = New-Object System.Drawing.Point(600, 514)
    $buttonSave.Size = New-Object System.Drawing.Size(110, 28)
    $form.Controls.Add($buttonSave)

    $buttonSaveActive = New-Object System.Windows.Forms.Button
    $buttonSaveActive.Text = 'Save + Active'
    $buttonSaveActive.Location = New-Object System.Drawing.Point(720, 514)
    $buttonSaveActive.Size = New-Object System.Drawing.Size(120, 28)
    $form.Controls.Add($buttonSaveActive)

    $labelStatus = New-Object System.Windows.Forms.Label
    $labelStatus.Text = ''
    $labelStatus.Location = New-Object System.Drawing.Point(12, 550)
    $labelStatus.Size = New-Object System.Drawing.Size(870, 24)
    $form.Controls.Add($labelStatus)

    $profileIndex = @{}

    function Refresh-ProfileList {
        $comboProfiles.Items.Clear()
        $profileIndex.Clear()
        foreach ($profile in (Get-OrganizationProfiles)) {
            $id = [string]$profile.profileId
            $name = [string]$profile.profileName
            if ([string]::IsNullOrWhiteSpace($name)) { $name = $id }
            $display = '{0}  -  {1}' -f $id, $name
            $profileIndex[$display] = $id
            $null = $comboProfiles.Items.Add($display)
        }
        $activeId = Get-ActiveOrganizationProfileId
        if (-not [string]::IsNullOrWhiteSpace($activeId)) {
            foreach ($item in $comboProfiles.Items) {
                if ($profileIndex[[string]$item] -eq $activeId) {
                    $comboProfiles.SelectedItem = $item
                    break
                }
            }
        }
    }

    function Load-FolderList {
        $listFolders.Items.Clear()
        $root = $textRoot.Text.Trim().Trim('"')
        if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) {
            $labelStatus.Text = 'Pick a valid project root first.'
            return
        }
        $rootItem = '.'
        $null = $listFolders.Items.Add($rootItem)
        $folders = Get-ChildItem -LiteralPath $root -Directory -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object FullName
        foreach ($folder in $folders) {
            $relative = Get-OrganizationRelativePath -FullPath $folder.FullName -RootPath $root
            $null = $listFolders.Items.Add($relative)
        }
        $labelStatus.Text = ('Scanned {0} folder(s).' -f $listFolders.Items.Count)
    }

    function Clear-FormForNewProfile {
        $textProfileName.Text = ''
        $textProfileId.Text = ''
        $textRoot.Text = Get-ClipboardFolderForSetup
        $gridRoles.Rows.Clear()
        $listFolders.Items.Clear()
        $labelStatus.Text = 'New organization profile.'
        if (-not [string]::IsNullOrWhiteSpace($textRoot.Text)) { Load-FolderList }
    }

    function Load-ProfileIntoForm([object]$profile) {
        $textProfileName.Text = [string]$profile.profileName
        $textProfileId.Text = [string]$profile.profileId
        $textRoot.Text = [string]$profile.rootPath
        $gridRoles.Rows.Clear()
        foreach ($role in @($profile.roles)) {
            $extensionsText = (@($role.extensions) -join ' ')
            $null = $gridRoles.Rows.Add([string]$role.roleId, [string]$role.label, $extensionsText, [string]$role.folder)
        }
        Load-FolderList
        $labelStatus.Text = ('Loaded profile: {0}' -f [string]$profile.profileId)
    }

    function Collect-RoleRows {
        $roles = New-Object System.Collections.Generic.List[object]
        foreach ($row in $gridRoles.Rows) {
            if ($row.IsNewRow) { continue }
            $roleId = [string]$row.Cells[0].Value
            $label = [string]$row.Cells[1].Value
            $extensionsText = [string]$row.Cells[2].Value
            $folder = [string]$row.Cells[3].Value
            if ([string]::IsNullOrWhiteSpace($roleId) -and [string]::IsNullOrWhiteSpace($extensionsText) -and [string]::IsNullOrWhiteSpace($folder)) {
                continue
            }
            $normalizedRoleId = ConvertTo-OrganizationRoleId -Value $roleId
            if ([string]::IsNullOrWhiteSpace($label)) { $label = $normalizedRoleId }
            $extensions = @(Split-OrganizationExtensions -Value $extensionsText)
            if ($extensions.Count -eq 0) {
                throw "Role '$normalizedRoleId' needs at least one file type."
            }
            if ([string]::IsNullOrWhiteSpace($folder)) { $folder = '.' }
            $roles.Add([PSCustomObject][ordered]@{
                roleId     = $normalizedRoleId
                label      = $label.Trim()
                extensions = @($extensions)
                folder     = $folder.Trim()
            }) | Out-Null
        }
        if ($roles.Count -eq 0) {
            throw 'Add at least one role before saving.'
        }
        return @($roles)
    }

    function Save-ProfileFromForm([bool]$setActive) {
        $name = $textProfileName.Text.Trim()
        $id = $textProfileId.Text.Trim()
        $root = $textRoot.Text.Trim().Trim('"')
        if ([string]::IsNullOrWhiteSpace($name)) { throw 'Profile name cannot be empty.' }
        if ([string]::IsNullOrWhiteSpace($id)) { $id = ConvertTo-OrganizationProfileId -Value $name }
        else { $id = ConvertTo-OrganizationProfileId -Value $id }
        if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) {
            throw 'Project root must be an existing folder.'
        }
        $roles = @(Collect-RoleRows)
        $profile = [PSCustomObject][ordered]@{
            format      = 'flowcell-organization-profile-v1'
            profileId   = $id
            profileName = $name
            rootPath    = (Get-Item -LiteralPath $root).FullName
            roles       = @($roles)
            createdAt   = (Get-Date).ToString('o')
            updatedAt   = (Get-Date).ToString('o')
        }
        $savedPath = Save-OrganizationProfileDocument -Profile $profile -SetActive:($setActive)
        $textProfileId.Text = $id
        Refresh-ProfileList
        $message = if ($setActive) { "Saved and activated profile '$id'." } else { "Saved profile '$id'." }
        $labelStatus.Text = $message
        Write-FlowCellStatus ($message + [Environment]::NewLine + 'Profile: ' + $savedPath)
    }

    $buttonBrowse.Add_Click({
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = 'Choose project root folder'
        if ((Test-Path -LiteralPath $textRoot.Text -PathType Container)) {
            $dialog.SelectedPath = $textRoot.Text
        }
        if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
            $textRoot.Text = $dialog.SelectedPath
            Load-FolderList
        }
    })

    $buttonScan.Add_Click({ Load-FolderList })

    $buttonAssignFolder.Add_Click({
        if ($gridRoles.CurrentCell -eq $null -or $listFolders.SelectedItem -eq $null) {
            $labelStatus.Text = 'Select one role row and one folder first.'
            return
        }
        $rowIndex = $gridRoles.CurrentCell.RowIndex
        if ($rowIndex -lt 0 -or $rowIndex -ge $gridRoles.Rows.Count) { return }
        $gridRoles.Rows[$rowIndex].Cells[3].Value = [string]$listFolders.SelectedItem
    })

    $buttonAddRole.Add_Click({
        $index = $gridRoles.Rows.Count + 1
        $null = $gridRoles.Rows.Add(('role_{0}' -f $index), ('Role {0}' -f $index), '.ext', '.')
    })

    $buttonRemoveRole.Add_Click({
        if ($gridRoles.CurrentCell -eq $null) { return }
        $rowIndex = $gridRoles.CurrentCell.RowIndex
        if ($rowIndex -ge 0 -and $rowIndex -lt $gridRoles.Rows.Count) {
            $gridRoles.Rows.RemoveAt($rowIndex)
        }
    })

    $buttonLoad.Add_Click({
        try {
            if ($comboProfiles.SelectedItem -eq $null) { throw 'Pick a saved profile first.' }
            $profileId = $profileIndex[[string]$comboProfiles.SelectedItem]
            $profile = Read-OrganizationProfile -ProfileId $profileId
            Load-ProfileIntoForm -profile $profile
        }
        catch {
            $labelStatus.Text = $_.Exception.Message
            Write-FlowCellStatus $_.Exception.Message
        }
    })

    $buttonNew.Add_Click({ Clear-FormForNewProfile })

    $buttonSave.Add_Click({
        try { Save-ProfileFromForm -setActive $false }
        catch {
            $labelStatus.Text = $_.Exception.Message
            Write-FlowCellStatus $_.Exception.Message
        }
    })

    $buttonSaveActive.Add_Click({
        try { Save-ProfileFromForm -setActive $true }
        catch {
            $labelStatus.Text = $_.Exception.Message
            Write-FlowCellStatus $_.Exception.Message
        }
    })

    Refresh-ProfileList
    $activeId = Get-ActiveOrganizationProfileId
    if (-not [string]::IsNullOrWhiteSpace($activeId)) {
        try { Load-ProfileIntoForm -profile (Read-OrganizationProfile -ProfileId $activeId) } catch { Clear-FormForNewProfile }
    }
    else {
        Clear-FormForNewProfile
    }

    [void]$form.ShowDialog()
}

try {
    Show-OrganizationSetupWindow
    exit 0
}
catch {
    Write-FlowCellStatus $_.Exception.Message
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Setup Organization failed', 'OK', 'Error') | Out-Null
    exit 1
}
