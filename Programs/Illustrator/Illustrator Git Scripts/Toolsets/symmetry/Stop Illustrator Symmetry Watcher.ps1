#requires -version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RuntimeFolder,
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,
  [Parameter(Mandatory = $true)]
  [string]$OwnerButtonId,
  [Parameter(Mandatory = $true)]
  [string]$OwnerToken,
  [int]$TimeoutMilliseconds = 5000
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Normalize-PathText {
  param([Parameter(Mandatory = $true)][string]$Path)

  return ([System.IO.Path]::GetFullPath($Path).TrimEnd('\')).ToUpperInvariant()
}

function Test-PathTextEqual {
  param(
    [Parameter(Mandatory = $true)][string]$Left,
    [Parameter(Mandatory = $true)][string]$Right
  )

  return (Normalize-PathText -Path $Left) -eq (Normalize-PathText -Path $Right)
}

function Test-ContainsInvariant {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Value
  )

  return $Text.IndexOf($Value, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Write-Status {
  param([Parameter(Mandatory = $true)][string]$Message)

  try {
    [System.IO.File]::WriteAllText(
      (Join-Path $RuntimeFolder 'illustrator-symmetry-status.txt'),
      "$Message`r`n",
      [System.Text.UTF8Encoding]::new($false)
    )
  } catch {
  }
}

function Disable-SymmetryState {
  $statePath = Join-Path $RuntimeFolder 'illustrator-symmetry-state.json'
  if (-not [System.IO.File]::Exists($statePath)) {
    return
  }
  $raw = [System.IO.File]::ReadAllText($statePath)
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return
  }
  $state = $raw | ConvertFrom-Json -ErrorAction Stop
  $state | Add-Member -NotePropertyName enabled -NotePropertyValue $false -Force
  [System.IO.File]::WriteAllText(
    $statePath,
    ($state | ConvertTo-Json -Depth 32 -Compress),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-TrackedWatcher {
  $recordPath = Join-Path $RuntimeFolder 'illustrator-symmetry-watcher.json'
  if (-not [System.IO.File]::Exists($recordPath)) {
    return $null
  }
  $raw = [System.IO.File]::ReadAllText($recordPath)
  if ([string]::IsNullOrWhiteSpace($raw)) {
    throw "Symmetry watcher record is empty: $recordPath"
  }
  try {
    return $raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "Symmetry watcher record is invalid: $recordPath"
  }
}

function Test-TrackedWatcherIdentity {
  param(
    [Parameter(Mandatory = $true)]$Record,
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
    [Parameter(Mandatory = $true)][string]$ExpectedWatcherPath,
    [Parameter(Mandatory = $true)][string]$ExpectedSourcePath
  )

  if ([int]$Record.schemaVersion -ne 1 -or [string]$Record.ownerToken -ne $OwnerToken -or
      [int]$Record.processId -ne $Process.Id -or
      -not (Test-PathTextEqual -Left ([string]$Record.sourcePath) -Right $ExpectedSourcePath) -or
      -not (Test-PathTextEqual -Left ([string]$Record.watcherPath) -Right $ExpectedWatcherPath)) {
    return $false
  }
  if ([System.IO.Path]::GetFileName([string]$Process.Path) -ine 'powershell.exe' -or
      -not (Test-PathTextEqual -Left ([string]$Record.executablePath) -Right ([string]$Process.Path))) {
    return $false
  }

  $cim = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($Process.Id)" -ErrorAction Stop
  if ($null -eq $cim -or [string]::IsNullOrWhiteSpace([string]$cim.CommandLine)) {
    return $false
  }
  return (Test-ContainsInvariant -Text ([string]$cim.CommandLine) -Value $ExpectedWatcherPath) -and
    (Test-ContainsInvariant -Text ([string]$cim.CommandLine) -Value $ExpectedSourcePath) -and
    (Test-ContainsInvariant -Text ([string]$cim.CommandLine) -Value $OwnerToken)
}

function Find-LegacyWatcher {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedWatcherPath,
    [Parameter(Mandatory = $true)][string]$ExpectedSourcePath
  )

  $matches = @()
  foreach ($candidate in @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop)) {
    if ([string]::IsNullOrWhiteSpace([string]$candidate.CommandLine) -or
        -not (Test-ContainsInvariant -Text ([string]$candidate.CommandLine) -Value $ExpectedWatcherPath) -or
        -not (Test-ContainsInvariant -Text ([string]$candidate.CommandLine) -Value $ExpectedSourcePath)) {
      continue
    }
    $process = Get-Process -Id ([int]$candidate.ProcessId) -ErrorAction SilentlyContinue
    if ($null -eq $process -or [System.IO.Path]::GetFileName([string]$process.Path) -ine 'powershell.exe') {
      continue
    }
    $matches += $process
  }
  if ($matches.Count -gt 1) {
    throw 'Refusing to stop ambiguous legacy Symmetry watcher processes for this owner.'
  }
  return @($matches)[0]
}

function Get-OwnerMutexName {
  param([Parameter(Mandatory = $true)][string]$ExpectedSourcePath)

  $normalized = $ExpectedSourcePath.ToUpperInvariant()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($bytes)
  } finally {
    $sha.Dispose()
  }
  $token = -join ($hash[0..7] | ForEach-Object { $_.ToString('x2') })
  return "Global\FlowCell.Illustrator.Symmetry.$token"
}

function Wait-ForOwnerMutexRelease {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedSourcePath,
    [Parameter(Mandatory = $true)][DateTime]$Deadline
  )

  $mutex = [System.Threading.Mutex]::new($false, (Get-OwnerMutexName -ExpectedSourcePath $ExpectedSourcePath))
  try {
    while ([DateTime]::UtcNow -lt $Deadline) {
      $ownsMutex = $false
      try {
        $ownsMutex = $mutex.WaitOne(0)
      } catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
      }
      if ($ownsMutex) {
        try {
          $mutex.ReleaseMutex()
        } catch {
        }
        return
      }
      Start-Sleep -Milliseconds 40
    }
  } finally {
    $mutex.Dispose()
  }
  throw 'Symmetry watcher mutex did not release before the stop timeout.'
}

