[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$helper = Join-Path (Split-Path -Parent $PSScriptRoot) 'Expand-FlowCellProgramPackage.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-zip-tests-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$script:passed = 0
$manifest = @{ Name='Programs/Sample/flowcell.program.json'; Text='{}' }

function New-TestZip([string]$Name, [object[]]$Entries) {
    $path = Join-Path $testRoot ($Name + '.zip')
    $archive = [IO.Compression.ZipFile]::Open($path, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($definition in $Entries) {
            $entry = $archive.CreateEntry($definition.Name)
            if ($definition.ContainsKey('Attributes')) { $entry.ExternalAttributes = $definition.Attributes }
            if (-not $definition.Name.EndsWith('/')) {
                $stream = $entry.Open()
                try {
                    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$definition.Text)
                    $stream.Write($bytes, 0, $bytes.Length)
                } finally { $stream.Dispose() }
            }
        }
    } finally { $archive.Dispose() }
    return $path
}

function Assert-Rejected([string]$Name, [object[]]$Entries, [string]$Expected) {
    $path = New-TestZip $Name $Entries
    $destination = Join-Path $testRoot ($Name + '-out')
    $failure = $null
    try { & $helper -ArchivePath $path -Destination $destination | Out-Null }
    catch { $failure = $_.Exception.Message }
    if (-not $failure -or $failure -notlike ('*' + $Expected + '*')) { throw "$Name expected '$Expected', received '$failure'" }
    if (Test-Path -LiteralPath $destination) { throw "$Name created output before metadata validation completed." }
    $script:passed++
}

