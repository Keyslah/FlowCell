<#
Verify tool-set skin references before release staging using a disposable fixture.
Tracked paths are supplied directly. This test does not run Git or create a ZIP.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Stop-Package([string]$Message) { throw $Message }
. (Join-Path $PSScriptRoot '..\program-package-safety.ps1')
$temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
$fixtureRoot = Join-Path $temporaryParent ('flowcell-appearance-packaging-tests-' + [guid]::NewGuid().ToString('N'))
$script:passed = 0

function Write-FixtureFile([string]$Path, [string]$Text) {
  [IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Write-ToolsetManifest([string]$SkinFile, [string]$VariantFile) {
  $toolset = [ordered]@{
    schemaVersion = 1
    id = 'sample.tool'
    version = '1.0.0'
    label = 'Sample tool'
    program = 'Sample'
    source = 'action.ps1'
    children = @(@{ slot = 'run'; label = 'Run' })
    appearance = @{
      skins = @{ authored = @{ file = $SkinFile; variants = @{ '8' = $VariantFile } } }
    }
  }
  Write-FixtureFile $toolsetPath ($toolset | ConvertTo-Json -Depth 20)
}

function Assert-Rejected([string]$Name, [string[]]$TrackedFiles, [string]$Pattern) {
  $message = $null
  try { Assert-ProgramManifestReferencesTracked $program $programManifest $TrackedFiles }
  catch { $message = $_.Exception.Message }
  if (-not $message -or $message -notlike $Pattern) {
    throw "$Name expected '$Pattern', received '$message'."
  }
  $script:passed++
}

try {
  $programPath = Join-Path $fixtureRoot 'Programs\Sample'
  $packageRelative = 'Catalog/Tool'
  $toolsetPath = Join-Path $programPath "$packageRelative/flowcell.toolset.json"
  $baseFile = 'skins/base.flowcell-button-skin.txt'
  $variantFile = 'skins/family/8.flowcell-button-skin.txt'
  Write-FixtureFile (Join-Path $programPath "$packageRelative/action.ps1") 'throw "Fixture scripts must never run."'
  Write-FixtureFile (Join-Path $programPath "$packageRelative/$baseFile") 'inert base skin fixture'
  Write-FixtureFile (Join-Path $programPath "$packageRelative/$variantFile") 'inert variant skin fixture'
  $outsideSkin = Join-Path $programPath 'Catalog/outside.flowcell-button-skin.txt'
  Write-FixtureFile $outsideSkin 'tracked skin outside the tool-set package'
  $program = Get-Item -LiteralPath $programPath
  $trackedPrefix = "Programs/Sample/$packageRelative"
  $tracked = @(
    "$trackedPrefix/flowcell.toolset.json"
    "$trackedPrefix/action.ps1"
    "$trackedPrefix/$baseFile"
    "$trackedPrefix/$variantFile"
    'Programs/Sample/Catalog/outside.flowcell-button-skin.txt'
  )
  $cases = @(
    @{ name = 'untracked file'; file = $baseFile; variant = $variantFile; omit = "$trackedPrefix/$baseFile"; pattern = '*appearance skin*not Git-tracked*' }
    @{ name = 'untracked variant'; file = $baseFile; variant = $variantFile; omit = "$trackedPrefix/$variantFile"; pattern = '*appearance skin*not Git-tracked*' }
    @{ name = 'missing file'; file = 'skins/missing.txt'; variant = $variantFile; track = "$trackedPrefix/skins/missing.txt"; pattern = '*appearance skin*not found*' }
    @{ name = 'missing variant'; file = $baseFile; variant = 'skins/missing-variant.txt'; track = "$trackedPrefix/skins/missing-variant.txt"; pattern = '*appearance skin*not found*' }
    @{ name = 'file leaves package'; file = '../outside.flowcell-button-skin.txt'; variant = $variantFile; pattern = '*unsafe *appearance skin*' }
    @{ name = 'variant leaves package'; file = $baseFile; variant = '../outside.flowcell-button-skin.txt'; pattern = '*unsafe *appearance skin*' }
    @{ name = 'absolute file'; file = $outsideSkin; variant = $variantFile; pattern = '*unsafe *appearance skin*' }
    @{ name = 'absolute variant'; file = $baseFile; variant = $outsideSkin; pattern = '*unsafe *appearance skin*' }
    @{ name = 'empty file'; file = ''; variant = $variantFile; pattern = '*empty *appearance skin*' }
    @{ name = 'empty variant'; file = $baseFile; variant = ''; pattern = '*empty *appearance skin*' }
    @{ name = 'directory file'; file = 'skins'; variant = $variantFile; pattern = '*appearance skin*must name a file*' }
    @{ name = 'directory variant'; file = $baseFile; variant = 'skins/family'; pattern = '*appearance skin*must name a file*' }
  )
  foreach ($sourcePath in @("$packageRelative/flowcell.toolset.json", $packageRelative)) {
    $programManifest = [pscustomobject]@{
      supportScriptsFolder = 'SupportScripts'
      bundledSources = @([pscustomobject]@{ sourcePath = $sourcePath; importKind = 'tool-set' })
    }
    Write-ToolsetManifest $baseFile $variantFile
    Assert-ProgramManifestReferencesTracked $program $programManifest $tracked
    $script:passed++
    foreach ($case in $cases) {
      Write-ToolsetManifest $case.file $case.variant
      $caseTracked = @($tracked | Where-Object { -not $case.ContainsKey('omit') -or $_ -cne $case.omit })
      if ($case.ContainsKey('track')) { $caseTracked += $case.track }
      Assert-Rejected "$sourcePath / $($case.name)" $caseTracked $case.pattern
    }
  }
  Write-Output "Tool-set appearance packaging tests: $script:passed passed."
} finally {
  $resolved = [IO.Path]::GetFullPath($fixtureRoot)
  $temporaryPrefix = $temporaryParent + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolved) -notlike 'flowcell-appearance-packaging-tests-*') {
    throw 'Unsafe appearance fixture cleanup path.'
  }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
