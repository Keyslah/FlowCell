<#
Purpose: Exercise catalog synchronization safety using isolated Windows fixture roots.
Inputs: Packaged helper template; deterministic fake network catalog/download functions.
Writes: Only a unique temporary test tree. Local edits, neighbor state, failures and locks tested.
Deletion: Only task-created temporary files are removed; updater deletions use Recycle Bin.
Constraints: Does not access GitHub, installed hosts, or real FlowCell user data.
#>
$ErrorActionPreference='Stop'
$helper=Join-Path (Split-Path -Parent $PSScriptRoot) 'catalog-updater/Update-Catalog.ps1'
. $helper -DefinitionsOnly
$root=Join-Path ([IO.Path]::GetTempPath()) ('FlowCell updater tests '+[guid]::NewGuid().ToString('N'))
$program=Join-Path $root 'Programs/Test Program'
$catalog=Join-Path $program 'Git Scripts'
$package=Join-Path $program 'Local Scripts/owner/source'
$env:FLOWCELL_LOCAL_ROOT=$root
$script:checks=0
function Assert($value,$message){if(-not $value){throw "FAIL: $message"};$script:checks++}
function Put([string]$path,[string]$value){[IO.Directory]::CreateDirectory((Split-Path -Parent $path))|Out-Null;[IO.File]::WriteAllText($path,$value,[Text.UTF8Encoding]::new($false))}
function Json([string]$path,$value){Put $path ($value|ConvertTo-Json -Depth 20)}
function Seed($files){
    $hashes=@{}
    foreach($key in $files.Keys){$p=Join-Path $catalog $key;Put $p $files[$key];$hashes[$key]=Get-CatalogHash $p}
    Json (Join-Path $program 'Support/catalog-baseline.json') @{programId='test';files=$hashes}
}
function Fake-Network {
    function script:Get-RemoteCatalog($metadata){$files=@{};foreach($key in $script:remote.Keys){$files[$key]=@{path=$key}};return @{Commit=('a'*40);Files=$files}}
    function script:Save-CatalogDownload($url,$path,$entry){
        if($script:failDownload -eq $entry.path){throw 'HTTP 429 fixture rate limit'}
        Put $path $script:remote[$entry.path]
    }
}
try {
    Json (Join-Path $program 'flowcell.program.json') @{programId='test';gitScriptsFolder='Git Scripts';localScriptsFolder='Local Scripts';panelsFolder='Panels';supportScriptsFolder='Support'}
    Json (Join-Path $package 'updater.json') @{schemaVersion=1;programId='test';repository='Keyslah/FlowCell';ref='FlowCell';catalogPath='Programs/Test/Git Scripts'}
    Json (Join-Path $program 'Local Scripts/owner/flowcell.install.json') @{programId='test';ownerButtonId='owner'}
    Put (Join-Path $program 'Panels/Local/personal.json') 'panel sentinel'
    Put (Join-Path $package 'personal.txt') 'owned sentinel'
    Seed @{'a.ps1'='old';'nested/space name.txt'='old nested';'conflict.ps1'='baseline';'deleted.ps1'='remove upstream'}
    Put (Join-Path $catalog 'conflict.ps1') 'local edit'
    Put (Join-Path $catalog 'unknown.txt') 'user addition'
    $unicodeName='nested/'+[char]0x4F60+[char]0x597D+'.txt'
    $script:remote=@{'a.ps1'='new';'nested/space name.txt'='new nested';'conflict.ps1'='remote edit';'new-file.txt'='new file'}
    $script:remote[$unicodeName]='unicode payload'
    $script:failDownload=''
    Fake-Network
    $result=Invoke-CatalogUpdate $package
    Assert ($result -match 'Local changes preserved') 'conflict feedback'
    Assert ((Get-Content -LiteralPath (Join-Path $catalog 'a.ps1') -Raw) -eq 'new') 'upstream changed file'
    Assert ((Get-Content -LiteralPath (Join-Path $catalog 'nested/space name.txt') -Raw) -eq 'new nested') 'nested paths with spaces'
    Assert ((Get-Content -LiteralPath (Join-Path $catalog 'conflict.ps1') -Raw) -eq 'local edit') 'local edits preserved'
    Assert ((Get-Content -LiteralPath (Join-Path $catalog 'unknown.txt') -Raw) -eq 'user addition') 'unknown files preserved'
    Assert (-not (Test-Path -LiteralPath (Join-Path $catalog 'deleted.ps1'))) 'unchanged upstream deletion'
    Assert ((Get-Content -LiteralPath (Join-Path $program 'Panels/Local/personal.json') -Raw) -eq 'panel sentinel') 'neighbor Panels unchanged'
    Assert ((Get-Content -LiteralPath (Join-Path $package 'personal.txt') -Raw) -eq 'owned sentinel') 'Local Scripts unchanged'
    Assert ((Get-Content -LiteralPath (Join-Path $catalog $unicodeName) -Raw) -eq 'unicode payload') 'Unicode path download'
    Put (Join-Path $catalog 'conflict.ps1') 'remote edit'
    Assert ((Invoke-CatalogUpdate $package) -match 'Already up to date') 'repeat update'
    $script:remote['a.ps1']='third version';$script:failDownload='new-file.txt'
    try {Invoke-CatalogUpdate $package;throw 'Should fail download'} catch {Assert ($_.Exception.Message -match '429') 'actual rate limit reason'}
    Assert ((Get-Content -LiteralPath (Join-Path $catalog 'a.ps1') -Raw) -eq 'new') 'incomplete staging leaves live catalog intact'
    $script:failDownload=''
    $context=Get-CatalogContext $package
    $lock=[IO.File]::Open((Join-Path $context.State 'update.lock'),'Open','ReadWrite','None')
    try {try{Invoke-CatalogUpdate $package;throw 'Should reject concurrent update'}catch{Assert ($_.Exception.Message -match 'already running') 'concurrent update blocked'}}finally{$lock.Dispose()}
    foreach($unsafe in @('../escape','nested/../../escape','C:/escape','a:ads','nested\escape','CON.txt','foo./bar')){
        try {Join-CatalogPath $catalog $unsafe;throw 'Should reject unsafe path'}catch{Assert ($_.Exception.Message -match 'Unsafe') "reject $unsafe"}
    }
    $script:remote['nested/space name.txt']='third nested'
    $locked=[IO.File]::Open((Join-Path $catalog 'nested/space name.txt'),'Open','Read','Read')
    try {try{Invoke-CatalogUpdate $package;throw 'Should fail locked apply'}catch{Assert ($_.Exception.Message -match 'previous catalog was restored') 'apply failure rollback'}}finally{$locked.Dispose()}
    Assert ((Get-Content -LiteralPath (Join-Path $catalog 'a.ps1') -Raw) -eq 'new') 'rollback restores earlier applied file'
    # Simulate process termination after one file replacement but before journal commit.
    $recovery=Join-Path $context.State 'runs/interrupted'
    [IO.Directory]::CreateDirectory($recovery)|Out-Null
    $target=Join-Path $catalog 'a.ps1'
    $beforeHash=Get-CatalogHash $target
    Copy-Item -LiteralPath $target -Destination (Join-Path $recovery 'a.ps1')
    Copy-Item -LiteralPath (Join-Path $context.State 'baseline.json') -Destination (Join-Path $recovery 'baseline.json')
    Put $target 'interrupted replacement'
    Json (Join-Path $context.State 'transaction.json') @{phase='applying';catalog=$context.Catalog;state=$context.State;baselineBackup='runs/interrupted/baseline.json';changes=@(@{path='a.ps1';before=$beforeHash;after=(Get-CatalogHash $target);backup='runs/interrupted/a.ps1'})}
    Restore-CatalogTransaction $context (Join-Path $context.State 'transaction.json')
    Assert ((Get-Content -LiteralPath $target -Raw) -eq 'new') 'interrupted apply recovered from durable journal'
    # Validate blob integrity against a known git object, without invoking Git.
    $blob=Join-Path $root 'blob.txt';Put $blob 'hello'
    $originalDownload=${function:Save-CatalogDownload}
    . $helper -DefinitionsOnly
    function Invoke-WebRequest {param($Uri,$OutFile,$Headers,$TimeoutSec,[switch]$UseBasicParsing);Put $OutFile 'hello'}
    Save-CatalogDownload 'https://fixture.invalid' $blob @{path='blob.txt';size=5;sha='b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0'}
    Assert $true 'Git blob SHA1 verification'
    try{Save-CatalogDownload 'https://fixture.invalid' $blob @{path='blob.txt';size=6;sha=('a'*40)};throw 'Should reject partial blob'}catch{Assert ($_.Exception.Message -match 'Incomplete') 'partial blob rejected'}
    function Invoke-CatalogApi($url){return @{sha=('a'*40);commit=@{tree=@{sha=('b'*40)}};truncated=$true;tree=@()}}
    try{Get-RemoteCatalog $context.Metadata;throw 'Should reject truncated tree'}catch{Assert ($_.Exception.Message -match 'incomplete') 'truncated listing rejected'}
    $junction=Join-Path $catalog 'linked'
    New-Item -ItemType Junction -Path $junction -Target (Join-Path $program 'Panels') | Out-Null
    try{Join-CatalogPath $catalog 'linked/escape.txt';throw 'Should reject reparse'}catch{Assert ($_.Exception.Message -match 'reparse') 'junction rejected'}
    Write-Output "PASS: $script:checks catalog updater checks. Fixture retained at $root"
} finally {
    # Retain fixtures for inspection; they contain no user data.
    Remove-Item Env:FLOWCELL_LOCAL_ROOT -ErrorAction SilentlyContinue
}
