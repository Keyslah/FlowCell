[CmdletBinding()]
param([string]$EvidencePath = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'Send-Lithophane-To-Blender.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('ConvertTo-SingleLineMessage','Write-HandoffStatus','ConvertTo-ExtendedFilePath','Read-HandoffRequest','New-BridgeStatusPath')) {
    $function = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    if ($null -eq $function) { throw "Missing production function $name" }
    Invoke-Expression $function.Extent.Text
}
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('FlowCell-litho-paths-' + [guid]::NewGuid().ToString('N').Substring(0,12))
$utf8 = [Text.UTF8Encoding]::new($false)
$checks = New-Object 'System.Collections.Generic.List[object]'
function Check([bool]$Condition,[string]$Name) {
    if (-not $Condition) { throw "FAIL: $Name" }
    $checks.Add([pscustomobject]@{name=$Name;passed=$true})
}
function Target([string]$Case,[int]$Length,[string]$Leaf) {
    $base = Join-Path $testRoot $Case
    $padding = $Length - ($base.Length + 2 + $Leaf.Length)
    if ($padding -lt 1 -or $padding -gt 240) { throw 'Invalid test path padding.' }
    return Join-Path (Join-Path $base ('a' * $padding)) $Leaf
}
foreach ($length in @(235,330)) {
    $path = Target "status-$length" $length 'lithophane.status.txt'
    $io = ConvertTo-ExtendedFilePath $path
    [void][IO.Directory]::CreateDirectory((ConvertTo-ExtendedFilePath (Split-Path -Parent $path)))
    [IO.File]::WriteAllText($io,'Pending',$utf8)
    Write-HandoffStatus -Path $path -CorrelationId "request-$length" -Status Ok -Message "Created`r`none=mesh." -Count 1
    $ok = [IO.File]::ReadAllText($io)
    Check ($ok.Contains("RequestId=request-$length") -and $ok.Contains('Status=Ok') -and $ok.Contains('ChangedCount=1') -and $ok.Contains('Message=Created one=mesh.')) "Ok replaces Pending at $length characters"
    Write-HandoffStatus -Path $path -CorrelationId "error-$length" -Status Error -Message 'Could not create the mesh.' -Count 0
    $errorText = [IO.File]::ReadAllText($io)
    Check ($errorText.Contains("RequestId=error-$length") -and $errorText.Contains('Status=Error') -and $errorText.Contains('ChangedCount=0')) "Error replaces Ok at $length characters"
    $locked = [IO.File]::Open($io,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    $failed = $false
    try { Write-HandoffStatus -Path $path -CorrelationId 'locked' -Status Ok -Message 'Must not replace.' -Count 1 } catch { $failed = $true } finally { $locked.Dispose() }
    Check ($failed -and [IO.File]::ReadAllText($io) -ceq $errorText) "Locked destination retains exact previous bytes at $length characters"
    $temporary = @([IO.Directory]::GetFiles((ConvertTo-ExtendedFilePath (Split-Path -Parent $path)),'*.tmp'))
    Check ($temporary.Count -eq 0) "Atomic temporary files cleaned after success/error/lock at $length characters"

    $requestPath = Target "request-$length" $length 'lithophane.request.json'
    $requestIo = ConvertTo-ExtendedFilePath $requestPath
    [void][IO.Directory]::CreateDirectory((ConvertTo-ExtendedFilePath (Split-Path -Parent $requestPath)))
    [IO.File]::WriteAllText($requestIo,'{"schemaVersion":1,"requestId":"fixture","widthMm":20,"heightMm":10,"objectName":"QA White Lithophane"}',$utf8)
    $request = Read-HandoffRequest $requestPath
    Check ($request.requestId -ceq 'fixture' -and $request.widthMm -eq 20 -and $request.heightMm -eq 10) "Real JSON request read at $length characters"
    $diagnostic = New-BridgeStatusPath $requestPath
    Check ([IO.File]::Exists($diagnostic) -and [IO.File]::ReadAllBytes($diagnostic).Length -eq 0) "Bridge diagnostic is exclusively reserved at $length characters"
    Check ($diagnostic.Length -le 259) "Bridge diagnostic fits legacy provider at $length characters"
    Set-Content -LiteralPath $diagnostic -Value 'Actual PowerShell provider diagnostic' -Encoding UTF8
    Check ((Get-Content -LiteralPath $diagnostic -Raw).Trim() -ceq 'Actual PowerShell provider diagnostic') "Bridge diagnostic actual Set-Content/Get-Content at $length characters"
    [IO.File]::Delete($diagnostic) # Own short-lived test diagnostic only.
}
$newPath = Target 'new-status' 330 'lithophane.status.txt'
Write-HandoffStatus -Path $newPath -CorrelationId 'new-file' -Status Ok -Message 'Created from absent directory.' -Count 1
Check ([IO.File]::ReadAllText((ConvertTo-ExtendedFilePath $newPath)).Contains('Status=Ok')) 'Absent long directory/status is created successfully'
$relativeRejected = $false
try { Read-HandoffRequest 'relative.json' } catch { $relativeRejected = $true }
Check $relativeRejected 'Relative request path rejected'
Check ((ConvertTo-ExtendedFilePath '\\server\share\request.json') -ceq '\\?\UNC\server\share\request.json') 'UNC conversion retains absolute share semantics without network access'
$result = [pscustomobject]@{status='PASS';powershellVersion=$PSVersionTable.PSVersion.ToString();checks=$checks.ToArray();count=$checks.Count;fixture=$testRoot;sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash;hostOrBridgeInvoked=$false}
if ($EvidencePath) { [IO.File]::WriteAllText($EvidencePath,($result|ConvertTo-Json -Depth 5),$utf8) }
$result | ConvertTo-Json -Depth 5
