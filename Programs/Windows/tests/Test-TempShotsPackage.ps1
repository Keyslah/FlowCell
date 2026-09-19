$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$windowsRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $windowsRoot)
$sourcePath = Join-Path $windowsRoot 'Windows Git Scripts\Utility\Temp Shots\Temp Shots.ps1'
$backendPath = Join-Path $repoRoot 'flowcellbackend\FlowCellBackend.ahk'
$helperPath = Join-Path $repoRoot 'flowcellbackend\helpers\TempShotsCapture.ahk'
$testScriptPath = Join-Path $PSScriptRoot 'Test-TempShotsCapture.ahk'
$script:Assertions = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
    $script:Assertions++
}

function Get-AhkMethod {
    param([string]$Text, [string]$Name)
    $pattern = '(?ms)^    (?:static )?' + [regex]::Escape($Name) + '\([^\r\n]*\) \{.*?(?=^    (?:static )?\w+\([^\r\n]*\) \{|^\})'
    $match = [regex]::Match($Text, $pattern)
    if (-not $match.Success) { throw "Missing AHK method: $Name" }
    return $match.Value
}

# Inspect source only: no package main, IPC request, capture or real clipboard.
$tokens = $null
$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
Assert-True (@($parseErrors).Count -eq 0) 'The Temp Shots package has PowerShell parse errors.'
$source = [IO.File]::ReadAllText($sourcePath)
$backend = [IO.File]::ReadAllText($backendPath)
$helper = [IO.File]::ReadAllText($helperPath)
$captureTests = [IO.File]::ReadAllText($testScriptPath)
$hotkey = Get-AhkMethod $backend 'HandleTempShotsShortcutInvocation'
$panel = Get-AhkMethod $backend 'RunBoundScript'
$route = Get-AhkMethod $backend 'RunTempShotsScript'
$direct = Get-AhkMethod $backend 'TryLaunchTempShotsFast'
$start = Get-AhkMethod $helper 'Start'
$poll = Get-AhkMethod $helper 'Poll'
$finish = Get-AhkMethod $helper 'Finish'
$cancel = Get-AhkMethod $helper 'Cancel'
$cleanup = Get-AhkMethod $helper 'Cleanup'
$save = Get-AhkMethod $helper 'SaveBitmapArea'
$createDib = Get-AhkMethod $helper 'CreateClipboardDib'
$publish = Get-AhkMethod $helper 'WriteClipboardImage'

Assert-True ($backend.Contains('#Include helpers\TempShotsCapture.ahk')) 'The backend does not load its direct capture helper.'
Assert-True ($hotkey.Contains('this.RunTempShotsScript(scriptPath)')) 'The hotkey bypasses the shared Temp Shots route.'
Assert-True ($panel -match 'if this\.IsTempShotsScript\(scriptPath\)\s+return this\.RunTempShotsScript\(scriptPath\)') 'The panel does not use the same route as the hotkey.'
Assert-True ($route.Contains('this.TryLaunchTempShotsFast(launcherPath)')) 'The shared route does not select direct capture.'
Assert-True ($direct.Contains('FlowCellTempShotsCapture()')) 'Direct capture is not owned by the resident backend.'
Assert-True ($direct.Contains('this.tempShotsCapture.Start(folder,')) 'Direct capture does not receive the configured folder.'
Assert-True ($direct.Contains('this.ReadTempShotsFastFolder()')) 'Direct capture does not resolve the Temp Shots folder.'
Assert-True ($direct.Contains('temp_shots_direct_capture')) 'Direct capture has no distinct runtime method marker.'
Assert-True ($source.Contains("command = 'run_script_now'") -and $source.Contains('SendMessageTimeout')) 'The package does not relay to the resident backend.'
Assert-True ($source.Contains('scriptPath = Join-Path $PSScriptRoot ''Temp_Shots.vbs''')) 'The relay does not retain the owned package launcher.'
Assert-True (-not ($source -match 'Wait-ForClipboardScreenshot|GetClipboardSequenceNumber|SaveStartedSnip|InitialSequence')) 'The obsolete asynchronous clipboard saver remains.'