try {
    $archive = New-TestZip 'valid' @(@{Name='Programs/';Text=''}, @{Name='Programs/Sample/';Text=''}, $manifest,
        @{Name='Programs/Sample/Catalog/action.ps1';Text='throw "never execute"'}, @{Name='Programs/Sample/Support/';Text=''})
    $destination = Join-Path $testRoot 'valid-out'
    $result = & $helper -ArchivePath $archive -Destination $destination | ConvertFrom-Json
    if ($result.programName -cne 'Sample' -or [IO.File]::ReadAllText((Join-Path $destination 'Programs/Sample/Catalog/action.ps1')) -cne 'throw "never execute"') {
        throw 'Valid package was not extracted as inert data.'
    }
    $script:passed++
    $failure = $null
    try { & $helper -ArchivePath $archive -Destination $destination | Out-Null } catch { $failure=$_.Exception.Message }
    if ($failure -notlike '*must not already exist*') { throw 'Existing destination was not preserved.' }; $script:passed++
    Assert-Rejected 'traversal' @($manifest,@{Name='Programs/Sample/../../escape.txt';Text='bad'}) 'unsafe path'
    Assert-Rejected 'absolute' @($manifest,@{Name='/Programs/Sample/escape.txt';Text='bad'}) 'absolute'
    Assert-Rejected 'drive' @($manifest,@{Name='C:/escape.txt';Text='bad'}) 'unsafe path'
    Assert-Rejected 'ads' @($manifest,@{Name='Programs/Sample/action.ps1:stream';Text='bad'}) 'unsafe path'
    Assert-Rejected 'device' @($manifest,@{Name='Programs/Sample/CON.txt';Text='bad'}) 'unsafe path'
    Assert-Rejected 'trailing-dot' @($manifest,@{Name='Programs/Sample/odd./file';Text='bad'}) 'unsafe path'
    Assert-Rejected 'empty-segment' @($manifest,@{Name='Programs/Sample//file';Text='bad'}) 'unsafe path'
    Assert-Rejected 'case-file' @($manifest,@{Name='Programs/Sample/file';Text='a'},@{Name='Programs/Sample/FILE';Text='b'}) 'case-colliding'
    Assert-Rejected 'case-parent' @($manifest,@{Name='Programs/Sample/Folder/a';Text='a'},@{Name='Programs/Sample/folder/b';Text='b'}) 'colliding'
    Assert-Rejected 'duplicate' @($manifest,$manifest) 'duplicate'
    Assert-Rejected 'file-parent' @($manifest,@{Name='Programs/Sample/folder';Text='a'},@{Name='Programs/Sample/folder/child';Text='b'}) 'colliding'
    Assert-Rejected 'two-programs' @($manifest,@{Name='Programs/Other/flowcell.program.json';Text='{}'}) 'exactly one'
    Assert-Rejected 'outside' @($manifest,@{Name='README.txt';Text='bad'}) 'Choose a program ZIP'
    Assert-Rejected 'missing-manifest' @(@{Name='Programs/Sample/action.ps1';Text='a'}) 'missing Programs'
    Assert-Rejected 'symlink' @($manifest,@{Name='Programs/Sample/link';Text='target';Attributes=-1610612736}) 'special file'
    Assert-Rejected 'reparse' @($manifest,@{Name='Programs/Sample/link';Text='target';Attributes=1024}) 'special file'
    Assert-Rejected 'unix-device' @($manifest,@{Name='Programs/Sample/device';Text='';Attributes=536870912}) 'special file'
    Assert-Rejected 'panels' @($manifest,@{Name='Programs/Sample/Panels/private.json';Text='{}'}) 'mutable'
    Assert-Rejected 'local-scripts' @($manifest,@{Name='Programs/Sample/Sample Local Scripts/owner/file';Text='a'}) 'mutable'
    Assert-Rejected 'runtime' @($manifest,@{Name='Programs/Sample/Catalog/runtime/state.json';Text='{}'}) 'mutable'
    Assert-Rejected 'install-state' @($manifest,@{Name='Programs/Sample/flowcell.install.json';Text='{}'}) 'mutable'
    Assert-Rejected 'source-state' @($manifest,@{Name='Programs/Sample/owner.flowcell-source.json';Text='{}'}) 'mutable'
    Assert-Rejected 'directory-attribute' @($manifest,@{Name='Programs/Sample/not-a-directory';Text='';Attributes=16}) 'special file'
    $oversized = Join-Path $testRoot 'oversized.zip'
    $largeArchive = [IO.Compression.ZipFile]::Open($oversized, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $entry = $largeArchive.CreateEntry('Programs/Sample/flowcell.program.json')
        $stream = $entry.Open()
        try {
            $block = New-Object byte[] 1048576
            for ($index=0; $index -lt 129; $index++) { $stream.Write($block, 0, $block.Length) }
        } finally { $stream.Dispose() }
    } finally { $largeArchive.Dispose() }
    $failure = $null
    try { & $helper -ArchivePath $oversized -Destination (Join-Path $testRoot 'oversized-out') | Out-Null }
    catch { $failure=$_.Exception.Message }
    if ($failure -notlike '*128 MiB*' -or (Test-Path -LiteralPath (Join-Path $testRoot 'oversized-out'))) {
        throw 'Oversized compressed entry was not rejected before extraction.'
    }; $script:passed++
    $plain = Join-Path $testRoot 'plain'
    [IO.Directory]::CreateDirectory($plain) | Out-Null
    Copy-Item -LiteralPath $archive -Destination (Join-Path $plain 'package.zip')
    $junction = Join-Path $testRoot 'linked'
    New-Item -ItemType Junction -Path $junction -Target $plain | Out-Null
    $failure = $null
    try { & $helper -ArchivePath (Join-Path $junction 'package.zip') -Destination (Join-Path $testRoot 'linked-out') | Out-Null }
    catch { $failure=$_.Exception.Message }
    if ($failure -notlike '*reparse point*') { throw 'Archive behind a junction was not rejected.' }; $script:passed++
    $failure = $null
    try { & $helper -ArchivePath $archive -Destination (Join-Path $junction 'output') | Out-Null }
    catch { $failure=$_.Exception.Message }
    if ($failure -notlike '*reparse point*') { throw 'Staging behind a junction was not rejected.' }; $script:passed++
    Write-Output "Program ZIP extraction tests: $script:passed passed."
} finally {
    # All files under this verified path are disposable fixtures created by this test.
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notlike 'flowcell-zip-tests-*') { throw 'Unsafe test cleanup path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
