<#
Purpose: Ordinary Windows-script entry for this program's optional catalog updater.
Context/inputs: Installed Local Scripts package, no user arguments.
Changes: Delegates only catalog and recovery writes to the adjacent helper.
Conflicts/deletions: Local edits preserved, unchanged upstream deletions recycled.
Constraints: Never installs sources or changes Panels/Local Scripts; no Git/login.
#>
& (Join-Path $PSScriptRoot 'Update-Catalog.ps1') -PackageRoot $PSScriptRoot -ShowUi
