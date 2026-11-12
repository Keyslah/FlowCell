# Full payload integrity shared by the release producer and verifier. This is a
# byte inventory, not a signature or a substitute for live-profile parity checks.
Set-StrictMode -Version Latest

function Assert-ProgramInventoryPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path.Length -gt 4096 -or
      $Path -match '[\\:\x00-\x1f\x7f<>"|?*]' -or $Path.StartsWith('/') -or $Path.EndsWith('/')) {
    Stop-Package "Unsafe package inventory path: $Path"
  }
  foreach ($part in $Path.Split('/')) {
    if (-not $part -or $part -in @('.', '..') -or $part.Length -gt 255 -or
        $part.EndsWith('.') -or $part.EndsWith(' ') -or
        $part -match '^(?i:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)') {
      Stop-Package "Unsafe package inventory path: $Path"
    }
    # Match Expand-FlowCellProgramPackage.ps1's segment policy exactly. A ZIP
    # that its recipient must reject must never pass release verification.
    if ($part -ieq 'Panels' -or $part -ilike '* Local Scripts' -or
        $part -in @('.git', 'local', 'runtime', 'private', 'node_modules', '__pycache__', 'flowcell.install.json') -or
        $part -ilike '*.flowcell-source.json') {
      Stop-Package "Mutable or private package inventory path: $Path"
    }
  }
}

function Get-ProgramInventoryFiles([string]$ProgramRoot) {
  $root = [IO.Path]::GetFullPath($ProgramRoot).TrimEnd('\', '/')
  Assert-NoReparsePathComponents $root $root 'Program inventory root'
  if (-not (Test-Path -LiteralPath $root -PathType Container)) { Stop-Package 'Program inventory root is missing.' }
  $prefix = $root + [IO.Path]::DirectorySeparatorChar
  $files = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase)
  $pending = New-Object 'System.Collections.Generic.Stack[string]'
  $pending.Push($root)
  while ($pending.Count -gt 0) {
    foreach ($entry in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
      if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Package "Package inventory rejects links: $($entry.FullName)" }
      $full = [IO.Path]::GetFullPath($entry.FullName)
      if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { Stop-Package 'Package inventory escaped its root.' }
      $relative = $full.Substring($prefix.Length).Replace('\', '/')
      Assert-ProgramInventoryPath $relative
      if ($entry.PSIsContainer) { $pending.Push($full); continue }
      if ($files.ContainsKey($relative)) { Stop-Package "Case-colliding package inventory file: $relative" }
      $files.Add($relative, $full)
      if ($files.Count -gt 25001) { Stop-Package 'Package inventory exceeds 25000 payload files.' }
    }
  }
  return $files
}

function Get-ProgramInventoryDigest([IO.Stream]$Stream) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $buffer = New-Object byte[] 65536
    $bytes = 0L
    while (($read = $Stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $bytes += $read
      if ($bytes -gt 134217728) { Stop-Package 'Package inventory file exceeds 128 MiB.' }
      [void]$sha.TransformBlock($buffer, 0, $read, $buffer, 0)
    }
    [void]$sha.TransformFinalBlock([byte[]]@(), 0, 0)
    return [pscustomobject]@{sha256=([BitConverter]::ToString($sha.Hash)).Replace('-', '').ToLowerInvariant();bytes=$bytes}
  } finally { $sha.Dispose() }
}

function Assert-ProgramInventorySchema($Inventory, [string]$ProgramId) {
  if ($null -eq $Inventory -or $Inventory -isnot [pscustomobject] -or
      @($Inventory.PSObject.Properties.Name | Where-Object { $_ -notin @('schemaVersion', 'programId', 'files') }).Count -gt 0 -or
      -not $Inventory.PSObject.Properties['schemaVersion'] -or ($Inventory.schemaVersion -isnot [int] -and $Inventory.schemaVersion -isnot [long]) -or $Inventory.schemaVersion -ne 1 -or
      -not $Inventory.PSObject.Properties['programId'] -or $Inventory.programId -isnot [string] -or $Inventory.programId -cne $ProgramId -or
      -not $Inventory.PSObject.Properties['files'] -or $Inventory.files -isnot [pscustomobject]) {
    Stop-Package 'Unsupported or mismatched package inventory header.'
  }
  $properties = @($Inventory.files.PSObject.Properties)
  if ($properties.Count -lt 1 -or $properties.Count -gt 25000) { Stop-Package 'Package inventory requires 1 to 25000 files.' }
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $payloadBytes = 0L
  foreach ($property in $properties) {
    Assert-ProgramInventoryPath $property.Name
    if ($property.Name -ieq 'flowcell.package.json' -or -not $seen.Add($property.Name)) { Stop-Package "Invalid or duplicate package inventory file: $($property.Name)" }
    $entry = $property.Value
    if ($null -eq $entry -or $entry -isnot [pscustomobject] -or @($entry.PSObject.Properties).Count -ne 2 -or
        -not $entry.PSObject.Properties['sha256'] -or $entry.sha256 -isnot [string] -or $entry.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
        -not $entry.PSObject.Properties['bytes'] -or ($entry.bytes -isnot [int] -and $entry.bytes -isnot [long]) -or
        $entry.bytes -lt 0 -or $entry.bytes -gt 134217728) {
      Stop-Package "Invalid package inventory digest or byte count: $($property.Name)"
    }
    $payloadBytes += $entry.bytes
    if ($payloadBytes -gt 1073741824) { Stop-Package 'Package inventory exceeds 1024 MiB.' }
  }
  if (-not $seen.Contains('flowcell.program.json')) { Stop-Package 'Package inventory is missing flowcell.program.json.' }
}

