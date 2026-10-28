<#
Purpose: Verify automatic Blender theme collection using disposable package libraries.
Writes: Only one unique temporary fixture tree; no ZIPs or live application state.
Deletion: Only that task-created temporary tree is removed after verifying its boundary.
#>
$ErrorActionPreference = 'Stop'
$helperRoot = Split-Path -Parent $PSScriptRoot
$temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
$fixtureRoot = Join-Path $temporaryParent ('FlowCell-theme-package-tests-' + [guid]::NewGuid().ToString('N'))
$RepoRoot = Join-Path $fixtureRoot 'repo'
$script:checks = 0

function Stop-Package([string]$Message) { throw "[FlowCell package] $Message" }
function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:checks++
}
function Assert-Rejected([scriptblock]$Action, [string]$Message, [string]$ExpectedError = '') {
    $rejected = $false
    try { & $Action | Out-Null } catch {
        if ($ExpectedError -and $_.Exception.Message -notlike "*$ExpectedError*") {
            throw "Unexpected error for '$Message': $($_.Exception.Message)"
        }
        $rejected = $true
    }
    Assert $rejected $Message
}
function Put([string]$Path, [string]$Text) {
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
function Put-Json([string]$Path, $Value) { Put $Path ($Value | ConvertTo-Json -Depth 30) }
function New-TestTheme([string]$Library, [string]$Name) {
    $package = Join-Path $Library $Name
    Put (Join-Path $package 'palette image.png') ('palette bytes for ' + $Name)
    Put (Join-Path $package 'images/background.png') ('background bytes for ' + $Name)
    $manifestPath = Join-Path $package ($Name + '.flowcell-theme-pack.json')
    Put-Json $manifestPath ([ordered]@{
        format = 'flowcell-tool-package/blender-theme/v1'
        name = $Name
        savedAt = '12345'
        assets = [ordered]@{
            theme_image_path = 'palette image.png'
            static_background_path = 'images/background.png'
        }
        values = [ordered]@{
            theme_image_path = (Join-Path $package 'palette image.png')
            static_background_path = (Join-Path $package 'images/background.png')
            grid_enabled = $false
            button_theme = @{ fill = '#123456'; amount = 1.25 }
        }
    })
    return $manifestPath
}

. (Join-Path $helperRoot 'program-package-safety.ps1')
. (Join-Path $helperRoot 'blender-theme-packages.ps1')

try {
    $snapshot = Join-Path $RepoRoot 'Programs/Blender/blender themes/Packages'
    $snapshotManifest = New-TestTheme $snapshot 'Snapshot'
    Assert-Rejected { Resolve-BlenderThemePackageLibrary } 'missing configuration fails even when an old snapshot exists' 'FlowCell-Blender.zip requires the saved Blender theme library'
    $configPath = Join-Path $RepoRoot 'flowcellbackend/local/program-package-sources.json'
    Put-Json $configPath @{}
    Assert-Rejected { Resolve-BlenderThemePackageLibrary } 'configuration without the theme-library property requires the authoritative source' 'FlowCell-Blender.zip requires the saved Blender theme library'

    $active = Join-Path $fixtureRoot 'Active library with spaces'
    $activeManifest = New-TestTheme $active 'Current theme'
    Put (Join-Path $active 'Current theme/private-note.txt') 'not a declared asset'
    Put (Join-Path $active '.flowcell-package-backups/invalid.flowcell-theme-pack.json') 'not JSON'
    Put (Join-Path $active '.flowcell-package-staging/invalid.flowcell-theme-pack.json') 'not JSON'
    $hiddenFolder = Join-Path $active 'hidden backup'
    Put (Join-Path $hiddenFolder 'invalid.flowcell-theme-pack.json') 'not JSON'
    (Get-Item -LiteralPath $hiddenFolder).Attributes = [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::Hidden
    Put-Json $configPath @{ blenderThemeLibrary = $active }
    Assert ((Resolve-BlenderThemePackageLibrary) -eq $active) 'configured active library takes precedence over snapshot'
    Assert ((Resolve-BlenderThemePackageLibrary -LibraryPath $snapshot) -eq $snapshot) 'explicit library overrides local configuration'
    $migratedLocal = Join-Path $fixtureRoot 'Migrated local'
    $legacyLibrary = Join-Path $migratedLocal 'blender_themes'
    $canonicalLibrary = Join-Path $migratedLocal 'themes/Blender'
    New-Item -ItemType Directory -Path $legacyLibrary, $canonicalLibrary -Force | Out-Null
    Put-Json (Join-Path $migratedLocal 'themes/.migration-v1.json') @{ version = 1; entries = @(); mappings = @() }
    Assert ((Resolve-BlenderThemePackageLibrary -LibraryPath $legacyLibrary) -eq $canonicalLibrary) 'legacy release-library references resolve to migrated canonical storage'
    $portableLibrary = Join-Path $fixtureRoot 'Portable themes'
    $portableBytes = [Text.Encoding]::UTF8.GetBytes('portable image')
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $portableHash = ([BitConverter]::ToString($sha.ComputeHash($portableBytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
    $portableTheme = @{
      kind = 'FlowCellPortableTheme'; version = 1; name = 'Shared theme'; id = 'test-theme'
      target = @{ kind = 'program'; programName = 'Blender' }
      theme = @{ kind = 'FlowCellTheme'; version = 2; target = @{ kind = 'program'; programName = 'Blender' }; buttons = @() }
      contributions = @{ theme = @{ image = "theme-asset:assets/$portableHash.png" } }
      assets = @(@{ path = "assets/$portableHash.png"; sha256 = $portableHash; base64 = [Convert]::ToBase64String($portableBytes) })
    }
    Put-Json (Join-Path $portableLibrary 'Shared.flowcell-theme-pack.json') $portableTheme
    Put-Json (Join-Path $portableLibrary 'Classic.flowtheme.json') @{ kind = 'FlowCellTheme'; version = 2; target = @{ kind = 'program'; programName = 'Blender' }; buttons = @() }
    $portableStage = Join-Path $fixtureRoot 'portable-stage'
    $portableResult = Copy-BlenderThemePackages -SourceLibrary $portableLibrary -Destination $portableStage
    Assert ($portableResult.PackageCount -eq 2 -and $portableResult.AssetCount -eq 1) 'flat complete themes and classic program themes are delivered with embedded images'
    Assert ((Get-FileHash -LiteralPath (Join-Path $portableLibrary 'Shared.flowcell-theme-pack.json')).Hash -eq (Get-FileHash -LiteralPath (Join-Path $portableStage 'Shared.flowcell-theme-pack.json')).Hash) 'portable archive bytes remain unchanged'
    $portableTheme.assets[0].sha256 = 'bad-checksum'
    Put-Json (Join-Path $portableLibrary 'Shared.flowcell-theme-pack.json') $portableTheme
    Assert-Rejected { Copy-BlenderThemePackages -SourceLibrary $portableLibrary -Destination (Join-Path $fixtureRoot 'invalid-portable-stage') } 'corrupt embedded images are rejected before release'

    $manifestBefore = (Get-FileHash -LiteralPath $activeManifest -Algorithm SHA256).Hash
    $firstStage = Join-Path $fixtureRoot 'first-stage'
    $first = Copy-BlenderThemePackages -SourceLibrary (Resolve-BlenderThemePackageLibrary) -Destination $firstStage
    Assert ($first.PackageCount -eq 1 -and $first.AssetCount -eq 2) 'backup and staging folders are excluded'
    Assert (@(Get-ChildItem -LiteralPath $firstStage -Recurse -File).Count -eq 3) 'only manifest and referenced assets are staged'
    Assert (-not (Test-Path -LiteralPath (Join-Path $firstStage 'Snapshot'))) 'active library does not restore stale snapshot themes'
    $copiedManifest = Join-Path $firstStage 'Current theme/Current theme.flowcell-theme-pack.json'
    $copied = Get-Content -LiteralPath $copiedManifest -Raw | ConvertFrom-Json
    Assert ($copied.values.theme_image_path -eq 'palette image.png') 'palette path is portable'
    Assert ($copied.values.static_background_path -eq 'images/background.png') 'background path is portable'
    Assert ($copied.values.grid_enabled -eq $false -and $copied.values.button_theme.amount -eq 1.25) 'authored non-asset values survive unchanged'
    foreach ($relative in @('palette image.png', 'images/background.png')) {
        $sourceHash = (Get-FileHash -LiteralPath (Join-Path $active "Current theme/$relative") -Algorithm SHA256).Hash
        $copiedHash = (Get-FileHash -LiteralPath (Join-Path $firstStage "Current theme/$relative") -Algorithm SHA256).Hash
        Assert ($sourceHash -eq $copiedHash) "asset bytes preserved: $relative"
    }
    Assert ((Get-FileHash -LiteralPath $activeManifest -Algorithm SHA256).Hash -eq $manifestBefore) 'source manifest remains unchanged'
    Assert (Test-Path -LiteralPath (Join-Path $active 'Current theme/private-note.txt')) 'unreferenced source file remains untouched'

    $newManifest = New-TestTheme $active 'Newly saved'
    Put (Join-Path $active 'Current theme/palette image.png') 'new saved image bytes'
    $secondStage = Join-Path $fixtureRoot 'second-stage'
    $second = Copy-BlenderThemePackages -SourceLibrary (Resolve-BlenderThemePackageLibrary) -Destination $secondStage
    Assert ($second.PackageCount -eq 2 -and $second.AssetCount -eq 4) 'next staging automatically includes newly saved themes'
    Assert (Test-Path -LiteralPath (Join-Path $secondStage 'Newly saved/Newly saved.flowcell-theme-pack.json')) 'new theme manifest is delivered'
    Assert ([IO.File]::ReadAllText((Join-Path $secondStage 'Current theme/palette image.png')) -eq 'new saved image bytes') 'next staging includes fresh image edits'
    Assert-Rejected { Copy-BlenderThemePackages -SourceLibrary $active -Destination $secondStage } 'nonempty destinations are not overwritten'

    $removedTheme = [IO.Path]::GetFullPath((Join-Path $active 'Newly saved'))
    $removedDestination = [IO.Path]::GetFullPath((Join-Path $fixtureRoot 'removed-theme'))
    $fixturePrefix = [IO.Path]::GetFullPath($fixtureRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $removedTheme.StartsWith($fixturePrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not $removedDestination.StartsWith($fixturePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to move a removed-theme fixture outside the task temporary tree.'
    }
    [IO.Directory]::Move($removedTheme, $removedDestination)
    $thirdStage = Join-Path $fixtureRoot 'third-stage'
    $third = Copy-BlenderThemePackages -SourceLibrary (Resolve-BlenderThemePackageLibrary) -Destination $thirdStage
    Assert ($third.PackageCount -eq 1 -and $third.AssetCount -eq 2) 'next staging reflects themes removed from the authoritative folder'
    Assert (-not (Test-Path -LiteralPath (Join-Path $thirdStage 'Newly saved'))) 'removed themes are not restored from a previous staging'

    Put-Json $configPath @{ blenderThemeLibrary = 'Programs/Blender/blender themes/Packages' }
    Assert ((Resolve-BlenderThemePackageLibrary) -eq $snapshot) 'relative configuration is resolved against the checkout'

    # Build Unicode strings explicitly so this test script also runs in Windows PowerShell 5.1.
    $unicodeLibrary = Join-Path $fixtureRoot ('library-' + [char]0x661F)
    $unicodeManifest = New-TestTheme $unicodeLibrary 'Unicode'
    $unicodeData = Get-Content -LiteralPath $unicodeManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $unicodeImage = ([string][char]0x661F) + '.png'
    Put (Join-Path $unicodeLibrary "Unicode/$unicodeImage") 'Unicode-named image bytes'
    $unicodeData.assets.theme_image_path = $unicodeImage
    Put-Json $unicodeManifest $unicodeData
    Put-Json $configPath @{ blenderThemeLibrary = $unicodeLibrary }
    Assert ((Resolve-BlenderThemePackageLibrary) -eq $unicodeLibrary) 'BOM-free UTF8 configuration preserves Unicode library paths'
    $unicodeStage = Join-Path $fixtureRoot 'unicode-stage'
    $unicodeResult = Copy-BlenderThemePackages -SourceLibrary (Resolve-BlenderThemePackageLibrary) -Destination $unicodeStage
    Assert ($unicodeResult.PackageCount -eq 1 -and (Test-Path -LiteralPath (Join-Path $unicodeStage "Unicode/$unicodeImage"))) 'BOM-free UTF8 manifests preserve Unicode asset names'
    Assert ((Get-FileHash -LiteralPath (Join-Path $unicodeLibrary "Unicode/$unicodeImage")).Hash -eq (Get-FileHash -LiteralPath (Join-Path $unicodeStage "Unicode/$unicodeImage")).Hash) 'Unicode-named asset bytes are preserved'

    Put-Json $configPath @{ blenderThemeLibrary = (Join-Path $fixtureRoot 'missing-library') }
    Assert-Rejected { Resolve-BlenderThemePackageLibrary } 'missing configured library fails instead of silently using snapshot'
    Put-Json $configPath @{ blenderThemeLibrary = '' }
    Assert-Rejected { Resolve-BlenderThemePackageLibrary } 'blank configured source fails'
    Assert-Rejected { Resolve-BlenderThemePackageLibrary -LibraryPath (Join-Path $fixtureRoot 'missing-explicit') } 'missing explicit source fails'

    $missing = Join-Path $fixtureRoot 'missing-asset-library'
    $validBeforeMissing = New-TestTheme $missing 'A valid package'
    $missingManifest = New-TestTheme $missing 'Missing'
    $missingData = Get-Content -LiteralPath $missingManifest -Raw | ConvertFrom-Json
    $missingData.assets.theme_image_path = 'absent.png'
    Put-Json $missingManifest $missingData
    $missingStage = Join-Path $fixtureRoot 'missing-asset-stage'
    Assert-Rejected { Copy-BlenderThemePackages -SourceLibrary $missing -Destination $missingStage } 'missing images fail staging'
    Assert (-not (Test-Path -LiteralPath $missingStage)) 'invalid library is rejected before destination writes'

    $unsafeIndex = 0
    foreach ($unsafePath in @('../outside.png', 'images/../palette image.png', (Join-Path $fixtureRoot 'outside.png'), 'image.png:stream')) {
        $unsafeLibrary = Join-Path $fixtureRoot ("unsafe-library-$unsafeIndex")
        $unsafeManifest = New-TestTheme $unsafeLibrary 'Unsafe'
        $unsafeData = Get-Content -LiteralPath $unsafeManifest -Raw | ConvertFrom-Json
        $unsafeData.assets.theme_image_path = $unsafePath
        Put-Json $unsafeManifest $unsafeData
        $unsafeStage = Join-Path $fixtureRoot ("unsafe-stage-$unsafeIndex")
        Assert-Rejected { Copy-BlenderThemePackages -SourceLibrary $unsafeLibrary -Destination $unsafeStage } "unsafe asset path rejected: $unsafePath"
        $unsafeIndex++
    }

    $unsupported = Join-Path $fixtureRoot 'unsupported-library'
    $unsupportedManifest = New-TestTheme $unsupported 'Unsupported'
    $unsupportedData = Get-Content -LiteralPath $unsupportedManifest -Raw | ConvertFrom-Json
    $unsupportedData.format = 'unrecognized/v1'
    Put-Json $unsupportedManifest $unsupportedData
    Assert-Rejected { Copy-BlenderThemePackages -SourceLibrary $unsupported -Destination (Join-Path $fixtureRoot 'unsupported-stage') } 'unsupported manifest format fails explicitly'

    $unmapped = Join-Path $fixtureRoot 'unmapped-library'
    $unmappedManifest = New-TestTheme $unmapped 'Unmapped'
    $unmappedData = Get-Content -LiteralPath $unmappedManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $unmappedData.assets.PSObject.Properties.Remove('static_background_path')
    Put-Json $unmappedManifest $unmappedData
    Assert-Rejected { Copy-BlenderThemePackages -SourceLibrary $unmapped -Destination (Join-Path $fixtureRoot 'unmapped-stage') } 'nonempty image paths require their matching asset mapping'

    $ambiguous = Join-Path $fixtureRoot 'ambiguous-library'
    $ambiguousManifest = New-TestTheme $ambiguous 'Ambiguous'
    Copy-Item -LiteralPath $ambiguousManifest -Destination (Join-Path $ambiguous 'Ambiguous/second.flowcell-theme-pack.json')
    Assert-Rejected { Copy-BlenderThemePackages -SourceLibrary $ambiguous -Destination (Join-Path $fixtureRoot 'ambiguous-stage') } 'multiple manifests in one package are rejected'

    $junctionPath = Join-Path $fixtureRoot 'linked-library'
    New-Item -ItemType Junction -Path $junctionPath -Target $active | Out-Null
    Assert-Rejected { Copy-BlenderThemePackages -SourceLibrary $junctionPath -Destination (Join-Path $fixtureRoot 'linked-stage') } 'reparse library roots are rejected'

    Write-Output "PASS: $($script:checks) Blender theme packaging assertions; required source folder, added/removed themes, current images, portability, source preservation and invalid-library handling. No ZIP created."
} finally {
    $cleanupRoot = [IO.Path]::GetFullPath($fixtureRoot).TrimEnd('\', '/')
    if (-not $cleanupRoot.StartsWith(($temporaryParent + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($cleanupRoot) -notmatch '^FlowCell-theme-package-tests-[0-9a-f]{32}$') {
        throw "Refusing cleanup outside the task fixture: $cleanupRoot"
    }
    # Remove the task-created junction itself before recursively cleaning the fixture.
    $cleanupLink = Join-Path $cleanupRoot 'linked-library'
    if (Test-Path -LiteralPath $cleanupLink) { [IO.Directory]::Delete($cleanupLink) }
    if (Test-Path -LiteralPath $cleanupRoot) { Remove-Item -LiteralPath $cleanupRoot -Recurse -Force }
}
