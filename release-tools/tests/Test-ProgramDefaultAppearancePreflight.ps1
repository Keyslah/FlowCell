<# Validate declared Program appearance dependencies without staging or ZIP creation. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Stop-Package([string]$Message) { throw $Message }
. (Join-Path $PSScriptRoot '..\program-package-safety.ps1')
$temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
$fixtureRoot = Join-Path $temporaryParent ('flowcell-default-appearance-tests-' + [guid]::NewGuid().ToString('N'))
$script:passed = 0

function New-AppearanceFixture {
  $skin = [ordered]@{ metadata = [pscustomobject]@{} }
  foreach ($section in @('structure', 'base', 'hover', 'pressed', 'held', 'release', 'play', 'disabled', 'error', 'keyframes')) {
    $skin[$section] = 'literal'
  }
  return [pscustomobject]@{
    kind = 'FlowCellProgramAppearance'; version = 1
    skins = [pscustomobject]@{ authored = [pscustomobject]$skin }
    skinSources = [pscustomobject]@{ literal = '<div data-core>{{label}}</div>' }
    theme = [pscustomobject]@{
      kind = 'FlowCellPortableTheme'; version = 1
      target = [pscustomobject]@{ kind = 'program'; programName = 'Sample'; panelName = $null }
      dependencies = @([pscustomobject]@{
        id = 'dependency'; programName = 'Sample'; programId = 'sample'; panelName = 'Tools'
        sourceId = 'sample.action'; sourceVersion = '1.0.0'
      })
      references = [pscustomobject]@{ original = [pscustomobject]@{ kind = 'source'; dependencyId = 'dependency'; slot = $null } }
      theme = [pscustomobject]@{ buttons = @([pscustomobject]@{ buttonId = 'original'; skin = 'authored'; sourceIdentity = $null }) }
    }
  }
}

