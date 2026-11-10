<#
Purpose: Stage the mandatory Windows catalog as immutable installer resources.
Inputs: Git-tracked Windows program files. Writes: A new installer staging subtree.
Constraints: Never reads user data, registers programs, executes catalog scripts, or overwrites a stage.
#>
function Copy-InstallerWindowsProgram {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$RepositoryRoot,
        [Parameter(Mandatory=$true)][string]$DestinationRoot
    )
    $ErrorActionPreference = 'Stop'
    $RepoRoot = [IO.Path]::GetFullPath($RepositoryRoot)
    function Stop-Package([string]$Message) { throw "[FlowCell installer Windows] $Message" }
    . (Join-Path $PSScriptRoot 'program-package-safety.ps1')
    if (Test-Path -LiteralPath $DestinationRoot) { Stop-Package 'Windows staging destination already exists.' }
    $program = Get-Item -LiteralPath (Join-Path $RepoRoot 'Programs/Windows')
    $contract = Get-ProgramPackageContract $program
    if ($contract.Manifest.programId -cne 'windows') { Stop-Package 'Expected the Windows program manifest.' }
    $tracked = @(Get-TrackedProgramFiles $program)
    Assert-ProgramManifestReferencesTracked $program $contract.Manifest $tracked
    Assert-ProgramPackageEntries $tracked 'Windows' $contract.MutableFolders 'Installer Windows catalog'
    foreach ($path in $tracked) {
        if ($path -match '(^|/)(\.git|__pycache__|node_modules|runtime|Bridge)(/|$)|\.(log|tmp|pyc|flowcell-source\.json)$|(^|/)flowcell\.install\.json$') {
            Stop-Package "Private/generated Windows payload rejected: $path"
        }
    }
    $catalog = Convert-ToSafeRelativeFolder ([string]$contract.Manifest.gitScriptsFolder) 'gitScriptsFolder' 'Windows'
    $baselineRelative = "$($contract.Manifest.supportScriptsFolder)/catalog-baseline.json"
    [void](Assert-TrackedProgramReference $program $tracked $baselineRelative 'catalog baseline' -RequireFile)
    $destination = Join-Path $DestinationRoot 'Programs/Windows'
    Copy-TrackedProgramFolder $program $destination $tracked
    $hashes = [ordered]@{}
    $prefix = "Programs/Windows/$catalog/"
    foreach ($path in $tracked) {
        if ($path.StartsWith($prefix, [StringComparison]::Ordinal)) {
            $relative = $path.Substring($prefix.Length)
            $hashes[$relative] = (Get-FileHash -LiteralPath (Join-Path $destination "$catalog/$relative") -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    if ($hashes.Count -eq 0) { Stop-Package 'Windows catalog is empty.' }
    $baseline = @{schemaVersion=1; programId='windows'; files=$hashes}
    [IO.File]::WriteAllText((Join-Path $destination $baselineRelative), ($baseline | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    Assert-ProgramStagingInvariant $DestinationRoot 'Windows' $contract.MutableFolders
    [pscustomobject]@{Program='Windows'; Destination=$destination; Files=$tracked.Count; CatalogFiles=$hashes.Count}
}
