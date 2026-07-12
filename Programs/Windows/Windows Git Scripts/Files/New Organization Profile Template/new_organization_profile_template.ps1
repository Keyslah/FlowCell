# Description: New Organization Profile Template.
# Copy this file, rename it, and set the profile id below.
$ProfileId = ''
& (Join-Path $PSScriptRoot 'new_organization.ps1') -ProfileId $ProfileId
exit $LASTEXITCODE
