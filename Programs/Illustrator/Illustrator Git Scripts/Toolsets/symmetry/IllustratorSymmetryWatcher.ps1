#requires -version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,
  [Parameter(Mandatory = $true)]
  [string]$OwnerToken,
  [int]$PollMilliseconds = 16,
  [int]$CommitDelayMilliseconds = 45
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class FlowCellSymmetryNative
{
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr windowHandle, out uint processId);
}
'@

function Get-FullSourcePath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not [System.IO.File]::Exists($resolved)) {
    throw "Illustrator Symmetry source was not found: $resolved"
  }
  $extension = [System.IO.Path]::GetExtension($resolved)
  if ($extension -ine '.jsx' -and $extension -ine '.js') {
    throw "Illustrator Symmetry source must be a .jsx or .js file: $resolved"
  }
  return $resolved
}

$script:SourcePath = Get-FullSourcePath -Path $SourcePath
$script:SourceFolder = Split-Path -Parent $script:SourcePath
$script:OwnerFolder = Split-Path -Parent $script:SourceFolder
$script:RuntimeFolder = Join-Path $script:OwnerFolder 'runtime'
$script:StatePath = Join-Path $script:RuntimeFolder 'illustrator-symmetry-state.json'
$script:LogPath = Join-Path $script:RuntimeFolder 'illustrator-symmetry.log'
$script:WatcherRecordPath = Join-Path $script:RuntimeFolder 'illustrator-symmetry-watcher.json'
$script:OwnerToken = $OwnerToken
$script:IllustratorApplication = $null

function Write-WatcherLog {
  param([Parameter(Mandatory = $true)][string]$Message)

  try {
    if (-not [System.IO.Directory]::Exists($script:RuntimeFolder)) {
      return
    }
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Add-Content -LiteralPath $script:LogPath -Value "$stamp | Watcher | $Message" -Encoding UTF8
  } catch {
  }
}

function Write-WatcherRecord {
  param([Parameter(Mandatory = $true)][ValidateSet('running', 'stopped')][string]$Status)

  try {
    if (-not [System.IO.Directory]::Exists($script:RuntimeFolder)) {
      return
    }
    $process = Get-Process -Id $PID -ErrorAction Stop
    $record = [ordered]@{
      schemaVersion = 1
      ownerToken = $script:OwnerToken
      processId = [int]$PID
      executablePath = [string]$process.Path
      watcherPath = [System.IO.Path]::GetFullPath($PSCommandPath)
      sourcePath = $script:SourcePath
      status = $Status
      updatedAt = (Get-Date).ToString('o')
    }
    [System.IO.File]::WriteAllText(
      $script:WatcherRecordPath,
      ($record | ConvertTo-Json -Compress),
      [System.Text.UTF8Encoding]::new($false)
    )
  } catch {
  }
}

function Get-OwnerMutexName {
  $normalized = $script:SourcePath.ToUpperInvariant()
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

function Read-SymmetryState {
  if (-not [System.IO.File]::Exists($script:StatePath)) {
    return $null
  }
  try {
    $raw = Get-Content -LiteralPath $script:StatePath -Raw -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return $null
    }
    return ($raw | ConvertFrom-Json -ErrorAction Stop)
  } catch {
    return $null
  }
}

function Test-StateEnabled {
  param([AllowNull()]$State)

  if ($null -eq $State) {
    return $false
  }
  if ($State.PSObject.Properties.Name -notcontains 'enabled') {
    return $false
  }
  return [bool]$State.enabled
}

function Get-ForegroundProcessId {
  $window = [FlowCellSymmetryNative]::GetForegroundWindow()
  if ($window -eq [IntPtr]::Zero) {
    return 0
  }
  [uint32]$processId = 0
  [void][FlowCellSymmetryNative]::GetWindowThreadProcessId($window, [ref]$processId)
  return [uint32]$processId
}

function Test-IllustratorForeground {
  $processId = Get-ForegroundProcessId
  if ($processId -eq 0) {
    return $false
  }
  try {
    $process = Get-Process -Id ([int]$processId) -ErrorAction Stop
    return $process.ProcessName -match '^Illustrator($|\.)'
  } catch {
    return $false
  }
}

