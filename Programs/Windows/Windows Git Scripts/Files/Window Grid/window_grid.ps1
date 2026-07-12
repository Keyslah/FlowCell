#requires -version 5.1
# Description: Owned source anchor for FlowCell's managed Window Grid service.
# The adjacent manifest declares the core action explicitly. This source is
# intentionally harmless if it is run outside that installed package contract.
Write-Host 'Window Grid is opened by this package''s registered FlowCell core action.'
