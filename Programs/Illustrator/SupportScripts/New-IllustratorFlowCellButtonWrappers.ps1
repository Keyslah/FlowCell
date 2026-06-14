#requires -version 5.1
[CmdletBinding()]
param(
  [string]$RepoRoot,
  [string]$ManifestPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-FlowCellRepoRoot {
  if (-not [string]::IsNullOrWhiteSpace($RepoRoot)) {
    return [System.IO.Path]::GetFullPath($RepoRoot)
  }

  $supportRoot = Split-Path -Parent $PSCommandPath
  $programRoot = Split-Path -Parent $supportRoot
  $programsRoot = Split-Path -Parent $programRoot
  return [System.IO.Path]::GetFullPath((Split-Path -Parent $programsRoot))
}

$repoRootPath = Get-FlowCellRepoRoot
$programRoot = Join-Path $repoRootPath 'Programs\Illustrator'
$manifestFile = if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  Join-Path $programRoot 'illustrator-actions.json'
} else {
  [System.IO.Path]::GetFullPath($ManifestPath)
}

$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$invokeRelative = '..\..\SupportScripts\Invoke-IllustratorFlowCellAction.ps1'

foreach ($action in @($manifest.actions)) {
  if (-not ($action.PSObject.Properties.Name -contains 'buttonSource')) {
    continue
  }

  $buttonPath = [System.IO.Path]::GetFullPath((Join-Path $programRoot ([string]$action.buttonSource)))
  $buttonDirectory = Split-Path -Parent $buttonPath
  if (-not [System.IO.Directory]::Exists($buttonDirectory)) {
    [System.IO.Directory]::CreateDirectory($buttonDirectory) | Out-Null
  }

  $content = @"
#requires -version 5.1
`$ErrorActionPreference = 'Stop'
`$invokeScript = Join-Path `$PSScriptRoot '$invokeRelative'
& `$invokeScript -ActionId '$($action.id)'
exit `$LASTEXITCODE
"@

  Set-Content -LiteralPath $buttonPath -Value $content -Encoding UTF8
  Write-Host "Wrote $buttonPath"
}