function Get-IllustratorApplication {
  if ($null -ne $script:IllustratorApplication) {
    try {
      [void]$script:IllustratorApplication.Version
      return $script:IllustratorApplication
    } catch {
      $script:IllustratorApplication = $null
    }
  }

  $script:IllustratorApplication = [Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application')
  [void]$script:IllustratorApplication.Version
  return $script:IllustratorApplication
}

function ConvertTo-JsStringLiteral {
  param([Parameter(Mandatory = $true)][string]$Value)
  return ($Value | ConvertTo-Json -Compress)
}

function Invoke-SymmetryRelease {
  param([Parameter(Mandatory = $true)][string]$InternalCommand)

  if (-not [System.IO.File]::Exists($script:SourcePath)) {
    return 'source-missing'
  }

  $scriptBody = Get-Content -LiteralPath $script:SourcePath -Raw -ErrorAction Stop
  $args = [pscustomobject]@{ internalCommand = $InternalCommand }
  $prefix = @(
    'var FLOWCELL_ACTION_ID = "flowcell_illustrator_symmetry_watcher";'
    "var FLOWCELL_SCRIPT_PATH = $(ConvertTo-JsStringLiteral -Value $script:SourcePath);"
    "var FLOWCELL_ARGS = $($args | ConvertTo-Json -Compress);"
  ) -join "`r`n"

  for ($attempt = 0; $attempt -lt 2; $attempt += 1) {
    try {
      $application = Get-IllustratorApplication
      $result = $application.DoJavaScript($prefix + "`r`n" + $scriptBody)
      if ($null -eq $result) {
        return ''
      }
      return [string]$result
    } catch {
      $script:IllustratorApplication = $null
      if ($attempt -ge 1) {
        throw
      }
      Start-Sleep -Milliseconds 35
    }
  }
  return ''
}

$mutex = [System.Threading.Mutex]::new($false, (Get-OwnerMutexName))
$ownsMutex = $false
try {
  try {
    $ownsMutex = $mutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
  }
  if (-not $ownsMutex) {
    exit 0
  }

  Write-WatcherRecord -Status 'running'
  Write-WatcherLog 'Started. Waiting for Illustrator primary-button transitions.'
  $pointerWasDownInIllustrator = $false
  $missingStateReads = 0

  while ([System.IO.File]::Exists($script:SourcePath)) {
    $state = Read-SymmetryState
    if ($null -eq $state) {
      $missingStateReads += 1
      if ($missingStateReads -ge 60) {
        break
      }
      Start-Sleep -Milliseconds ([Math]::Max($PollMilliseconds, 20))
      continue
    }
    $missingStateReads = 0
    if (-not (Test-StateEnabled -State $state)) {
      break
    }

    $primaryButtonDown = ([FlowCellSymmetryNative]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0
    if ($primaryButtonDown) {
      if (-not $pointerWasDownInIllustrator -and (Test-IllustratorForeground)) {
        $pointerWasDownInIllustrator = $true
        try {
          [void](Invoke-SymmetryRelease -InternalCommand 'process_press')
        } catch {
          Write-WatcherLog "Press baseline failed: $($_.Exception.Message)"
        }
      }
    } elseif ($pointerWasDownInIllustrator) {
      $pointerWasDownInIllustrator = $false
      if (Test-IllustratorForeground) {
        Start-Sleep -Milliseconds ([Math]::Max($CommitDelayMilliseconds, 20))
        try {
          $result = Invoke-SymmetryRelease -InternalCommand 'process_release'
          if ($result -eq 'no-change' -or $result -eq 'no-path') {
            Start-Sleep -Milliseconds 55
            [void](Invoke-SymmetryRelease -InternalCommand 'process_release')
          }
        } catch {
          Write-WatcherLog "Release processing failed: $($_.Exception.Message)"
        }
      }
    }

    Start-Sleep -Milliseconds ([Math]::Max($PollMilliseconds, 8))
  }
} catch {
  Write-WatcherLog "Stopped after an error: $($_.Exception.Message)"
} finally {
  if ($null -ne $script:IllustratorApplication) {
    try {
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($script:IllustratorApplication)
    } catch {
    }
    $script:IllustratorApplication = $null
  }
  if ($ownsMutex) {
    try {
      $mutex.ReleaseMutex()
    } catch {
    }
    Write-WatcherRecord -Status 'stopped'
  }
  $mutex.Dispose()
  if ($ownsMutex) {
    Write-WatcherLog 'Stopped.'
  }
}