function Assert-ProgramInventoryRecords($Expected, $Actual, [string]$ProgramId) {
  Assert-ProgramInventorySchema $Expected $ProgramId
  Assert-ProgramInventorySchema $Actual $ProgramId
  $expectedEntries = @($Expected.files.PSObject.Properties)
  if ($expectedEntries.Count -ne @($Actual.files.PSObject.Properties).Count) { Stop-Package 'Package inventory file count differs from the expected payload.' }
  foreach ($entry in $expectedEntries) {
    $actualEntry = $Actual.files.PSObject.Properties[$entry.Name]
    if ($null -eq $actualEntry -or $actualEntry.Name -cne $entry.Name -or
        $actualEntry.Value.sha256 -cne $entry.Value.sha256 -or $actualEntry.Value.bytes -ne $entry.Value.bytes) {
      Stop-Package "Package inventory payload mismatch: $($entry.Name)"
    }
  }
}

function Read-ProgramInventoryText([string]$Text) {
  if ([Text.Encoding]::UTF8.GetByteCount($Text) -gt 16777216) { Stop-Package 'Package inventory exceeds 16 MiB.' }
  try { return ($Text | ConvertFrom-Json) }
  catch { Stop-Package "Invalid package inventory JSON: $($_.Exception.Message)" }
}

function Assert-ProgramCopiedFiles([string]$SourceRoot, [string]$DestinationRoot, [string[]]$TrackedFiles, [string]$ProgramName) {
  $prefix = "Programs/$ProgramName/"
  foreach ($tracked in $TrackedFiles) {
    if (-not $tracked.StartsWith($prefix, [StringComparison]::Ordinal)) { Stop-Package "Copied program path escaped its source: $tracked" }
    $relative = $tracked.Substring($prefix.Length)
    Assert-ProgramInventoryPath $relative
    $sourcePath = Join-Path $SourceRoot $relative
    $destinationPath = Join-Path $DestinationRoot $relative
    Assert-NoReparsePathComponents $SourceRoot $sourcePath 'Copied program source'
    Assert-NoReparsePathComponents $DestinationRoot $destinationPath 'Copied program destination'
    $sourceStream = [IO.File]::OpenRead($sourcePath)
    try { $expected = Get-ProgramInventoryDigest $sourceStream } finally { $sourceStream.Dispose() }
    $destinationStream = [IO.File]::OpenRead($destinationPath)
    try { $actual = Get-ProgramInventoryDigest $destinationStream } finally { $destinationStream.Dispose() }
    if ($expected.sha256 -cne $actual.sha256 -or $expected.bytes -ne $actual.bytes) { Stop-Package "Copied program bytes differ from source: $relative" }
  }
}

function Get-ProgramCatalogBaseline([string]$CatalogRoot, [string]$ProgramId) {
  $files = Get-ProgramInventoryFiles $CatalogRoot
  if ($files.Count -eq 0) { Stop-Package "Empty catalog: $ProgramId" }
  $hashes = [ordered]@{}
  foreach ($relative in @($files.Keys | Sort-Object)) {
    $stream = [IO.File]::OpenRead($files[$relative])
    try { $hashes[$relative] = (Get-ProgramInventoryDigest $stream).sha256 }
    finally { $stream.Dispose() }
  }
  return [pscustomobject]@{schemaVersion=1;programId=$ProgramId;files=$hashes}
}

function New-ProgramInventory([string]$ProgramRoot, [string]$ProgramId) {
  $files = Get-ProgramInventoryFiles $ProgramRoot
  if ($files.ContainsKey('flowcell.package.json')) { Stop-Package 'flowcell.package.json is reserved for the generated package inventory.' }
  $records = [ordered]@{}
  foreach ($relative in @($files.Keys | Sort-Object)) {
    $stream = [IO.File]::OpenRead($files[$relative])
    try { $records[$relative] = Get-ProgramInventoryDigest $stream } finally { $stream.Dispose() }
  }
  $inventory = [pscustomobject]@{schemaVersion=1;programId=$ProgramId;files=[pscustomobject]$records}
  Assert-ProgramInventorySchema $inventory $ProgramId
  $text = ($inventory | ConvertTo-Json -Depth 8) + "`n"
  if ([Text.Encoding]::UTF8.GetByteCount($text) -gt 16777216) { Stop-Package 'Package inventory exceeds 16 MiB.' }
  [IO.File]::WriteAllText((Join-Path $ProgramRoot 'flowcell.package.json'), $text, [Text.UTF8Encoding]::new($false))
  return $inventory
}