if ($TimeoutMilliseconds -lt 100 -or $TimeoutMilliseconds -gt 15000) {
  throw 'TimeoutMilliseconds must be between 100 and 15000.'
}

$resolvedSource = [System.IO.Path]::GetFullPath($SourcePath)
$sourceFolder = Split-Path -Parent $resolvedSource
$ownerFolder = Split-Path -Parent $sourceFolder
$expectedRuntime = Join-Path $ownerFolder 'runtime'
if (-not (Test-PathTextEqual -Left $RuntimeFolder -Right $expectedRuntime) -or
    [System.IO.Path]::GetFileName($ownerFolder) -ine $OwnerButtonId) {
  throw 'Symmetry watcher stop request does not match the installed owner boundary.'
}
if (-not [System.IO.File]::Exists($resolvedSource)) {
  throw "Symmetry source was not found: $resolvedSource"
}

$record = Get-TrackedWatcher
$watcherPath = Join-Path $sourceFolder 'IllustratorSymmetryWatcher.ps1'
$process = $null
if ($null -ne $record) {
  $process = Get-Process -Id ([int]$record.processId) -ErrorAction SilentlyContinue
  if ($null -ne $process -and -not (Test-TrackedWatcherIdentity -Record $record -Process $process -ExpectedWatcherPath $watcherPath -ExpectedSourcePath $resolvedSource)) {
    throw 'Refusing to stop a process that does not match this Symmetry owner watcher record.'
  }
} else {
  $process = Find-LegacyWatcher -ExpectedWatcherPath $watcherPath -ExpectedSourcePath $resolvedSource
}

Disable-SymmetryState
$deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
if ($null -eq $process) {
  Wait-ForOwnerMutexRelease -ExpectedSourcePath $resolvedSource -Deadline $deadline
  $message = if ($null -eq $record) {
    'Symmetry OFF | no owner watcher was running.'
  } else {
    'Symmetry OFF | prior owner watcher was already stopped.'
  }
  Write-Status $message
  exit 0
}

while ($null -ne (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 40
}
if ($null -ne (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
  throw "Symmetry watcher process $($process.Id) did not exit."
}
Wait-ForOwnerMutexRelease -ExpectedSourcePath $resolvedSource -Deadline $deadline

Write-Status 'Symmetry OFF | owner watcher stopped.'
