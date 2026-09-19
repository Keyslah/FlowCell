<#
Purpose: Stage only tracked core runtime resources for a Tauri Windows installer build.
Context: Clean committed release worktree. Inputs: AutoHotkey runtime and its GPL license.
Writes: dist/installer-resources only; no program/user state copied. Existing staging is recycled.
Constraints: Build-time tool only. No install, restart, program registration or Git mutation.
#>
[CmdletBinding()]
param([string]$AutoHotkeyExe='C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe', [string]$AutoHotkeyLicenseFile='C:\Program Files\AutoHotkey\license.txt')
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$stage=Join-Path $repo 'dist\installer-resources'
if (-not (Test-Path -LiteralPath $AutoHotkeyExe -PathType Leaf) -or -not (Test-Path -LiteralPath $AutoHotkeyLicenseFile -PathType Leaf)) { throw 'AutoHotkey runtime and GPL license are required.' }
if (Test-Path -LiteralPath $stage) {
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($stage,'OnlyErrorDialogs','SendToRecycleBin')
}
$tracked=@(& git -C $repo -c core.quotePath=false ls-files -- flowcellbackend tools)
if($LASTEXITCODE -ne 0){throw 'Could not inventory tracked runtime resources.'}
foreach($relative in $tracked){
    if($relative -match '(^|/)(local|\.git|node_modules|target)(/|$)|\.(log|tmp)$'){throw "Private/generated runtime resource rejected: $relative"}
    $source=Join-Path $repo $relative
    $cursor=Get-Item -LiteralPath $source -Force
    while($cursor -and $cursor.FullName.StartsWith($repo,[StringComparison]::OrdinalIgnoreCase)){
        if(($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "Reparse runtime resource: $relative"}
        $parent=Split-Path -Parent $cursor.FullName
        $cursor=if($parent){Get-Item -LiteralPath $parent -Force}else{$null}
        if(-not $cursor){break}
    }
    $destination=Join-Path $stage $relative
    [IO.Directory]::CreateDirectory((Split-Path -Parent $destination))|Out-Null
    [IO.File]::Copy($source,$destination)
}
$runtime=Join-Path $stage 'flowcellbackend/runtime'
[IO.Directory]::CreateDirectory($runtime)|Out-Null
Copy-Item -LiteralPath $AutoHotkeyExe -Destination (Join-Path $runtime 'AutoHotkey64.exe')
Copy-Item -LiteralPath $AutoHotkeyLicenseFile -Destination (Join-Path $runtime 'AutoHotkey-LICENSE.txt')
$version=(Get-Item -LiteralPath $AutoHotkeyExe).VersionInfo.ProductVersion
"AutoHotkey $version is GPL-2.0 software. Corresponding source: https://github.com/AutoHotkey/AutoHotkey/tree/v$version . Full source archive: https://github.com/AutoHotkey/AutoHotkey/archive/refs/tags/v$version.zip" | Set-Content -LiteralPath (Join-Path $runtime 'AutoHotkey-SOURCE.txt') -Encoding UTF8
$commit=(& git -C $repo rev-parse HEAD).Trim()
@{schemaVersion=1;distribution='installed';commit=$commit} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'flowcell-installed.json') -Encoding UTF8
Write-Output "Staged $($tracked.Count) tracked core files, AutoHotkey $version and license/source notices."