function Assert-ProgramDirectoryInventory([string]$ProgramRoot, [string]$ProgramId, $ExpectedInventory = $null) {
  $files = Get-ProgramInventoryFiles $ProgramRoot
  if (-not $files.ContainsKey('flowcell.package.json')) { Stop-Package 'Program package is missing flowcell.package.json.' }
  $inventoryPath = $files['flowcell.package.json']
  if ([IO.FileInfo]::new($inventoryPath).Length -gt 16777216) { Stop-Package 'Package inventory exceeds 16 MiB.' }
  $inventory = Read-ProgramInventoryText ([IO.File]::ReadAllText($inventoryPath))
  Assert-ProgramInventorySchema $inventory $ProgramId
  if ($null -ne $ExpectedInventory) { Assert-ProgramInventoryRecords $ExpectedInventory $inventory $ProgramId }
  $records = [ordered]@{}
  foreach ($relative in @($files.Keys | Sort-Object)) {
    if ($relative -ceq 'flowcell.package.json') { continue }
    $stream = [IO.File]::OpenRead($files[$relative])
    try { $records[$relative] = Get-ProgramInventoryDigest $stream } finally { $stream.Dispose() }
  }
  Assert-ProgramInventoryRecords $inventory ([pscustomobject]@{schemaVersion=1;programId=$ProgramId;files=[pscustomobject]$records}) $ProgramId
}

# Accepts an archive's entry collection so tests can exercise the same validator
# with memory streams without creating any ZIP files.
function Assert-ProgramArchiveInventory($Entries, [string]$ProgramName, [string]$ProgramId, $ExpectedInventory = $null) {
  $prefix = "Programs/$ProgramName/"
  $files = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::OrdinalIgnoreCase)
  if (@($Entries).Count -lt 1 -or @($Entries).Count -gt 25000) { Stop-Package 'Program ZIP must contain 1 to 25000 entries.' }
  $expandedBytes = 0L
  foreach ($entry in $Entries) {
    $name = [string]$entry.FullName
    if ($entry.Length -lt 0 -or $entry.Length -gt 134217728) { Stop-Package 'Program ZIP entry exceeds 128 MiB.' }
    $expandedBytes += $entry.Length
    if ($expandedBytes -gt 1073741824) { Stop-Package 'Expanded Program ZIP exceeds 1024 MiB.' }
    if ($name.EndsWith('/')) { continue }
    if (-not $name.StartsWith($prefix, [StringComparison]::Ordinal)) { Stop-Package "Package inventory found an outside or differently cased ZIP entry: $name" }
    $relative = $name.Substring($prefix.Length)
    Assert-ProgramInventoryPath $relative
    if ($files.ContainsKey($relative)) { Stop-Package "Package inventory found a duplicate ZIP entry: $relative" }
    $files.Add($relative, $entry)
  }
  if (-not $files.ContainsKey('flowcell.package.json')) { Stop-Package 'Program ZIP is missing flowcell.package.json.' }
  if ($files['flowcell.package.json'].Length -gt 16777216) { Stop-Package 'Package inventory exceeds 16 MiB.' }
  $reader = [IO.StreamReader]::new($files['flowcell.package.json'].Open())
  try { $inventory = Read-ProgramInventoryText ($reader.ReadToEnd()) } finally { $reader.Dispose() }
  Assert-ProgramInventorySchema $inventory $ProgramId
  if ($null -ne $ExpectedInventory) { Assert-ProgramInventoryRecords $ExpectedInventory $inventory $ProgramId }
  $records = [ordered]@{}
  foreach ($relative in @($files.Keys | Sort-Object)) {
    if ($relative -ceq 'flowcell.package.json') { continue }
    $stream = $files[$relative].Open()
    try { $records[$relative] = Get-ProgramInventoryDigest $stream } finally { $stream.Dispose() }
    if ($records[$relative].bytes -ne $files[$relative].Length) { Stop-Package "Package inventory ZIP length mismatch: $relative" }
  }
  Assert-ProgramInventoryRecords $inventory ([pscustomobject]@{schemaVersion=1;programId=$ProgramId;files=[pscustomobject]$records}) $ProgramId
}

function Assert-ProgramZipInventory([string]$ZipPath, [string]$ProgramName, [string]$ProgramId, $ExpectedInventory = $null) {
  if ([IO.FileInfo]::new($ZipPath).Length -gt 536870912) { Stop-Package 'Program ZIP exceeds 512 MiB.' }
  $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
  try { Assert-ProgramArchiveInventory $archive.Entries $ProgramName $ProgramId $ExpectedInventory }
  finally { $archive.Dispose() }
}
