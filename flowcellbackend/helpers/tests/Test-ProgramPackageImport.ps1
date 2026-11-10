[CmdletBinding()]
param([string]$CloudDirectory = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$helper = Join-Path (Split-Path -Parent $PSScriptRoot) 'Expand-FlowCellProgramPackage.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-zip-tests-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$script:passed = 0
$cloudTestRoot = $null
$junction = $null
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

    # Load the production cloud classifier without running the extractor body.
    $ast = [Management.Automation.Language.Parser]::ParseFile($helper, [ref]$null, [ref]$null)
    foreach ($name in @('ConvertTo-ExtendedPath', 'Test-CloudStorageDirectory')) {
        $definition = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
        Invoke-Expression $definition.Extent.Text
    }
    if (Test-CloudStorageDirectory $plain) { throw 'Ordinary directory was classified as a cloud placeholder.' }
    if (Test-CloudStorageDirectory $junction) { throw 'Junction was classified as a cloud placeholder.' }
    foreach ($variant in 0..15) {
        $tag = [Convert]::ToUInt32(('9000{0:X}01A' -f $variant), 16)
        if (-not [FlowCellProgramZipCloudDirectory]::IsCloudTag($tag)) { throw 'Supported cloud tag was rejected.' }
    }
    foreach ($hex in @('A0000003', 'A000000C', '8000001B', '00000000', '9001001A')) {
        if ([FlowCellProgramZipCloudDirectory]::IsCloudTag([Convert]::ToUInt32($hex, 16))) { throw 'Redirecting or unknown tag was allowed.' }
    }
    $script:passed++

    # Exercise .NET/PowerShell 5.1 MAX_PATH behavior with both a long archive path
    # and an expanded entry longer than the real release's nested skin variants.
    $longParent = Join-Path $testRoot (('a' * 100) + '\' + ('b' * 100))
    $longParentExtended = ConvertTo-ExtendedPath $longParent
    [IO.Directory]::CreateDirectory($longParentExtended) | Out-Null
    $longArchive = New-TestZip 'long-entry' @($manifest, @{Name=('Programs/Sample/Catalog/' + ('c' * 80) + '/' + ('d' * 80) + '/action.ps1'); Text='throw "never execute"'})
    $longArchivePath = [IO.Path]::Combine($longParent, 'long-package.zip')
    [IO.File]::Copy($longArchive, (ConvertTo-ExtendedPath $longArchivePath))
    $longDestination = [IO.Path]::Combine($longParent, 'expanded')
    $longResult = & $helper -ArchivePath $longArchivePath -Destination $longDestination | ConvertFrom-Json
    $longFile = [IO.Path]::Combine($longDestination, ('Programs\Sample\Catalog\' + ('c' * 80) + '\' + ('d' * 80) + '\action.ps1'))
    if ($longResult.programName -cne 'Sample' -or [IO.File]::ReadAllText((ConvertTo-ExtendedPath $longFile)) -cne 'throw "never execute"') {
        throw 'Long archive/destination/entry paths did not extract as inert data.'
    }
    $script:passed++

    # A caller with a real cloud folder can exercise the native tag lookup and
    # both archive and staging ancestor checks without fabricating reparse data.
    if ($CloudDirectory) {
        if (-not (Test-CloudStorageDirectory $CloudDirectory)) { throw 'CloudDirectory must be a real cloud placeholder directory.' }
        $cloudTestRoot = Join-Path ([IO.Path]::GetFullPath($CloudDirectory)) ('flowcell-zip-cloud-test-' + [guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($cloudTestRoot) | Out-Null
        $cloudArchive = Join-Path $cloudTestRoot 'package.zip'
        Copy-Item -LiteralPath $archive -Destination $cloudArchive
        $cloudDestination = Join-Path $cloudTestRoot 'expanded'
        $cloudResult = & $helper -ArchivePath $cloudArchive -Destination $cloudDestination | ConvertFrom-Json
        if ($cloudResult.programName -cne 'Sample' -or -not [IO.File]::Exists((Join-Path $cloudDestination 'Programs/Sample/flowcell.program.json'))) {
            throw 'Package beneath a real cloud directory was not extracted.'
        }
        $script:passed++
    }
    Write-Output "Program ZIP extraction tests: $script:passed passed."
} finally {
    # All files under this verified path are disposable fixtures created by this test.
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notlike 'flowcell-zip-tests-*') { throw 'Unsafe test cleanup path.' }
    if ($junction -and [IO.Directory]::Exists($junction)) {
        if ([IO.Path]::GetDirectoryName($junction) -ne $resolved) { throw 'Unsafe junction cleanup path.' }
        # Remove the junction itself first; .NET Framework recursive deletion
        # refuses an extended-path junction even when its target is our fixture.
        [IO.Directory]::Delete($junction)
    }
    # .NET extended paths also clean up the long-path fixtures on PowerShell 5.1.
    [IO.Directory]::Delete(('\\?\' + $resolved), $true)
    if ($cloudTestRoot) {
        $cloudParent = [IO.Path]::GetFullPath($CloudDirectory).TrimEnd('\') + '\'
        $cloudResolved = [IO.Path]::GetFullPath($cloudTestRoot)
        if (-not $cloudResolved.StartsWith($cloudParent, [StringComparison]::OrdinalIgnoreCase) -or
            [IO.Path]::GetFileName($cloudResolved) -notlike 'flowcell-zip-cloud-test-*') { throw 'Unsafe cloud test cleanup path.' }
        [IO.Directory]::Delete(('\\?\' + $cloudResolved), $true)
    }
}