function Write-Appearance($Value) {
  [IO.File]::WriteAllText($appearancePath, ($Value | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
}

function Assert-Rejected([scriptblock]$Action, [string]$Pattern) {
  $message = $null
  try { & $Action } catch { $message = $_.Exception.Message }
  if (-not $message -or $message -notlike $Pattern) { throw "Expected '$Pattern'; received '$message'." }
  $script:passed++
}

function Assert-MutationRejected([scriptblock]$Change, [string]$Pattern) {
  $value = New-AppearanceFixture
  & $Change $value
  Write-Appearance $value
  Assert-Rejected { Assert-ProgramManifestReferencesTracked $program $manifest $tracked } $Pattern
}

try {
  $programPath = Join-Path $fixtureRoot 'Programs\Sample'
  [IO.Directory]::CreateDirectory((Join-Path $programPath 'SupportScripts')) | Out-Null
  [IO.Directory]::CreateDirectory((Join-Path $programPath 'Catalog')) | Out-Null
  [IO.File]::WriteAllText((Join-Path $programPath 'Catalog/action.py'), 'raise RuntimeError("Fixture must never execute")')
  $appearancePath = Join-Path $programPath 'SupportScripts/appearance.json'
  $program = Get-Item -LiteralPath $programPath
  $source = [pscustomobject]@{ id = 'sample.action'; version = '1.0.0'; panelName = 'Tools'; sourcePath = 'Catalog/action.py'; importKind = 'script' }
  $manifest = [pscustomobject]@{ label = 'Sample'; programId = 'sample'; supportScriptsFolder = 'SupportScripts'; bundledSources = @($source) }
  $tracked = @('Programs/Sample/Catalog/action.py', 'Programs/Sample/SupportScripts/appearance.json')
  Assert-ProgramManifestReferencesTracked $program $manifest $tracked
  $script:passed++
  $manifest | Add-Member -NotePropertyName defaultTheme -NotePropertyValue 'SupportScripts/appearance.json'
  Assert-Rejected { Assert-ProgramManifestReferencesTracked $program $manifest $tracked } '*defaultTheme*not found*'
  Write-Appearance (New-AppearanceFixture)
  Assert-Rejected { Assert-ProgramManifestReferencesTracked $program $manifest @('Programs/Sample/Catalog/action.py') } '*defaultTheme*not Git-tracked*'
  Assert-ProgramManifestReferencesTracked $program $manifest $tracked
  $script:passed++

  foreach ($path in @('../appearance.json', 'C:\Users\someone\appearance.json', '\\server\share\appearance.json')) {
    $manifest.defaultTheme = $path
    Assert-Rejected { Assert-ProgramManifestReferencesTracked $program $manifest $tracked } '*unsafe*defaultTheme*'
  }
  $manifest.defaultTheme = 'SupportScripts'
  Assert-Rejected { Assert-ProgramManifestReferencesTracked $program $manifest $tracked } '*defaultTheme*must name a file*'
  $manifest.defaultTheme = 'SupportScripts/appearance.json'
  [IO.File]::WriteAllText($appearancePath, '{ invalid JSON')
  Assert-Rejected { Assert-ProgramManifestReferencesTracked $program $manifest $tracked } '*invalid JSON*'

  Assert-MutationRejected { param($v) $v.version = 2 } '*unsupported format*'
  Assert-MutationRejected { param($v) $v.theme.target.programName = 'Other' } '*whole Program*'
  Assert-MutationRejected { param($v) $v.theme.target.panelName = 'Tools' } '*whole Program*'
  Assert-MutationRejected { param($v) $v.theme.dependencies[0].sourceId = 'missing.action' } '*not a bundled source*'
  Assert-MutationRejected { param($v) $v.theme.dependencies[0].sourceVersion = '2.0.0' } '*version, panel or Program*'
  Assert-MutationRejected { param($v) $v.theme.dependencies[0].panelName = 'Other' } '*version, panel or Program*'
  Assert-MutationRejected { param($v) $v.theme.dependencies[0].programId = 'other' } '*version, panel or Program*'
  Assert-MutationRejected { param($v) $v.theme.references.original.dependencyId = 'missing' } '*has no dependency*'
  Assert-MutationRejected { param($v) $v.theme.dependencies += $v.theme.dependencies[0] } '*duplicates a dependency id*'
  Assert-MutationRejected { param($v) $v.theme.dependencies[0] | Add-Member -NotePropertyName sourcePath -NotePropertyValue 'relative/action.py' } '*cannot embed executable or local source data*'
  Assert-MutationRejected { param($v) $v | Add-Member -NotePropertyName executionTarget -NotePropertyValue @{ kind = 'panel-script'; fileName = 'run.py' } } '*unsupported embedded data*'
  Assert-MutationRejected { param($v) $v.theme.theme.buttons[0] | Add-Member -NotePropertyName executionTarget -NotePropertyValue @{ kind = 'panel-script'; fileName = 'run.py' } } '*cannot embed executable or local source data*'
  Assert-MutationRejected { param($v) $v.theme | Add-Member -NotePropertyName machinePath -NotePropertyValue 'C:\Users\someone\local' } '*absolute local path*'
  Assert-MutationRejected { param($v) $v.theme | Add-Member -NotePropertyName machinePath -NotePropertyValue '\\server\share\local' } '*absolute local path*'
  Assert-MutationRejected { param($v) $v.theme.theme.buttons[0].skin = 'missing' } '*missing skin*'
  Assert-MutationRejected { param($v) $v.skins.authored.hover = 'missing' } '*missing hover source*'
  Assert-MutationRejected { param($v) $v.skins.authored.metadata | Add-Member -NotePropertyName buttonSkinEmbeddedVariants -NotePropertyValue @{ '8' = 'missing' } } '*missing variant source*'
  Assert-MutationRejected { param($v) $v.skinSources.literal = 4 } '*values must be strings*'

  Write-Appearance (New-AppearanceFixture)
  Assert-ProgramManifestReferencesTracked $program $manifest $tracked
  $script:passed++
  Write-Output "Program default appearance preflight tests: $script:passed passed."
} finally {
  $resolved = [IO.Path]::GetFullPath($fixtureRoot)
  $temporaryPrefix = $temporaryParent + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolved) -notlike 'flowcell-default-appearance-tests-*') { throw 'Unsafe appearance fixture cleanup path.' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
