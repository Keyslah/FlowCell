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

function Get-OrganizationProgramRoles {
    return @(
        [PSCustomObject][ordered]@{ Name = 'Blender'; Extensions = @('.blend'); ProgramFolder = 'Blender' },
        [PSCustomObject][ordered]@{ Name = 'Illustrator'; Extensions = @('.ai', '.ait'); ProgramFolder = 'Illustrator' },
        [PSCustomObject][ordered]@{ Name = 'Photoshop'; Extensions = @('.psd', '.psb'); ProgramFolder = 'Photoshop' },
        [PSCustomObject][ordered]@{ Name = 'Fusion 360'; Extensions = @('.f3d', '.f3z'); ProgramFolder = 'Fusion 360' },
        [PSCustomObject][ordered]@{ Name = 'InDesign'; Extensions = @('.indd', '.indt'); ProgramFolder = 'InDesign' },
        [PSCustomObject][ordered]@{ Name = 'Premiere Pro'; Extensions = @('.prproj'); ProgramFolder = 'Premiere Pro' },
        [PSCustomObject][ordered]@{ Name = 'After Effects'; Extensions = @('.aep', '.aepx'); ProgramFolder = 'After Effects' },
        [PSCustomObject][ordered]@{ Name = 'Adobe Animate'; Extensions = @('.fla', '.xfl'); ProgramFolder = 'Adobe Animate' },
        [PSCustomObject][ordered]@{ Name = 'Adobe XD'; Extensions = @('.xd'); ProgramFolder = 'Adobe XD' },
        [PSCustomObject][ordered]@{ Name = 'Affinity Designer'; Extensions = @('.afdesign'); ProgramFolder = 'Affinity Designer' },
        [PSCustomObject][ordered]@{ Name = 'Affinity Photo'; Extensions = @('.afphoto'); ProgramFolder = 'Affinity Photo' },
        [PSCustomObject][ordered]@{ Name = 'Affinity Publisher'; Extensions = @('.afpub'); ProgramFolder = 'Affinity Publisher' },
        [PSCustomObject][ordered]@{ Name = 'Cinema 4D'; Extensions = @('.c4d'); ProgramFolder = 'Cinema 4D' },
        [PSCustomObject][ordered]@{ Name = 'Krita'; Extensions = @('.kra'); ProgramFolder = 'Krita' },
        [PSCustomObject][ordered]@{ Name = 'Clip Studio Paint'; Extensions = @('.clip'); ProgramFolder = 'Clip Studio Paint' },
        [PSCustomObject][ordered]@{ Name = 'SketchUp'; Extensions = @('.skp'); ProgramFolder = 'SketchUp' },
        [PSCustomObject][ordered]@{ Name = 'Rhino'; Extensions = @('.3dm'); ProgramFolder = 'Rhino' },
        [PSCustomObject][ordered]@{ Name = 'ZBrush'; Extensions = @('.ztl', '.zpr'); ProgramFolder = 'ZBrush' },
        [PSCustomObject][ordered]@{ Name = 'Substance Painter'; Extensions = @('.spp'); ProgramFolder = 'Substance Painter' },
        [PSCustomObject][ordered]@{ Name = 'Substance Designer'; Extensions = @('.sbs'); ProgramFolder = 'Substance Designer' },
        [PSCustomObject][ordered]@{ Name = 'DaVinci Resolve'; Extensions = @('.drp'); ProgramFolder = 'DaVinci Resolve' }
    )
}

