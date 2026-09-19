<#
Purpose: Validate the exact installer/program ZIP set and emit release SHA256 hashes.
Context: Windows build output, tracked program manifests as the publishable inventory.
Inputs: Directory containing release ZIPs. Writes: SHA256SUMS.txt only, atomically replaced.
Constraints: Opens archives read-only; no extraction, installation, deletion, or publishing.
#>
param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$RepoRoot=Split-Path -Parent $PSScriptRoot
function Stop-Package([string]$message){throw $message}
. (Join-Path $PSScriptRoot 'program-package-safety.ps1')
$manifests=@(& git -C $RepoRoot -c core.quotePath=false ls-files -- 'Programs/*/flowcell.program.json')
if($LASTEXITCODE -ne 0){throw 'Tracked manifest inventory failed.'}
$expected=@('flowcellwindowsinstaller.zip')
foreach($manifestPath in $manifests){
    $manifest=Get-Content -LiteralPath (Join-Path $RepoRoot $manifestPath) -Raw|ConvertFrom-Json
    $name=Split-Path -Leaf (Split-Path -Parent $manifestPath)
    $asset='FlowCell-'+($name -replace '[^A-Za-z0-9._-]+','-')+'.zip'
    $expected+=$asset
    $zipPath=Join-Path $Directory $asset
    Assert-ProgramZipInvariant $zipPath $name @($manifest.localScriptsFolder,$manifest.panelsFolder)
    $archive=[IO.Compression.ZipFile]::OpenRead($zipPath)
    try{
        $prefix="Programs/$name/"
        $entries=@{}
        foreach($e in $archive.Entries){
            $key=$e.FullName.Replace('\','/')
            if($entries.ContainsKey($key)){throw "Case-colliding ZIP entries: $key"}
            if($key -match '(^|/)(\.git|__pycache__|node_modules)(/|$)|\.(log|pyc)$'){throw "Private/generated ZIP entry: $key"}
            $entries[$key]=$e
        }
        $baselineEntry=$entries[$prefix+$manifest.supportScriptsFolder+'/catalog-baseline.json']
        if(-not $baselineEntry){throw "Missing catalog baseline: $asset"}
        $reader=[IO.StreamReader]::new($baselineEntry.Open())
        try{$baseline=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
        $catalogPrefix=$prefix+$manifest.gitScriptsFolder+'/'
        $catalogEntries=@($entries.Keys|Where-Object{$_.StartsWith($catalogPrefix) -and -not $_.EndsWith('/')})
        $properties=@($baseline.files.PSObject.Properties)
        if($properties.Count -ne $catalogEntries.Count -or $properties.Count -eq 0){throw "Incomplete baseline in $asset"}
        foreach($property in $properties){
            $entry=$entries[$catalogPrefix+$property.Name]
            if(-not $entry){throw "Baseline references missing file: $($property.Name)"}
            $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
            try{$hash=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}
            if($hash -ne $property.Value){throw "Packaged baseline hash mismatch: $($property.Name)"}
        }
        foreach($key in @($entries.Keys|Where-Object{$_ -match '/flowcell\.(script|toolset)\.json$'})){
            $reader=[IO.StreamReader]::new($entries[$key].Open())
            try{$sourceManifest=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
            if(-not $sourceManifest.source -or $sourceManifest.source -match '^/|(^|/)\.\.(/|$)|:'){throw "Unsafe declared source: $key"}
            $sourceKey=$key.Substring(0,$key.LastIndexOf('/')+1)+$sourceManifest.source.Replace('\','/')
            if(-not $entries.ContainsKey($sourceKey)){throw "Missing declared source $sourceKey"}
        }
    }finally{$archive.Dispose()}
    Write-Output "Verified $asset ($($catalogEntries.Count) catalog files)"
}
$actual=@(Get-ChildItem -LiteralPath $Directory -File -Filter '*.zip'|ForEach-Object Name)
if(@(Compare-Object ($expected|Sort-Object) ($actual|Sort-Object)).Count){throw 'Release ZIP set differs from tracked package inventory.'}
$installer=[IO.Compression.ZipFile]::OpenRead((Join-Path $Directory 'flowcellwindowsinstaller.zip'))
try{if($installer.Entries.Count -ne 1 -or $installer.Entries[0].FullName -notmatch '-setup\.exe$' -or $installer.Entries[0].Length -lt 1000000){throw 'Installer ZIP must contain one nonempty actual setup executable.'}}finally{$installer.Dispose()}
$hashes=@($expected|Sort-Object|ForEach-Object{(Get-FileHash -LiteralPath (Join-Path $Directory $_) -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$_})
[IO.File]::WriteAllLines((Join-Path $Directory 'SHA256SUMS.txt'),$hashes,[Text.UTF8Encoding]::new($false))
Write-Output "Verified $($expected.Count) release ZIPs."
