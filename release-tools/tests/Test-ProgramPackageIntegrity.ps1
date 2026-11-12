<# Exercises exact payload validation using disposable directories and memory
streams. Does not build, install, launch an application, or create a ZIP. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Stop-Package([string]$Message) { throw $Message }
. (Join-Path $PSScriptRoot '../program-package-safety.ps1')
. (Join-Path $PSScriptRoot '../program-package-integrity.ps1')
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-package-integrity-tests-' + [guid]::NewGuid().ToString('N'))
$script:checks = 0
function Assert([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "FAIL: $Message" }
  $script:checks++
}
function Rejected([scriptblock]$Action, [string]$Pattern) {
  $message = $null
  try { & $Action | Out-Null } catch { $message = $_.Exception.Message }
  Assert ($null -ne $message -and $message -like $Pattern) "Expected '$Pattern'; received '$message'."
}
function Put([string]$Relative, [string]$Text) {
  $path = Join-Path $fixtureRoot $Relative
  [IO.Directory]::CreateDirectory((Split-Path -Parent $path)) | Out-Null
  [IO.File]::WriteAllText($path, $Text, [Text.UTF8Encoding]::new($false))
}
function Clone($Value) { return ($Value | ConvertTo-Json -Depth 20 | ConvertFrom-Json) }
function MemoryEntry([string]$Name, [byte[]]$Bytes) {
  $entry = [pscustomobject]@{FullName=$Name;Length=[long]$Bytes.Length;Data=$Bytes}
  $entry | Add-Member -MemberType ScriptMethod -Name Open -Value { return [IO.MemoryStream]::new($this.Data, $false) }
  return $entry
}
try {
  Put 'flowcell.program.json' '{"programId":"sample"}'
  Put 'Catalog/action.py' 'raise Exception("fixture must never execute")'
  Put 'Support/default-theme.json' '{"fixture":"appearance"}'
  Put 'Support/bridge.ps1' 'throw "fixture must never execute"'
  Put 'assets/skin.txt' ('literal skin ' + [char]0x263a)
  Put 'empty.txt' ''
  $inventory = New-ProgramInventory $fixtureRoot 'sample'
  Assert (@($inventory.files.PSObject.Properties).Count -eq 6) 'Every script, appearance, helper, asset and empty file is inventoried.'
  Assert ($inventory.files.'empty.txt'.bytes -eq 0) 'An empty file has exactly 0 bytes.'
  Assert ($inventory.files.'empty.txt'.sha256 -ceq 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') 'Empty SHA256 is correct.'
  Assert-ProgramDirectoryInventory $fixtureRoot 'sample' $inventory
  $script:checks++
  Rejected { New-ProgramInventory $fixtureRoot 'sample' } '*reserved*'
  Rejected { Assert-ProgramDirectoryInventory $fixtureRoot 'other' } '*header*'

  $original = [IO.File]::ReadAllText((Join-Path $fixtureRoot 'Support/default-theme.json'))
  Put 'Support/default-theme.json' '{"fixture":"changed!!!"}'
  Rejected { Assert-ProgramDirectoryInventory $fixtureRoot 'sample' } '*payload mismatch*default-theme*'
  Put 'Support/default-theme.json' $original
  Put 'extra.txt' 'not inventoried'
  Rejected { Assert-ProgramDirectoryInventory $fixtureRoot 'sample' } '*file count*'
  Remove-Item -LiteralPath (Join-Path $fixtureRoot 'extra.txt') -Force
  $bridge = [IO.File]::ReadAllText((Join-Path $fixtureRoot 'Support/bridge.ps1'))
  Remove-Item -LiteralPath (Join-Path $fixtureRoot 'Support/bridge.ps1') -Force
  Rejected { Assert-ProgramDirectoryInventory $fixtureRoot 'sample' } '*file count*'
  Put 'Support/bridge.ps1' $bridge

  foreach ($path in @('../escape', '/absolute', 'C:/absolute', 'folder\file', 'folder//file', 'folder/./file', 'folder/../file', 'CON.txt', 'folder/trailing.', 'folder/trailing ', 'flowcell.package.json',
      'Panels/action.py', 'Blender Local Scripts/action.py', '.git/config', 'local/settings.json', 'runtime/helper.py', 'private/key.txt',
      'node_modules/helper.js', '__pycache__/cache', 'flowcell.install.json', 'owner.flowcell-source.json', 'nested/RUNTIME/helper.py')) {
    $bad = Clone $inventory
    $bad.files | Add-Member -NotePropertyName $path -NotePropertyValue (Clone $inventory.files.'empty.txt')
    Rejected { Assert-ProgramInventorySchema $bad 'sample' } '*package inventory*'
  }
  $bad = Clone $inventory; $bad.schemaVersion = 2
  Rejected { Assert-ProgramInventorySchema $bad 'sample' } '*header*'
  $bad = Clone $inventory; $bad.schemaVersion = '1'
  Rejected { Assert-ProgramInventorySchema $bad 'sample' } '*header*'
  $bad = Clone $inventory; $bad | Add-Member -NotePropertyName unknown -NotePropertyValue $true
  Rejected { Assert-ProgramInventorySchema $bad 'sample' } '*header*'
  foreach ($value in @(-1, 134217729, 1.5, '3')) {
    $bad = Clone $inventory; $bad.files.'empty.txt'.bytes = $value
    Rejected { Assert-ProgramInventorySchema $bad 'sample' } '*byte count*'
  }
  $bad = Clone $inventory; $bad.files.'empty.txt'.sha256 = $bad.files.'empty.txt'.sha256.ToUpperInvariant()
  Rejected { Assert-ProgramInventorySchema $bad 'sample' } '*digest*'
  $bad = Clone $inventory; $bad.files.PSObject.Properties.Remove('flowcell.program.json')
  Rejected { Assert-ProgramInventorySchema $bad 'sample' } '*missing flowcell.program.json*'

  $entries = @((Get-ProgramInventoryFiles $fixtureRoot).GetEnumerator() | ForEach-Object {
    MemoryEntry "Programs/Sample/$($_.Key)" ([IO.File]::ReadAllBytes($_.Value))
  })
  Assert-ProgramArchiveInventory $entries 'Sample' 'sample' $inventory
  $script:checks++
  Rejected { Assert-ProgramArchiveInventory @($entries | Where-Object { $_.FullName -notlike '*flowcell.package.json' }) 'Sample' 'sample' } '*missing flowcell.package.json*'
  Rejected { Assert-ProgramArchiveInventory @($entries | Where-Object { $_.FullName -notlike '*skin.txt' }) 'Sample' 'sample' } '*file count*'
  Rejected { Assert-ProgramArchiveInventory ($entries + (MemoryEntry 'Programs/Sample/unlisted.txt' ([byte[]]@(1)))) 'Sample' 'sample' } '*file count*'
  Rejected { Assert-ProgramArchiveInventory ($entries + $entries[0]) 'Sample' 'sample' } '*duplicate ZIP entry*'
  Rejected { Assert-ProgramArchiveInventory ($entries + (MemoryEntry 'Programs/Other/file' ([byte[]]@(1)))) 'Sample' 'sample' } '*outside*'
  Rejected { Assert-ProgramArchiveInventory ($entries + (MemoryEntry 'Programs/Sample/runtime/helper.py' ([byte[]]@(1)))) 'Sample' 'sample' } '*private package inventory path*'
  $renamed = @($entries | Where-Object { $_.FullName -notlike '*skin.txt' }) + (MemoryEntry 'Programs/Sample/assets/SKIN.txt' ([IO.File]::ReadAllBytes((Join-Path $fixtureRoot 'assets/skin.txt'))))
  Rejected { Assert-ProgramArchiveInventory $renamed 'Sample' 'sample' } '*payload mismatch*'
  $altered = @($entries | Where-Object { $_.FullName -notlike '*bridge.ps1' }) + (MemoryEntry 'Programs/Sample/Support/bridge.ps1' ([Text.Encoding]::UTF8.GetBytes('tampered')))
  Rejected { Assert-ProgramArchiveInventory $altered 'Sample' 'sample' } '*payload mismatch*'
  $expected = Clone $inventory; $expected.files.'Support/bridge.ps1'.sha256 = '0' * 64
  Rejected { Assert-ProgramArchiveInventory $entries 'Sample' 'sample' $expected } '*payload mismatch*'
  Put 'copy-source/action.py' 'exact bytes'
  Put 'copy-target/action.py' 'exact bytes'
  Assert-ProgramCopiedFiles (Join-Path $fixtureRoot 'copy-source') (Join-Path $fixtureRoot 'copy-target') @('Programs/Sample/action.py') 'Sample'
  $script:checks++
  Put 'copy-target/action.py' 'wrong bytes'
  Rejected { Assert-ProgramCopiedFiles (Join-Path $fixtureRoot 'copy-source') (Join-Path $fixtureRoot 'copy-target') @('Programs/Sample/action.py') 'Sample' } '*Copied program bytes differ*'
  Put 'copy-source/.profile-sources/saved/flowcell.script.json' '{"source":"exact.py"}'
  Put 'copy-source/.profile-sources/saved/exact.py' 'fresh installed source'
  $baseline = Get-ProgramCatalogBaseline (Join-Path $fixtureRoot 'copy-source') 'sample'
  Assert ($baseline.files.Count -eq 3) 'Catalog baseline includes tracked input and both newly generated profile source files.'
  $expectedHash = (Get-FileHash -LiteralPath (Join-Path $fixtureRoot 'copy-source/.profile-sources/saved/exact.py') -Algorithm SHA256).Hash.ToLowerInvariant()
  Assert ($baseline.files['.profile-sources/saved/exact.py'] -ceq $expectedHash) 'Generated profile source bytes have their own exact catalog hash.'
  Write-Output "Program package integrity: $($script:checks) checks passed; 0 ZIPs created."
} finally {
  $resolved = [IO.Path]::GetFullPath($fixtureRoot).TrimEnd('\', '/')
  $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolved) -notmatch '^flowcell-package-integrity-tests-[0-9a-f]{32}$') { throw 'Unsafe fixture cleanup path.' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
