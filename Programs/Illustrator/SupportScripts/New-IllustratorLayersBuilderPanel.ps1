#requires -version 5.1
[CmdletBinding()]
param(
  [string]$RepoRoot
)

# Generates the "Layers Builder" Illustrator panel: a copy of every button in the
# original "Layers" panel, re-wired so each one runs against the
# FlowCell-highlighted layers (which may be locked or hidden) instead of only
# app.selection. The original "Layers" panel is never touched.
#
# Each generated button is a self-contained .jsx (Illustrator panels only run
# .jsx/.js): a prelude reads FlowCell's highlight set from the OS temp folder
# (Folder.temp), resolves the highlighted layers to their real pageItems
# (temporarily unlocking/unhiding the layers and their ancestors), selects them,
# then the unchanged original Layers script runs, and a finally block restores
# layer lock/visibility.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-FlowCellRepoRoot {
  if (-not [string]::IsNullOrWhiteSpace($RepoRoot)) {
    return [System.IO.Path]::GetFullPath($RepoRoot)
  }
  $supportRoot = Split-Path -Parent $PSCommandPath
  $programRoot = Split-Path -Parent $supportRoot
  $programsRoot = Split-Path -Parent $programRoot
  return [System.IO.Path]::GetFullPath((Split-Path -Parent $programsRoot))
}

$repoRootPath = Get-FlowCellRepoRoot
$programRoot = Join-Path $repoRootPath 'Programs\Illustrator'
$sourceLayersDir = Join-Path $programRoot 'Illustrator Git Scripts\Layers'
$gitTargetDir = Join-Path $programRoot 'Illustrator Git Scripts\Layers Builder'
$panelTargetDir = Join-Path $programRoot 'Panels\Layers Builder'

if (-not (Test-Path -LiteralPath $sourceLayersDir -PathType Container)) {
  throw "Source Layers panel folder not found: $sourceLayersDir"
}