function Show-OrganizationSetupWindow {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $script:Assignments = New-Object System.Collections.Generic.List[object]
    $script:ProfileIndex = @{}
    $script:CurrentProfileId = ''
    $script:IsRefreshingUi = $false

    $programRoles = @(Get-OrganizationProgramRoles)
    $programStructure = @('Live', 'Snapshots', 'Archive', 'Trash')

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'FlowCell Setup Organization'
    $form.StartPosition = 'CenterScreen'
    $form.Size = New-Object System.Drawing.Size(980, 680)
    $form.MinimumSize = New-Object System.Drawing.Size(900, 600)

    $labelProfile = New-Object System.Windows.Forms.Label
    $labelProfile.Text = 'Saved profile'
    $labelProfile.Location = New-Object System.Drawing.Point(12, 14)
    $labelProfile.Size = New-Object System.Drawing.Size(90, 20)
    $form.Controls.Add($labelProfile)

    $comboProfiles = New-Object System.Windows.Forms.ComboBox
    $comboProfiles.DropDownStyle = 'DropDownList'
    $comboProfiles.Location = New-Object System.Drawing.Point(105, 10)
    $comboProfiles.Size = New-Object System.Drawing.Size(240, 24)
    $form.Controls.Add($comboProfiles)

    $buttonLoad = New-Object System.Windows.Forms.Button
    $buttonLoad.Text = 'Load'
    $buttonLoad.Location = New-Object System.Drawing.Point(352, 8)
    $buttonLoad.Size = New-Object System.Drawing.Size(70, 28)
    $form.Controls.Add($buttonLoad)

    $buttonNew = New-Object System.Windows.Forms.Button
    $buttonNew.Text = 'New'
    $buttonNew.Location = New-Object System.Drawing.Point(428, 8)
    $buttonNew.Size = New-Object System.Drawing.Size(70, 28)
    $form.Controls.Add($buttonNew)

    $labelProfileName = New-Object System.Windows.Forms.Label
    $labelProfileName.Text = 'Profile name'
    $labelProfileName.Location = New-Object System.Drawing.Point(515, 14)
    $labelProfileName.Size = New-Object System.Drawing.Size(90, 20)
    $form.Controls.Add($labelProfileName)

    $textProfileName = New-Object System.Windows.Forms.TextBox
    $textProfileName.Location = New-Object System.Drawing.Point(608, 10)
    $textProfileName.Size = New-Object System.Drawing.Size(210, 24)
    $form.Controls.Add($textProfileName)

    $buttonSave = New-Object System.Windows.Forms.Button
    $buttonSave.Text = 'Save'
    $buttonSave.Location = New-Object System.Drawing.Point(826, 8)
    $buttonSave.Size = New-Object System.Drawing.Size(60, 28)
    $form.Controls.Add($buttonSave)

    $buttonSaveActive = New-Object System.Windows.Forms.Button
    $buttonSaveActive.Text = 'Save + Active'
    $buttonSaveActive.Location = New-Object System.Drawing.Point(892, 8)
    $buttonSaveActive.Size = New-Object System.Drawing.Size(78, 28)
    $form.Controls.Add($buttonSaveActive)

    $labelRoot = New-Object System.Windows.Forms.Label
    $labelRoot.Text = 'Project root'
    $labelRoot.Location = New-Object System.Drawing.Point(12, 50)
    $labelRoot.Size = New-Object System.Drawing.Size(90, 20)
    $form.Controls.Add($labelRoot)

    $textRoot = New-Object System.Windows.Forms.TextBox
    $textRoot.Location = New-Object System.Drawing.Point(105, 46)
    $textRoot.Size = New-Object System.Drawing.Size(560, 24)
    $form.Controls.Add($textRoot)

    $buttonBrowse = New-Object System.Windows.Forms.Button
    $buttonBrowse.Text = 'Browse'
    $buttonBrowse.Location = New-Object System.Drawing.Point(672, 44)
    $buttonBrowse.Size = New-Object System.Drawing.Size(75, 28)
    $form.Controls.Add($buttonBrowse)

    $buttonScan = New-Object System.Windows.Forms.Button
    $buttonScan.Text = 'Scan'
    $buttonScan.Location = New-Object System.Drawing.Point(753, 44)
    $buttonScan.Size = New-Object System.Drawing.Size(65, 28)
    $form.Controls.Add($buttonScan)

    $buttonAutoPrograms = New-Object System.Windows.Forms.Button
    $buttonAutoPrograms.Text = 'Create detected program folders'
    $buttonAutoPrograms.Location = New-Object System.Drawing.Point(826, 44)
    $buttonAutoPrograms.Size = New-Object System.Drawing.Size(144, 28)
    $form.Controls.Add($buttonAutoPrograms)

    $labelActive = New-Object System.Windows.Forms.Label
    $labelActive.Text = 'Active profile: none'
    $labelActive.Location = New-Object System.Drawing.Point(12, 80)
    $labelActive.Size = New-Object System.Drawing.Size(958, 20)
    $form.Controls.Add($labelActive)

    $labelFolders = New-Object System.Windows.Forms.Label
    $labelFolders.Text = 'Folders'
    $labelFolders.Location = New-Object System.Drawing.Point(12, 110)
    $labelFolders.Size = New-Object System.Drawing.Size(150, 20)
    $form.Controls.Add($labelFolders)

    $treeFolders = New-Object System.Windows.Forms.TreeView
    $treeFolders.Location = New-Object System.Drawing.Point(12, 135)
    $treeFolders.Size = New-Object System.Drawing.Size(310, 450)
    $treeFolders.HideSelection = $false
    $form.Controls.Add($treeFolders)

    $labelSelectedFolder = New-Object System.Windows.Forms.Label
    $labelSelectedFolder.Text = 'Selected folder: none'
    $labelSelectedFolder.Location = New-Object System.Drawing.Point(340, 110)
    $labelSelectedFolder.Size = New-Object System.Drawing.Size(610, 20)
    $form.Controls.Add($labelSelectedFolder)

    $labelAddRole = New-Object System.Windows.Forms.Label
    $labelAddRole.Text = 'Add role'
    $labelAddRole.Location = New-Object System.Drawing.Point(340, 145)
    $labelAddRole.Size = New-Object System.Drawing.Size(100, 20)
    $form.Controls.Add($labelAddRole)

    $comboAddRole = New-Object System.Windows.Forms.ComboBox
    $comboAddRole.DropDownStyle = 'DropDownList'
    $comboAddRole.Location = New-Object System.Drawing.Point(445, 141)
    $comboAddRole.Size = New-Object System.Drawing.Size(310, 24)
    $form.Controls.Add($comboAddRole)

    $roleDisplayIndex = @{}
    foreach ($role in $programRoles) {
        $display = ('{0}    {1}' -f [string]$role.Name, (@($role.Extensions) -join ' '))
        $roleDisplayIndex[$display] = $role
        $null = $comboAddRole.Items.Add($display)
    }

    $labelCustom = New-Object System.Windows.Forms.Label
    $labelCustom.Text = 'File types'
    $labelCustom.Location = New-Object System.Drawing.Point(340, 183)
    $labelCustom.Size = New-Object System.Drawing.Size(100, 20)
    $form.Controls.Add($labelCustom)

    $textCustomExtensions = New-Object System.Windows.Forms.TextBox
    $textCustomExtensions.Location = New-Object System.Drawing.Point(445, 179)
    $textCustomExtensions.Size = New-Object System.Drawing.Size(310, 24)
    $form.Controls.Add($textCustomExtensions)

    $buttonAddCustom = New-Object System.Windows.Forms.Button
    $buttonAddCustom.Text = 'Add File Types'
    $buttonAddCustom.Location = New-Object System.Drawing.Point(765, 177)
    $buttonAddCustom.Size = New-Object System.Drawing.Size(110, 28)
    $form.Controls.Add($buttonAddCustom)

    $labelAssignedCount = New-Object System.Windows.Forms.Label
    $labelAssignedCount.Text = '0 roles assigned'
    $labelAssignedCount.Location = New-Object System.Drawing.Point(340, 220)
    $labelAssignedCount.Size = New-Object System.Drawing.Size(250, 20)
    $form.Controls.Add($labelAssignedCount)

    $gridAssignments = New-Object System.Windows.Forms.DataGridView
    $gridAssignments.Location = New-Object System.Drawing.Point(340, 245)
    $gridAssignments.Size = New-Object System.Drawing.Size(610, 340)
    $gridAssignments.AllowUserToAddRows = $false
    $gridAssignments.AllowUserToDeleteRows = $false
    $gridAssignments.AllowUserToResizeRows = $false
    $gridAssignments.SelectionMode = 'FullRowSelect'
    $gridAssignments.MultiSelect = $false
    $gridAssignments.RowHeadersVisible = $false
    $gridAssignments.AutoSizeColumnsMode = 'Fill'
    $gridAssignments.ReadOnly = $true
    $null = $gridAssignments.Columns.Add('role', 'Role')
    $null = $gridAssignments.Columns.Add('extensions', 'File types')
    $removeColumn = New-Object System.Windows.Forms.DataGridViewButtonColumn
    $removeColumn.Name = 'remove'
    $removeColumn.HeaderText = ''
    $removeColumn.Text = 'X'
    $removeColumn.UseColumnTextForButtonValue = $true
    $null = $gridAssignments.Columns.Add($removeColumn)
    $gridAssignments.Columns['role'].FillWeight = 38
    $gridAssignments.Columns['extensions'].FillWeight = 52
    $gridAssignments.Columns['remove'].FillWeight = 10
    $form.Controls.Add($gridAssignments)

    $labelStatus = New-Object System.Windows.Forms.Label
    $labelStatus.Text = ''
    $labelStatus.Location = New-Object System.Drawing.Point(12, 602)
    $labelStatus.Size = New-Object System.Drawing.Size(940, 34)
    $form.Controls.Add($labelStatus)

    function Set-Status([string]$Message) {
        $labelStatus.Text = $Message
    }

    function Get-SelectedFolderRelative {
        if ($treeFolders.SelectedNode -eq $null) {
            throw 'Select a folder first.'
        }
        return [string]$treeFolders.SelectedNode.Tag
    }

    function Add-FolderNodes {
        param(
            [Parameter(Mandatory = $true)][System.Windows.Forms.TreeNode]$ParentNode,
            [Parameter(Mandatory = $true)][string]$FolderPath,
            [Parameter(Mandatory = $true)][string]$RootPath
        )
        $children = Get-ChildItem -LiteralPath $FolderPath -Directory -Force -ErrorAction SilentlyContinue | Sort-Object Name
        foreach ($child in $children) {
            $node = New-Object System.Windows.Forms.TreeNode
            $node.Text = $child.Name
            $node.Tag = Get-OrganizationRelativePath -FullPath $child.FullName -RootPath $RootPath
            $ParentNode.Nodes.Add($node) | Out-Null
            Add-FolderNodes -ParentNode $node -FolderPath $child.FullName -RootPath $RootPath
        }
    }

    function Find-FolderNode {
        param(
            [Parameter(Mandatory = $true)][System.Windows.Forms.TreeNodeCollection]$Nodes,
            [Parameter(Mandatory = $true)][string]$RelativeFolder
        )
        foreach ($node in $Nodes) {
            if ([string]$node.Tag -eq $RelativeFolder) { return $node }
            $found = Find-FolderNode -Nodes $node.Nodes -RelativeFolder $RelativeFolder
            if ($found -ne $null) { return $found }
        }
        return $null
    }

    function Select-FolderInTree([string]$RelativeFolder) {
        $node = Find-FolderNode -Nodes $treeFolders.Nodes -RelativeFolder $RelativeFolder
        if ($node -ne $null) {
            $treeFolders.SelectedNode = $node
            $node.EnsureVisible()
        }
    }

    function Load-FolderTree {
        $treeFolders.BeginUpdate()
        try {
            $treeFolders.Nodes.Clear()
            $root = $textRoot.Text.Trim().Trim('"')
            if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) {
                Set-Status 'Pick a valid project root first.'
                return
            }

            $rootItem = Get-Item -LiteralPath $root
            $rootNode = New-Object System.Windows.Forms.TreeNode
            $rootNode.Text = ('[root] {0}' -f $rootItem.Name)
            $rootNode.Tag = '.'
            $treeFolders.Nodes.Add($rootNode) | Out-Null
            Add-FolderNodes -ParentNode $rootNode -FolderPath $rootItem.FullName -RootPath $rootItem.FullName
            $rootNode.Expand()
            $treeFolders.SelectedNode = $rootNode
            Set-Status ('Scanned folder tree.')
        }
        finally {
            $treeFolders.EndUpdate()
        }
    }

    function Refresh-ActiveProfileLabel {
        $activeId = Get-ActiveOrganizationProfileId
        if ([string]::IsNullOrWhiteSpace($activeId)) {
            $labelActive.Text = 'Active profile: none'
            return
        }
        try {
            $activeProfile = Read-OrganizationProfile -ProfileId $activeId
            $activeName = [string]$activeProfile.profileName
            if ([string]::IsNullOrWhiteSpace($activeName)) { $activeName = $activeId }
            $labelActive.Text = ('Active profile: {0}' -f $activeName)
        }
        catch {
            $labelActive.Text = ('Active profile: {0}' -f $activeId)
        }
    }

    function Refresh-ProfileList {
        $script:IsRefreshingUi = $true
        try {
            $comboProfiles.Items.Clear()
            $script:ProfileIndex = @{}
            $activeId = Get-ActiveOrganizationProfileId
            foreach ($profile in (Get-OrganizationProfiles)) {
                $id = [string]$profile.profileId
                $name = [string]$profile.profileName
                if ([string]::IsNullOrWhiteSpace($name)) { $name = $id }
                $display = $name
                if (-not [string]::IsNullOrWhiteSpace($activeId) -and $id -eq $activeId) {
                    $display = '{0}  [active]' -f $name
                }
                if ($script:ProfileIndex.ContainsKey($display)) {
                    $display = '{0}  ({1})' -f $display, $id
                }
                $script:ProfileIndex[$display] = $id
                $null = $comboProfiles.Items.Add($display)
                if ($id -eq $activeId) {
                    $comboProfiles.SelectedItem = $display
                }
            }
            Refresh-ActiveProfileLabel
        }
        finally {
            $script:IsRefreshingUi = $false
        }
    }

    function Refresh-SelectedFolderPanel {
        if ($treeFolders.SelectedNode -eq $null) {
            $labelSelectedFolder.Text = 'Selected folder: none'
            $labelAssignedCount.Text = '0 roles assigned'
            $gridAssignments.Rows.Clear()
            return
        }

        $folder = [string]$treeFolders.SelectedNode.Tag
        $labelSelectedFolder.Text = ('Selected folder: {0}' -f $folder)
        $gridAssignments.Rows.Clear()

        $rows = @($script:Assignments | Where-Object { [string]$_.Folder -eq $folder })
        foreach ($assignment in $rows) {
            $rowIndex = $gridAssignments.Rows.Add([string]$assignment.RoleName, (@($assignment.Extensions) -join ' '), 'X')
            $gridAssignments.Rows[$rowIndex].Tag = $assignment
        }

        $labelAssignedCount.Text = ('{0} role(s) assigned' -f $rows.Count)
    }

    function Add-AssignmentToFolder {
        param(
            [Parameter(Mandatory = $true)][string]$Folder,
            [Parameter(Mandatory = $true)][string]$RoleName,
            [Parameter(Mandatory = $true)][string[]]$Extensions,
            [string]$Source = 'role',
            [switch]$SkipDuplicateMessage
        )

        $normalized = @(($Extensions | ForEach-Object { Normalize-OrganizationExtension -Value ([string]$_) }) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($normalized.Count -eq 0) {
            throw 'Add at least one file type.'
        }

        foreach ($extension in $normalized) {
            foreach ($assignment in @($script:Assignments)) {
                if (@($assignment.Extensions) -contains $extension) {
                    if ([string]$assignment.Folder -eq $Folder) {
                        if (-not $SkipDuplicateMessage) {
                            Set-Status ('{0} is already assigned to this folder.' -f $extension)
                        }
                        return $false
                    }
                    throw ('{0} is already assigned to {1}. Remove that assignment first.' -f $extension, [string]$assignment.Folder)
                }
            }
        }

        $script:Assignments.Add([PSCustomObject][ordered]@{
            RoleName   = $RoleName.Trim()
            Extensions = @($normalized)
            Folder     = $Folder.Trim()
            Source     = $Source
        }) | Out-Null
        Refresh-SelectedFolderPanel
        return $true
    }

    function Remove-AssignmentObject([object]$Assignment) {
        if ($Assignment -eq $null) { return }
        $script:Assignments.Remove($Assignment) | Out-Null
        Refresh-SelectedFolderPanel
        Set-Status 'Removed assignment.'
    }

    function Get-DefaultProfileName([string]$RootPath) {
        if ([string]::IsNullOrWhiteSpace($RootPath) -or -not (Test-Path -LiteralPath $RootPath -PathType Container)) {
            return 'Organization Profile'
        }
        $name = Split-Path -Leaf (Get-Item -LiteralPath $RootPath).FullName
        if ([string]::IsNullOrWhiteSpace($name)) { return 'Organization Profile' }
        return $name
    }

    function Clear-FormForNewProfile {
        $script:CurrentProfileId = ''
        $script:Assignments.Clear()
        $textRoot.Text = Get-ClipboardFolderForSetup
        $textProfileName.Text = Get-DefaultProfileName -RootPath $textRoot.Text
        $treeFolders.Nodes.Clear()
        if (-not [string]::IsNullOrWhiteSpace($textRoot.Text)) { Load-FolderTree }
        Refresh-SelectedFolderPanel
        Set-Status 'New organization profile.'
    }

    function Load-ProfileIntoForm([object]$Profile) {
        $script:CurrentProfileId = [string]$Profile.profileId
        $textProfileName.Text = [string]$Profile.profileName
        $textRoot.Text = [string]$Profile.rootPath
        $script:Assignments.Clear()

        foreach ($role in @($Profile.roles)) {
            $roleName = [string]$role.label
            if ([string]::IsNullOrWhiteSpace($roleName)) { $roleName = [string]$role.roleId }
            $folder = [string]$role.folder
            if ([string]::IsNullOrWhiteSpace($folder)) { $folder = '.' }
            $script:Assignments.Add([PSCustomObject][ordered]@{
                RoleName   = $roleName
                Extensions = @($role.extensions | ForEach-Object { Normalize-OrganizationExtension -Value ([string]$_) } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                Folder     = $folder
                Source     = 'loaded'
            }) | Out-Null
        }

        Load-FolderTree
        Refresh-SelectedFolderPanel
        Set-Status ('Loaded profile: {0}' -f [string]$Profile.profileName)
    }

    function Collect-AssignmentsAsRoles {
        if ($script:Assignments.Count -eq 0) {
            throw 'Add at least one role or file type assignment before saving.'
        }

        $roles = New-Object System.Collections.Generic.List[object]
        $usedRoleIds = @{}

        foreach ($assignment in @($script:Assignments)) {
            $roleName = [string]$assignment.RoleName
            if ([string]::IsNullOrWhiteSpace($roleName)) { $roleName = 'Custom File Types' }
            $baseRoleId = ConvertTo-OrganizationRoleId -Value $roleName
            $roleId = $baseRoleId
            $suffix = 2
            while ($usedRoleIds.ContainsKey($roleId)) {
                $roleId = '{0}_{1}' -f $baseRoleId, $suffix
                $suffix++
            }
            $usedRoleIds[$roleId] = $true

            $extensions = @($assignment.Extensions | ForEach-Object { Normalize-OrganizationExtension -Value ([string]$_) } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
            if ($extensions.Count -eq 0) { continue }

            $folder = [string]$assignment.Folder
            if ([string]::IsNullOrWhiteSpace($folder)) { $folder = '.' }

            $roles.Add([PSCustomObject][ordered]@{
                roleId     = $roleId
                label      = $roleName.Trim()
                extensions = @($extensions)
                folder     = $folder.Trim()
            }) | Out-Null
        }

        if ($roles.Count -eq 0) {
            throw 'Add at least one role with file types before saving.'
        }

        return @($roles)
    }

    function Save-ProfileFromForm([bool]$SetActive) {
        $root = $textRoot.Text.Trim().Trim('"')
        if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) {
            throw 'Project root must be an existing folder.'
        }

        $name = $textProfileName.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($name)) {
            $name = Get-DefaultProfileName -RootPath $root
            $textProfileName.Text = $name
        }

        $id = $script:CurrentProfileId
        if ([string]::IsNullOrWhiteSpace($id)) {
            $id = ConvertTo-OrganizationProfileId -Value $name
        }

        $roles = @(Collect-AssignmentsAsRoles)
        $profile = [PSCustomObject][ordered]@{
            format      = 'flowcell-organization-profile-v1'
            profileId   = $id
            profileName = $name
            rootPath    = (Get-Item -LiteralPath $root).FullName
            roles       = @($roles)
            createdAt   = (Get-Date).ToString('o')
            updatedAt   = (Get-Date).ToString('o')
        }

        $savedPath = Save-OrganizationProfileDocument -Profile $profile -SetActive:($SetActive)
        $script:CurrentProfileId = $id
        Refresh-ProfileList

        $message = if ($SetActive) { "Saved and activated profile '$name'." } else { "Saved profile '$name'." }
        Set-Status $message
        Write-FlowCellStatus ($message + [Environment]::NewLine + 'Profile document: ' + $savedPath)
    }

    function Invoke-DetectedProgramFolders {
        $root = $textRoot.Text.Trim().Trim('"')
        if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) {
            throw 'Pick a valid project root first.'
        }

        $extensionProgramMap = @{}
        foreach ($program in $programRoles) {
            foreach ($extension in @($program.Extensions)) {
                $extensionProgramMap[(Normalize-OrganizationExtension -Value $extension)] = $program
            }
        }

        $detected = @{}
        foreach ($file in (Get-ChildItem -LiteralPath $root -File -Force -ErrorAction SilentlyContinue | Sort-Object Name)) {
            $extension = Normalize-OrganizationExtension -Value $file.Extension
            if ($extensionProgramMap.ContainsKey($extension)) {
                $program = $extensionProgramMap[$extension]
                $detected[[string]$program.Name] = $program
            }
        }

        if ($detected.Count -eq 0) {
            Set-Status 'No exclusive program files found in the project root.'
            return
        }

        $createdPrograms = New-Object System.Collections.Generic.List[string]
        foreach ($program in @($detected.Values | Sort-Object Name)) {
            $programFolder = [string]$program.ProgramFolder
            foreach ($folderName in $programStructure) {
                New-Item -ItemType Directory -Path (Join-Path $root (Join-Path $programFolder $folderName)) -Force | Out-Null
            }

            $liveFolder = Join-Path $programFolder 'Live'
            $added = Add-AssignmentToFolder -Folder $liveFolder -RoleName ([string]$program.Name) -Extensions @($program.Extensions) -Source 'detected-program' -SkipDuplicateMessage
            if ($added) {
                $createdPrograms.Add([string]$program.Name) | Out-Null
            }
        }

        Load-FolderTree
        if ($createdPrograms.Count -gt 0) {
            $lastProgram = [string]$createdPrograms[$createdPrograms.Count - 1]
            $program = $programRoles | Where-Object { [string]$_.Name -eq $lastProgram } | Select-Object -First 1
            if ($program -ne $null) {
                Select-FolderInTree -RelativeFolder (Join-Path ([string]$program.ProgramFolder) 'Live')
            }
            Set-Status ('Created/confirmed program folders and assigned: {0}' -f ($createdPrograms -join ', '))
        }
        else {
            Set-Status 'Detected program folders already had assignments.'
        }
    }

    $treeFolders.Add_AfterSelect({
        Refresh-SelectedFolderPanel
    })

    $comboAddRole.Add_SelectedIndexChanged({
        if ($script:IsRefreshingUi -or $comboAddRole.SelectedItem -eq $null) { return }
        try {
            $folder = Get-SelectedFolderRelative
            $display = [string]$comboAddRole.SelectedItem
            if ($roleDisplayIndex.ContainsKey($display)) {
                $role = $roleDisplayIndex[$display]
                $added = Add-AssignmentToFolder -Folder $folder -RoleName ([string]$role.Name) -Extensions @($role.Extensions) -Source 'role-dropdown'
                if ($added) {
                    Set-Status ('Added {0} to {1}.' -f [string]$role.Name, $folder)
                }
            }
        }
        catch {
            Set-Status $_.Exception.Message
            Write-FlowCellStatus $_.Exception.Message
        }
        finally {
            $script:IsRefreshingUi = $true
            $comboAddRole.SelectedIndex = -1
            $script:IsRefreshingUi = $false
        }
    })

    $buttonAddCustom.Add_Click({
        try {
            $folder = Get-SelectedFolderRelative
            $extensions = @(Split-OrganizationExtensions -Value $textCustomExtensions.Text)
            $added = Add-AssignmentToFolder -Folder $folder -RoleName 'Custom File Types' -Extensions $extensions -Source 'custom'
            if ($added) {
                Set-Status ('Added custom file types to {0}.' -f $folder)
                $textCustomExtensions.Text = ''
            }
        }
        catch {
            Set-Status $_.Exception.Message
            Write-FlowCellStatus $_.Exception.Message
        }
    })

    $gridAssignments.Add_CellContentClick({
        param($sender, $eventArgs)
        if ($eventArgs.RowIndex -lt 0) { return }
        if ($eventArgs.ColumnIndex -eq $gridAssignments.Columns['remove'].Index) {
            $assignment = $gridAssignments.Rows[$eventArgs.RowIndex].Tag
            Remove-AssignmentObject -Assignment $assignment
        }
    })

    $buttonBrowse.Add_Click({
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = 'Choose project root folder'
        if ((Test-Path -LiteralPath $textRoot.Text -PathType Container)) {
            $dialog.SelectedPath = $textRoot.Text
        }
        if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
            $textRoot.Text = $dialog.SelectedPath
            if ([string]::IsNullOrWhiteSpace($textProfileName.Text) -or $script:CurrentProfileId -eq '') {
                $textProfileName.Text = Get-DefaultProfileName -RootPath $textRoot.Text
            }
            Load-FolderTree
        }
    })

    $buttonScan.Add_Click({
        try { Load-FolderTree }
        catch {
            Set-Status $_.Exception.Message
            Write-FlowCellStatus $_.Exception.Message
        }
    })

    $buttonAutoPrograms.Add_Click({
        try { Invoke-DetectedProgramFolders }
        catch {
            Set-Status $_.Exception.Message
            Write-FlowCellStatus $_.Exception.Message
        }
    })

    $buttonLoad.Add_Click({
        try {
            if ($comboProfiles.SelectedItem -eq $null) { throw 'Pick a saved profile first.' }
            $profileId = $script:ProfileIndex[[string]$comboProfiles.SelectedItem]
            $profile = Read-OrganizationProfile -ProfileId $profileId
            Load-ProfileIntoForm -Profile $profile
        }
        catch {
            Set-Status $_.Exception.Message
            Write-FlowCellStatus $_.Exception.Message
        }
    })

    $buttonNew.Add_Click({ Clear-FormForNewProfile })

    $buttonSave.Add_Click({
        try { Save-ProfileFromForm -SetActive $false }
        catch {
            Set-Status $_.Exception.Message
            Write-FlowCellStatus $_.Exception.Message
        }
    })

    $buttonSaveActive.Add_Click({
        try { Save-ProfileFromForm -SetActive $true }
        catch {
            Set-Status $_.Exception.Message
            Write-FlowCellStatus $_.Exception.Message
        }
    })

    Refresh-ProfileList
    $activeId = Get-ActiveOrganizationProfileId
    if (-not [string]::IsNullOrWhiteSpace($activeId)) {
        try { Load-ProfileIntoForm -Profile (Read-OrganizationProfile -ProfileId $activeId) } catch { Clear-FormForNewProfile }
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
