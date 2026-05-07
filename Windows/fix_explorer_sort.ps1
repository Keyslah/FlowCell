# Description: Runs fix explorer sort.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Export-RegistryKeysToSingleReg {
    param(
        [Parameter(Mandatory)]
        [string[]]$RegistryPaths,

        [Parameter(Mandatory)]
        [string]$OutputPath,

        [Parameter(Mandatory)]
        [string]$RegExe
    )

    $tempDir = Join-Path $env:TEMP ("explorer_sort_backup_" + [Guid]::NewGuid().ToString('N'))
    New-Item -Path $tempDir -ItemType Directory -Force | Out-Null

    try {
        $merged = New-Object 'System.Collections.Generic.List[string]'
        [void]$merged.Add('Windows Registry Editor Version 5.00')
        [void]$merged.Add('')

        foreach ($registryPath in $RegistryPaths) {
            $tempFile = Join-Path $tempDir (([Guid]::NewGuid().ToString('N')) + '.reg')
            & $RegExe export $registryPath $tempFile /y 2>$null | Out-Null

            if (-not (Test-Path $tempFile)) {
                continue
            }

            $lines = Get-Content -Path $tempFile

            if ($lines.Count -le 1) {
                continue
            }

            foreach ($line in $lines[1..($lines.Count - 1)]) {
                [void]$merged.Add($line)
            }

            if ($merged[$merged.Count - 1] -ne '') {
                [void]$merged.Add('')
            }
        }

        Set-Content -Path $OutputPath -Value $merged -Encoding Unicode
    }
    finally {
        if (Test-Path $tempDir) {
            Remove-Item -Path $tempDir -Recurse -Force
        }
    }
}

function Copy-RegistryTree {
    param(
        [Parameter(Mandatory)]
        [string]$SourcePath,

        [Parameter(Mandatory)]
        [string]$DestinationPath,

        [Parameter(Mandatory)]
        [string]$RegExe
    )

    & $RegExe copy $SourcePath $DestinationPath /s /f | Out-Null
}

function Set-TopViewDefaults {
    param(
        [Parameter(Mandatory)]
        [string]$TopViewPath
    )

    New-ItemProperty -Path $TopViewPath -Name 'LogicalViewMode' -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path $TopViewPath -Name 'Mode' -PropertyType DWord -Value 4 -Force | Out-Null
    New-ItemProperty -Path $TopViewPath -Name 'SortByList' -PropertyType String -Value 'prop:-System.DateModified;System.ItemNameDisplay' -Force | Out-Null
    New-ItemProperty -Path $TopViewPath -Name 'PrimaryProperty' -PropertyType String -Value 'System.DateModified' -Force | Out-Null

    foreach ($propertyName in @('GroupBy', 'GroupAscending', 'StackBy', 'DateCategorizerInfo')) {
        Remove-ItemProperty -Path $TopViewPath -Name $propertyName -ErrorAction SilentlyContinue
    }
}

$documentsPath = [Environment]::GetFolderPath('MyDocuments')
$regExe = Join-Path $env:SystemRoot 'System32\reg.exe'
$shellRoot = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell'
$shellKeyReg = 'HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell'
$bagsPath = Join-Path $shellRoot 'Bags'
$bagMruPath = Join-Path $shellRoot 'BagMRU'
$streamsDefaultsPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Streams\Defaults'
$streamsDefaultsReg = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Streams\Defaults'
$folderTypesRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FolderTypes'
$folderTypesRootReg = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FolderTypes'
$folderTypesHklmRootReg = 'HKLM\Software\Microsoft\Windows\CurrentVersion\Explorer\FolderTypes'

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupPath = Join-Path $documentsPath "explorer_sort_backup_$timestamp.reg"

$targetFolderTypes = @(
    '{5C4F28B5-F869-4E84-8E60-F11DB97C5CC7}' # Generic
    '{7D49D726-3C21-4F05-99AA-FDC2C9474656}' # Documents
    '{885A186E-A440-4ADA-812B-DB871B942259}' # Downloads
    '{94D6DDCC-4A68-4175-A374-BD584A510B78}' # Music
    '{5FA96407-7E77-483C-AC93-691D05850DE8}' # Videos
    '{CD0FC69B-71E2-46E5-9690-5BCD9F57AAB3}' # UserFiles
    '{4F01EBC5-2385-41F2-A28E-2C5C91FB56E0}' # StorageProviderGeneric
    '{DD61BD66-70E8-48DD-9655-65C5E1AAC2D1}' # StorageProviderDocuments
    '{672ECD7E-AF04-4399-875C-0290845B6247}' # StorageProviderMusic
    '{51294DA1-D7B1-485B-9E9A-17CFFE33E187}' # StorageProviderVideos
    '{7FDE1A1E-8B31-49A5-93B8-6BE14CFA4943}' # Generic.SearchResults
    '{36011842-DCCC-40FE-AA3D-6177EA401788}' # Documents.SearchResults
    '{71689AC1-CC88-45D0-8A22-2943C3E7DFB3}' # Music.SearchResults
    '{EA25FBD7-3BF7-409E-B97F-3352240903F4}' # Videos.SearchResults
    '{E053A11A-DCED-4515-8C4E-D51BA917517B}' # UserFiles.SearchResults
    '{24CCB8A6-C45A-477D-B940-3382B9225668}' # HomeFolder
    '{43FED747-B357-468E-AE70-EE0CB0F46508}' # HomeFolder
)