foreach ($dir in @($gitTargetDir, $panelTargetDir)) {
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-TextNoBom {
  param([string]$Path, [string]$Text)
  [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

$preludeHeader = @'
// FlowCell Layers Builder button (GENERATED - do not edit by hand).
// Regenerate with SupportScripts/New-IllustratorLayersBuilderPanel.ps1.
// Runs the original Layers script "__SCRIPT_NAME__" against the
// FlowCell-highlighted layers.
#target illustrator

var FLOWCELL_LB_RESTORE = (function () {
    var restoreList = [];
    if (app.documents.length === 0) { return restoreList; }
    var doc = app.activeDocument;

    function readHighlightKeys() {
        var file = new File(Folder.temp.fsName + '/flowcell-illustrator-layers-highlight.json');
        if (!file.exists) { return []; }
        file.encoding = 'UTF-8';
        if (!file.open('r')) { return []; }
        var text = file.read();
        file.close();
        if (!text) { return []; }
        var parsed;
        try { parsed = eval('(' + text + ')'); } catch (e) { return []; }
        if (!parsed || !parsed.keys || typeof parsed.keys.length !== 'number') { return []; }
        var keys = [];
        for (var i = 0; i < parsed.keys.length; i += 1) { keys.push(String(parsed.keys[i])); }
        return keys;
    }

    function rememberAndOpen(layer) {
        restoreList.push({ layer: layer, locked: layer.locked, visible: layer.visible });
        if (layer.locked) { layer.locked = false; }
        if (!layer.visible) { layer.visible = true; }
    }

    function resolveLayerByKey(key) {
        var segments = String(key).split('.');
        var collection = doc.layers;
        var layer = null;
        for (var i = 0; i < segments.length; i += 1) {
            var index = parseInt(segments[i], 10);
            if (isNaN(index) || index < 0 || index >= collection.length) { return null; }
            layer = collection[index];
            rememberAndOpen(layer);
            collection = layer.layers;
        }
        return layer;
    }

    function collectItems(layer, bucket) {
        var i;
        for (i = 0; i < layer.pageItems.length; i += 1) {
            var item = layer.pageItems[i];
            try {
                if (item.locked) { item.locked = false; }
                if (item.hidden) { item.hidden = false; }
            } catch (flagError) {}
            bucket.push(item);
        }
        for (i = 0; i < layer.layers.length; i += 1) { collectItems(layer.layers[i], bucket); }
    }

    var keys = readHighlightKeys();
    var items = [];
    for (var k = 0; k < keys.length; k += 1) {
        var targetLayer = resolveLayerByKey(keys[k]);
        if (targetLayer) { collectItems(targetLayer, items); }
    }
    try { doc.selection = null; } catch (clearError) {}
    if (items.length > 0) { try { doc.selection = items; } catch (selectError) {} }
    return restoreList;
}());

try {
'@

$preludeFooter = @'

} finally {
    (function () {
        if (!FLOWCELL_LB_RESTORE) { return; }
        for (var r = FLOWCELL_LB_RESTORE.length - 1; r >= 0; r -= 1) {
            var entry = FLOWCELL_LB_RESTORE[r];
            try {
                entry.layer.locked = entry.locked;
                entry.layer.visible = entry.visible;
            } catch (restoreError) {}
        }
        try { app.redraw(); } catch (redrawError) {}
    }());
}
'@

# Scripts that act on the layer STRUCTURE rather than on selected artwork get a
# self-contained direct-layer body so they work on empty/locked/hidden highlighted
# layers (the selection-driven originals no-op when a highlighted layer has no art).
$directDeleteTemplate = @'
// FlowCell Layers Builder button (GENERATED - do not edit by hand).
// Regenerate with SupportScripts/New-IllustratorLayersBuilderPanel.ps1.
// Directly deletes the FlowCell-highlighted layers/sublayers (works on empty,
// locked, or hidden layers), instead of the selection-driven original.
#target illustrator

(function () {
    if (app.documents.length === 0) { return; }
    var doc = app.activeDocument;

    function readHighlightKeys() {
        var file = new File(Folder.temp.fsName + '/flowcell-illustrator-layers-highlight.json');
        if (!file.exists) { return []; }
        file.encoding = 'UTF-8';
        if (!file.open('r')) { return []; }
        var text = file.read();
        file.close();
        if (!text) { return []; }
        var parsed;
        try { parsed = eval('(' + text + ')'); } catch (e) { return []; }
        if (!parsed || !parsed.keys || typeof parsed.keys.length !== 'number') { return []; }
        var keys = [];
        for (var i = 0; i < parsed.keys.length; i += 1) { keys.push(String(parsed.keys[i])); }
        return keys;
    }

    function unlockTree(layer) {
        try { layer.locked = false; } catch (e1) {}
        try { layer.visible = true; } catch (e2) {}
        for (var i = 0; i < layer.layers.length; i += 1) { unlockTree(layer.layers[i]); }
    }

    function resolveLayerByKey(key) {
        var segments = String(key).split('.');
        var collection = doc.layers;
        var layer = null;
        for (var i = 0; i < segments.length; i += 1) {
            var index = parseInt(segments[i], 10);
            if (isNaN(index) || index < 0 || index >= collection.length) { return null; }
            layer = collection[index];
            try { layer.locked = false; } catch (eAnc1) {}
            try { layer.visible = true; } catch (eAnc2) {}
            collection = layer.layers;
        }
        return layer;
    }

    var keys = readHighlightKeys();
    var doomed = [];
    for (var k = 0; k < keys.length; k += 1) {
        var resolved = resolveLayerByKey(keys[k]);
        if (resolved) { doomed.push(resolved); }
    }
    // Resolve to references first, then remove (index shifts do not matter).
    for (var d = 0; d < doomed.length; d += 1) {
        try {
            unlockTree(doomed[d]);
            doomed[d].remove();
        } catch (removeError) {}
    }
    try { app.redraw(); } catch (redrawError) {}
}());
'@

# Map of original script name -> self-contained replacement body.
$directBodies = @{
  'delete sublayer' = $directDeleteTemplate
}

$layerScripts = Get-ChildItem -LiteralPath $sourceLayersDir -Filter '*.jsx' -File
foreach ($script in $layerScripts) {
  $scriptName = [System.IO.Path]::GetFileNameWithoutExtension($script.Name)
  if ($directBodies.ContainsKey($scriptName.ToLowerInvariant())) {
    $content = $directBodies[$scriptName.ToLowerInvariant()] + "`r`n"
  } else {
    $originalBody = Get-Content -LiteralPath $script.FullName -Raw
    $header = $preludeHeader.Replace('__SCRIPT_NAME__', $scriptName)
    $content = $header + "`r`n" + $originalBody + $preludeFooter + "`r`n"
  }
  foreach ($dir in @($gitTargetDir, $panelTargetDir)) {
    $wrapperPath = Join-Path $dir ("{0}.jsx" -f $scriptName)
    Write-TextNoBom -Path $wrapperPath -Text $content
  }
  Write-Host "Wrapped $scriptName"
}

# Launcher button: intercepted by FlowCell to open the Layers Builder window.
$launcherContent = @'
// FlowCell Layers Builder launcher.
// FlowCell intercepts this button by name to open the Layers Builder window.
// If it ever runs directly in Illustrator it intentionally does nothing.
#target illustrator
(function () {}());
'@
foreach ($dir in @($gitTargetDir, $panelTargetDir)) {
  Write-TextNoBom -Path (Join-Path $dir 'Build Layers.jsx') -Text $launcherContent
}
Write-Host 'Wrote Build Layers launcher.'
Write-Host "Layers Builder panel generated at: $panelTargetDir"
