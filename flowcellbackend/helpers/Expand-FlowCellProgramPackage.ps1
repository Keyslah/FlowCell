# Extract data only. Program scripts are never loaded or executed by this helper.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ArchivePath,
    [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$maximumArchiveBytes = 536870912L
$maximumExpandedBytes = 1073741824L
$maximumFileBytes = 134217728L
$maximumEntries = 25000

function Assert-PlainPath([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Program ZIP paths cannot pass through a link or reparse point.'
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Assert-Segment([string]$Part) {
    if (-not $Part -or $Part -in @('.', '..') -or $Part.EndsWith('.') -or $Part.EndsWith(' ') -or
        $Part.Length -gt 255 -or $Part -match '[\x00-\x1f\x7f<>:"|?*]' -or
        $Part -match '^(?i:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)') {
        throw "Program ZIP contains an unsafe path component: $Part"
    }
    if ($Part -ieq 'Panels' -or $Part -ilike '* Local Scripts' -or
        $Part -in @('.git', 'local', 'runtime', 'private', 'node_modules', '__pycache__', 'flowcell.install.json') -or
        $Part -ilike '*.flowcell-source.json') {
        throw "Program ZIP contains mutable or private runtime state: $Part"
    }
}

$archiveFull = [IO.Path]::GetFullPath($ArchivePath)
$destinationFull = [IO.Path]::GetFullPath($Destination)
Assert-PlainPath $archiveFull
Assert-PlainPath $destinationFull
if (-not [IO.File]::Exists($archiveFull) -or (Get-Item -LiteralPath $archiveFull).Length -gt $maximumArchiveBytes) {
    throw 'Choose a program ZIP no larger than 512 MiB.'
}
if (Test-Path -LiteralPath $destinationFull) { throw 'Program ZIP staging destination must not already exist.' }

$archive = [IO.Compression.ZipFile]::OpenRead($archiveFull)
try {
    if ($archive.Entries.Count -eq 0 -or $archive.Entries.Count -gt $maximumEntries) {
        throw 'Program ZIP must contain between 1 and 25000 entries.'
    }
    $paths = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase)
    $kinds = New-Object 'System.Collections.Generic.Dictionary[string,bool]' ([StringComparer]::OrdinalIgnoreCase)
    $explicit = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $entries = New-Object 'System.Collections.Generic.List[object]'
    $programName = $null
    $expandedBytes = 0L
    $hasManifest = $false
    foreach ($entry in $archive.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        if ($name.Length -gt 4096 -or $name.StartsWith('/')) { throw 'Program ZIP contains an absolute or oversized path.' }
        $isDirectory = $name.EndsWith('/')
        $relative = if ($isDirectory) { $name.Substring(0, $name.Length - 1) } else { $name }
        $parts = @($relative.Split('/'))
        foreach ($part in $parts) { Assert-Segment $part }
        if ($parts[0] -cne 'Programs' -or ($parts.Count -lt 3 -and -not $isDirectory)) {
            throw 'Choose a program ZIP containing Programs/<Program>/flowcell.program.json.'
        }
        if ($parts.Count -ge 2) {
            if ($parts[1] -cne $parts[1].Trim()) { throw 'Program folder names cannot begin or end with whitespace.' }
            if ($null -eq $programName) { $programName = $parts[1] }
            elseif ($programName -cne $parts[1]) { throw 'A program ZIP must contain exactly one program folder with consistent casing.' }
        }
        if (-not $explicit.Add($relative)) { throw "Program ZIP contains duplicate or case-colliding entries: $relative" }
        for ($index = 0; $index -lt $parts.Count; $index++) {
            $prefix = ($parts[0..$index] -join '/')
            $directory = $index -lt ($parts.Count - 1) -or $isDirectory
            if ($paths.ContainsKey($prefix)) {
                if ($paths[$prefix] -cne $prefix -or $kinds[$prefix] -ne $directory) {
                    throw "Program ZIP contains colliding file/directory paths: $relative"
                }
            } else { $paths.Add($prefix, $prefix); $kinds.Add($prefix, $directory) }
        }
        $attributes = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$entry.ExternalAttributes), 0)
        $unixType = ($attributes -shr 16) -band 61440
        if (($attributes -band 1088) -ne 0 -or (($attributes -band 16) -ne 0 -and -not $isDirectory) -or $unixType -notin @(0, 16384, 32768) -or
            ($unixType -eq 16384 -and -not $isDirectory) -or ($unixType -eq 32768 -and $isDirectory)) {
            throw "Program ZIP contains a link, device, or special file: $relative"
        }
        if ($entry.Length -lt 0 -or $entry.Length -gt $maximumFileBytes -or ($isDirectory -and $entry.Length -ne 0)) {
            throw 'Program ZIP entries must be ordinary files no larger than 128 MiB.'
        }
        $expandedBytes += $entry.Length
        if ($expandedBytes -gt $maximumExpandedBytes) { throw 'Expanded program ZIP exceeds 1024 MiB.' }
        if ($parts.Count -eq 3 -and $parts[2] -ceq 'flowcell.program.json' -and -not $isDirectory) { $hasManifest = $true }
        $entries.Add([pscustomobject]@{ Entry=$entry; Relative=$relative; Directory=$isDirectory })
    }
    if (-not $programName -or -not $hasManifest) { throw 'Program ZIP is missing Programs/<Program>/flowcell.program.json.' }

    [IO.Directory]::CreateDirectory($destinationFull) | Out-Null
    $destinationPrefix = $destinationFull.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $buffer = New-Object byte[] 65536
    foreach ($item in $entries) {
        $target = [IO.Path]::GetFullPath((Join-Path $destinationFull $item.Relative))
        if (-not $target.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Program ZIP escaped staging.' }
        Assert-PlainPath $target
        if ($item.Directory) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        Assert-PlainPath $target
        $inputStream = $item.Entry.Open()
        try {
            $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $written = 0L
                while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $written += $read
                    if ($written -gt $item.Entry.Length -or $written -gt $maximumFileBytes) { throw 'Program ZIP entry exceeded its declared size.' }
                    $outputStream.Write($buffer, 0, $read)
                }
                if ($written -ne $item.Entry.Length) { throw 'Program ZIP entry was truncated.' }
            } finally { $outputStream.Dispose() }
        } finally { $inputStream.Dispose() }
    }
    @{ programName=$programName } | ConvertTo-Json -Compress
} finally { $archive.Dispose() }