$capturePath = $source + $route + $direct + $helper
foreach ($forbidden in @('ms-screenclip:', 'SnippingTool(?:\.exe)?', 'SendInput\s+["''][^"'']*#\+s', 'FileRecycle', 'RecycleBin', 'SHFileOperation', 'DeleteFile', 'FileDelete', 'FileMove', 'MoveFile', 'Remove-CurrentTempShotNativeDuplicate', 'Get-WindowsScreenshotsFolder', 'GetClipboard', 'OnClipboardChange')) {
    Assert-True (-not ($capturePath -match $forbidden)) "Temp Shots still invokes a native save, duplicate cleanup, or clipboard-reader path: $forbidden"
}
Assert-True ($start.IndexOf('CaptureDesktop(') -ge 0 -and $start.IndexOf('CaptureDesktop(') -lt $start.IndexOf('Gui(')) 'The desktop is not frozen before creating the selection window.'
Assert-True (-not ($start -match 'Sleep\s+\d+')) 'The selection adds a pre-capture delay.'
Assert-True ($start.Contains('OnEvent("Escape", this.escape)')) 'The selection window does not support Escape.'
Assert-True ($start.Contains('Hotkey "*Escape", this.escape, "On"')) 'Escape is not available while a capture selection exists.'
Assert-True ($poll.Contains('GetKeyState("Escape", "P")') -and $poll.Contains('this.Cancel()')) 'The selection polling fallback cannot cancel on Escape.'
Assert-True ($cancel.Contains('this.Cleanup()')) 'Cancellation does not release the selection resources.'
Assert-True (-not ($cancel -match 'SaveBitmapArea|NextPath|FileAppend|Clipboard')) 'Cancellation can save or copy an image.'
foreach ($required in @('this.active := false', 'SetTimer this.timer, 0', 'Hotkey "*Escape", "Off"', 'OnMessage(0x20, this.cursorHandler, 0)', 'this.window.Destroy()', 'gdi32\DeleteObject', 'this.bitmap := 0')) {
    Assert-True ($cleanup.Contains($required)) "Selection cleanup is missing: $required"
}
Assert-True ($finish.Contains('NextPath(this.folder)')) 'Completed captures are not saved into the selected folder.'
Assert-True ([regex]::Matches($finish, 'SaveBitmapArea\(').Count -eq 1) 'Completion does not have exactly one image save call.'
Assert-True ($finish -match 'ObjBindMethod\(FlowCellTempShotsCapture,\s*"WriteClipboardImage",\s*this\.window\.Hwnd\)') 'Completed captures are not copied as clipboard images through the native writer.'
Assert-True ([regex]::Matches($save, 'DllCall\("gdiplus\\GdipSaveImageToFile"').Count -eq 1) 'The PNG writer does not call the encoder exactly once.'
Assert-True ($save.Contains('GdipCloneBitmapAreaI')) 'The PNG writer does not crop the in-memory bitmap.'
Assert-True ($save -match 'clipboardWriter\s*:=\s*0' -and $save.Contains('IsObject(clipboardWriter)')) 'The synthetic capture cannot replace clipboard publication with a mock.'
Assert-True ($save.IndexOf('GdipSaveImageToFile') -lt $save.IndexOf('clipboardWriter.Call(')) 'Clipboard publication can run before the sole image file is saved.'
Assert-True ($save.Contains('CreateClipboardDib(cropped, rect.width, rect.height)')) 'The clipboard image is not made from the same crop as the destination image.'
Assert-True ($save -match 'FileRead\(path,\s*["'']RAW["'']\)') 'Clipboard PNG bytes do not come from the completed destination image.'
Assert-True ($createDib.Contains('GetDIBits')) 'The clipboard payload does not contain bitmap pixels.'
Assert-True ($publish.Contains('SetClipboardData')) 'The clipboard writer does not publish native image data.'
Assert-True ($publish.Contains('RegisterClipboardFormatW') -and $publish.Contains('"PNG"')) 'The clipboard writer does not publish a PNG image format.'
Assert-True (-not ($publish -match 'CF_HDROP|A_Clipboard\s*:=|Clipboard\s*:=')) 'The capture is copied as a path or text instead of an image.'
Assert-True (-not ($captureTests -match '\.Start\(|\.CaptureDesktop\(|\\GetDC["'']|\\BitBlt["'']|GetClipboard|SendMessage|WinActivate|Gui\(|\\(?:OpenClipboard|EmptyClipboard|SetClipboardData|CloseClipboard)["'']|\.WriteClipboardImage\(')) 'The offline test contains an interactive capture, real clipboard, or desktop operation.'
Assert-True ($captureTests.Contains('CreateDIBSection')) 'The pixel test is not based on a synthetic in-memory bitmap.'
Assert-True ($captureTests.Contains('SyntheticClipboardWriter') -and $captureTests.Contains('AssertClipboardImage')) 'Clipboard image payloads have no synthetic regression checks.'

