# Description: New Organization Active Example.
# Copy this file, rename it, and set $ProfileId to make a dedicated button for one saved organization profile.
$ProfileId = ''
$scriptPath = Join-Path $PSScriptRoot 'new_organization.ps1'
& $scriptPath -ProfileId $ProfileId
exit $LASTEXITCODE