$excludedPictureTypes = @(
    '{DB2A5D8F-06E6-4007-ABA6-AF877D526EA6}'
    '{B3690E58-E961-423B-B687-386EBFD83239}'
    '{0B2BAAEB-0042-4DCA-AA4D-3EE8648D03E5}'
    '{C1F8339F-F312-4C97-B1C6-ECDF5910C5C0}'
    '{4DCAFE13-E6A7-4C28-BE02-CA8C2126280D}'
    '{71D642A9-F2B1-42CD-AD92-EB9300C7CC0A}'
    '{D9507369-0D17-48CC-B03F-6A20AA57CFBD}'
    '{B1FAB223-7CED-42F6-BEA8-30EEA21A49DA}'
)

$keysToBackup = @($shellKeyReg)

if (Test-Path $streamsDefaultsPath) {
    $keysToBackup += $streamsDefaultsReg
}

if (Test-Path $folderTypesRoot) {
    $keysToBackup += $folderTypesRootReg
}

Write-Host "Backing up Explorer registry keys to $backupPath"
Export-RegistryKeysToSingleReg -RegistryPaths $keysToBackup -OutputPath $backupPath -RegExe $regExe

if (Test-Path $bagMruPath) {
    Remove-Item -Path $bagMruPath -Recurse -Force
}

if (Test-Path $bagsPath) {
    Remove-Item -Path $bagsPath -Recurse -Force
}

if (Test-Path $streamsDefaultsPath) {
    Remove-Item -Path $streamsDefaultsPath -Recurse -Force
}

New-Item -Path $shellRoot -Force | Out-Null
New-ItemProperty -Path $shellRoot -Name 'BagMRU Size' -PropertyType DWord -Value 20000 -Force | Out-Null

New-Item -Path $folderTypesRoot -Force | Out-Null

foreach ($folderType in $targetFolderTypes) {
    $sourcePath = "$folderTypesHklmRootReg\$folderType"
    $destinationPath = "$folderTypesRootReg\$folderType"
    $destinationPsPath = Join-Path $folderTypesRoot $folderType

    if (Test-Path $destinationPsPath) {
        Remove-Item -Path $destinationPsPath -Recurse -Force
    }

    Copy-RegistryTree -SourcePath $sourcePath -DestinationPath $destinationPath -RegExe $regExe

    $topViewsPath = Join-Path $destinationPsPath 'TopViews'

    foreach ($topViewKey in Get-ChildItem -Path $topViewsPath -ErrorAction Stop) {
        Set-TopViewDefaults -TopViewPath $topViewKey.PSPath
    }
}

Write-Host 'Explorer restart skipped. Restart Explorer or reboot to make the new defaults active.'

$verification = foreach ($folderType in $targetFolderTypes) {
    $topViewsPath = Join-Path $folderTypesRoot $folderType
    $topViewsPath = Join-Path $topViewsPath 'TopViews'

    foreach ($topViewKey in Get-ChildItem -Path $topViewsPath -ErrorAction Stop) {
        $props = Get-ItemProperty -Path $topViewKey.PSPath
        [pscustomobject]@{
            FolderType       = $folderType
            TopView          = $topViewKey.PSChildName
            Mode             = $props.Mode
            LogicalViewMode  = $props.LogicalViewMode
            SortByList       = $props.SortByList
            PrimaryProperty  = $props.PrimaryProperty
            GroupByPresent   = ($props.PSObject.Properties.Name -contains 'GroupBy')
        }
    }
}

$verification | Format-Table -AutoSize

[pscustomobject]@{
    BackupPath            = $backupPath
    BagMRUSize            = (Get-ItemProperty -Path $shellRoot -Name 'BagMRU Size').'BagMRU Size'
    StreamsDefaultsCleared = -not (Test-Path $streamsDefaultsPath)
    FolderTypeCount       = $targetFolderTypes.Count
    ExplorerRestarted     = $false
    ManualRestartNeeded   = $true
    SortByList            = 'prop:-System.DateModified;System.ItemNameDisplay'
    ExcludedPictureTypes  = $excludedPictureTypes -join ', '
} | Format-List