$ahkExe = 'C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe'
if (-not (Test-Path -LiteralPath $ahkExe -PathType Leaf)) { throw "AutoHotkey v2 test runtime not found: $ahkExe" }
Add-Type -AssemblyName System.Drawing
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-temp-shots-tests-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
try {
    $stdout = Join-Path $testRoot 'stdout.txt'
    $stderr = Join-Path $testRoot 'stderr.txt'
    $arguments = '/ErrorStdOut "{0}" "{1}"' -f $testScriptPath, $testRoot
    $process = Start-Process -FilePath $ahkExe -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $output = [IO.File]::ReadAllText($stdout)
    $errors = [IO.File]::ReadAllText($stderr)
    Assert-True ($process.ExitCode -eq 0) ("Synthetic AHK checks failed (exit {0}): {1} {2}" -f $process.ExitCode, $output, $errors)
    Assert-True ($output -match 'Synthetic Temp Shots checks passed: \d+ assertions') 'The synthetic AHK checks did not finish.'
    $captureFolder = Join-Path $testRoot 'capture'
    $outputs = @(Get-ChildItem -LiteralPath $captureFolder -File)
    Assert-True ($outputs.Count -eq 1 -and $outputs[0].Name -ceq 'temp-shot-synthetic.png') 'A synthetic completed capture produced something other than exactly one destination file.'
    $bitmap = [Drawing.Bitmap]::FromFile($outputs[0].FullName)
    try {
        Assert-True ($bitmap.Width -eq 4 -and $bitmap.Height -eq 3) 'The synthetic crop has incorrect dimensions.'
        Assert-True ($bitmap.RawFormat.Guid -eq [Drawing.Imaging.ImageFormat]::Png.Guid) 'The saved image is not a PNG.'
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
            for ($x = 0; $x -lt $bitmap.Width; $x++) {
                $pixel = $bitmap.GetPixel($x, $y)
                Assert-True ($pixel.R -eq 204 -and $pixel.G -eq 68 -and $pixel.B -eq 34 -and $pixel.A -eq 255) "The synthetic crop has incorrect pixels at $x,$y."
            }
        }
    }
    finally { $bitmap.Dispose() }
    $paddedOutputs = @(Get-ChildItem -LiteralPath (Join-Path $testRoot 'padded') -File)
    Assert-True ($paddedOutputs.Count -eq 1) 'A padded-row synthetic capture did not produce exactly one image file.'
    $paddedBitmap = [Drawing.Bitmap]::FromFile($paddedOutputs[0].FullName)
    try {
        Assert-True ($paddedBitmap.Width -eq 3 -and $paddedBitmap.Height -eq 2) 'The padded-row destination image has incorrect dimensions.'
        Assert-True ($paddedBitmap.RawFormat.Guid -eq [Drawing.Imaging.ImageFormat]::Png.Guid) 'The padded-row destination is not a PNG image.'
        for ($y = 0; $y -lt $paddedBitmap.Height; $y++) {
            for ($x = 0; $x -lt $paddedBitmap.Width; $x++) {
                $pixel = $paddedBitmap.GetPixel($x, $y)
                Assert-True ($pixel.R -eq 204 -and $pixel.G -eq 68 -and $pixel.B -eq 34 -and $pixel.A -eq 255) "The padded-row destination has incorrect pixels at $x,$y."
            }
        }
    }
    finally { $paddedBitmap.Dispose() }
    Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $testRoot 'cancel') -File).Count -eq 0) 'Cancelling an unstarted synthetic capture wrote a file.'
    $output.Trim()
}
finally {
    # Only this invocation's unique, short-lived fixture tree may be removed.
    $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
    $tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedRoot.StartsWith($tempParent + 'flowcell-temp-shots-tests-', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean unexpected fixture directory: $resolvedRoot"
    }
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
}

"Temp Shots package checks passed: $script:Assertions assertions. Only synthetic pixels, an in-memory clipboard mock, and disposable test fixtures were used; no desktop capture, real clipboard, application windows, or existing screenshots were touched."
