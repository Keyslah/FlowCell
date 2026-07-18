Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Verified against OpenAI.CodexBeta 26.707.3351.0 / Codex Desktop 0.144.0-alpha.4.
# Keep version-sensitive names and timing in this block.
$script:CodexMicroPackageNames = @('OpenAI.CodexBeta', 'OpenAI.Codex')
$script:CodexMicroWindowWaitMilliseconds = 8000
$script:CodexMicroMenuWaitMilliseconds = 1500
$script:CodexMicroPollMilliseconds = 50
$script:CodexMicroReasoningLevels = [ordered]@{
    'Medium' = 'Medium'
    'High' = 'High'
    'Extra High' = 'Extra High'
    'Ultra' = 'Ultra Consumes usage limits faster'
}

function Initialize-CodexMicroAutomation {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
}

function Test-CodexMicroProcess {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        $path = [string]$process.Path
        if ([string]::IsNullOrWhiteSpace($path)) {
            return $false
        }

        return $path -match '(?i)[\\/]WindowsApps[\\/]OpenAI\.Codex(?:Beta)?_[^\\/]+[\\/]app[\\/]ChatGPT(?: \(Beta\))?\.exe$'
    }
    catch {
        return $false
    }
}

function Get-CodexMicroTopLevelWindows {
    Initialize-CodexMicroAutomation
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    return @($root.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition
    ))
}

function Get-CodexMicroMainWindow {
    foreach ($candidate in Get-CodexMicroTopLevelWindows) {
        if (
            $candidate.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window -or
            -not (Test-CodexMicroProcess -ProcessId $candidate.Current.ProcessId)
        ) {
            continue
        }

        $documentCondition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList @(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
            'RootWebArea'
        )
        $document = $candidate.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            $documentCondition
        )
        if ($null -ne $document -and $document.Current.Name -eq 'Codex') {
            return $candidate
        }
    }

    return $null
}

function Wait-CodexMicroMainWindow {
    param(
        [int]$TimeoutMilliseconds = $script:CodexMicroWindowWaitMilliseconds
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    do {
        $window = Get-CodexMicroMainWindow
        if ($null -ne $window) {
            return $window
        }
        Start-Sleep -Milliseconds $script:CodexMicroPollMilliseconds
    } while ([DateTime]::UtcNow -lt $deadline)

    return $null
}

function Get-CodexMicroInstalledPackages {
    return @(
        Get-AppxPackage |
            Where-Object { $script:CodexMicroPackageNames -contains $_.Name }
    )
}

function Get-CodexMicroPackageForWindow {
    param(
        [System.Windows.Automation.AutomationElement]$Window
    )

    $packages = @(Get-CodexMicroInstalledPackages)
    if ($null -ne $Window) {
        try {
            $processPath = [string](Get-Process -Id $Window.Current.ProcessId -ErrorAction Stop).Path
            foreach ($package in $packages) {
                $installLocation = [string]$package.InstallLocation
                if (
                    -not [string]::IsNullOrWhiteSpace($installLocation) -and
                    $processPath.StartsWith($installLocation, [StringComparison]::OrdinalIgnoreCase)
                ) {
                    return $package
                }
            }
        }
        catch {
        }
    }

    foreach ($packageName in $script:CodexMicroPackageNames) {
        $candidates = @($packages | Where-Object Name -eq $packageName | Sort-Object Version -Descending)
        if ($candidates.Count -gt 0) {
            return $candidates[0]
        }
    }

    return $null
}

function Set-CodexMicroWindowActive {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Automation.AutomationElement]$Window
    )

    $windowPattern = $null
    if ($Window.TryGetCurrentPattern(
        [System.Windows.Automation.WindowPattern]::Pattern,
        [ref]$windowPattern
    )) {
        if ($windowPattern.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) {
            $windowPattern.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
        }
    }

    try {
        $Window.SetFocus()
    }
    catch {
    }
}

function Open-CodexMicroDesktop {
    $existingWindow = Get-CodexMicroMainWindow
    $package = Get-CodexMicroPackageForWindow -Window $existingWindow
    if ($null -eq $package) {
        throw 'No installed OpenAI Codex desktop package was found.'
    }

    $appUserModelId = '{0}!App' -f $package.PackageFamilyName
    $activation = Start-Process -FilePath 'explorer.exe' -ArgumentList @(
        'shell:AppsFolder\{0}' -f $appUserModelId
    ) -PassThru
    [void]$activation.WaitForExit(3000)

    $window = Wait-CodexMicroMainWindow
    if ($null -eq $window) {
        throw "Codex package '$($package.Name)' was activated, but its main window did not become available."
    }

    Set-CodexMicroWindowActive -Window $window
    return [pscustomobject]@{
        Window = $window
        Package = $package
        AppUserModelId = $appUserModelId
    }
}

function Get-CodexMicroWindowOrOpen {
    $window = Get-CodexMicroMainWindow
    if ($null -ne $window) {
        return $window
    }

    return (Open-CodexMicroDesktop).Window
}

function Get-CodexMicroElements {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Automation.AutomationElement]$Root,
        [Parameter(Mandatory = $true)]
        [System.Windows.Automation.ControlType]$ControlType,
        [string]$Name = '',
        [switch]$Prefix,
        [switch]$Visible,
        [switch]$Enabled,
        [System.Windows.Automation.AutomationPattern]$Pattern
    )

    $condition = New-Object System.Windows.Automation.PropertyCondition -ArgumentList @(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        $ControlType
    )
    $matches = New-Object System.Collections.Generic.List[System.Windows.Automation.AutomationElement]
    foreach ($element in $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
        if ($Visible -and $element.Current.IsOffscreen) {
            continue
        }
        if ($Enabled -and -not $element.Current.IsEnabled) {
            continue
        }
        if (-not [string]::IsNullOrWhiteSpace($Name)) {
            $elementName = [string]$element.Current.Name
            $nameMatches = if ($Prefix) {
                $elementName.StartsWith($Name, [StringComparison]::OrdinalIgnoreCase)
            }
            else {
                $elementName.Equals($Name, [StringComparison]::OrdinalIgnoreCase)
            }
            if (-not $nameMatches) {
                continue
            }
        }
        if ($null -ne $Pattern) {
            $patternObject = $null
            if (-not $element.TryGetCurrentPattern($Pattern, [ref]$patternObject)) {
                continue
            }
        }
        [void]$matches.Add($element)
    }

    return @($matches)
}

function Get-CodexMicroFirstElement {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Automation.AutomationElement]$Root,
        [Parameter(Mandatory = $true)]
        [System.Windows.Automation.ControlType]$ControlType,
        [string]$Name = '',
        [switch]$Prefix,
        [switch]$Visible,
        [switch]$Enabled,
        [System.Windows.Automation.AutomationPattern]$Pattern
    )

    $arguments = @{
        Root = $Root
        ControlType = $ControlType
        Name = $Name
        Prefix = $Prefix
        Visible = $Visible
        Enabled = $Enabled
        Pattern = $Pattern
    }
    $elements = @(Get-CodexMicroElements @arguments)
    if ($elements.Count -eq 0) {
        return $null
    }
    return $elements[0]
}

function Invoke-CodexMicroButton {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $window = Get-CodexMicroWindowOrOpen
    $button = Get-CodexMicroFirstElement `
        -Root $window `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name $Name `
        -Visible `
        -Enabled `
        -Pattern ([System.Windows.Automation.InvokePattern]::Pattern)
    if ($null -eq $button) {
        throw "Codex does not currently expose an enabled '$Name' accessibility button."
    }

    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}

function Wait-CodexMicroMenuItem {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [switch]$Prefix,
        [System.Windows.Automation.AutomationPattern]$Pattern = [System.Windows.Automation.InvokePattern]::Pattern
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($script:CodexMicroMenuWaitMilliseconds)
    do {
        $window = Get-CodexMicroMainWindow
        if ($null -ne $window) {
            $item = Get-CodexMicroFirstElement `
                -Root $window `
                -ControlType ([System.Windows.Automation.ControlType]::MenuItem) `
                -Name $Name `
                -Prefix:$Prefix `
                -Visible `
                -Enabled `
                -Pattern $Pattern
            if ($null -ne $item) {
                return $item
            }
        }
        Start-Sleep -Milliseconds $script:CodexMicroPollMilliseconds
    } while ([DateTime]::UtcNow -lt $deadline)

    return $null
}

function Open-CodexMicroMenu {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $window = Get-CodexMicroWindowOrOpen
    $button = Get-CodexMicroFirstElement `
        -Root $window `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name $Name `
        -Visible `
        -Enabled `
        -Pattern ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($null -eq $button) {
        throw "Codex does not expose its '$Name' menu through accessibility."
    }

    $button.SetFocus()
    $expand = $button.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($expand.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) {
        $expand.Collapse()
        Start-Sleep -Milliseconds 100
        $window = Get-CodexMicroMainWindow
        $button = Get-CodexMicroFirstElement `
            -Root $window `
            -ControlType ([System.Windows.Automation.ControlType]::Button) `
            -Name $Name `
            -Visible `
            -Enabled `
            -Pattern ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        $button.SetFocus()
        $expand = $button.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    }
    $expand.Expand()
}

function Invoke-CodexMicroViewCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandPrefix
    )

    Open-CodexMicroMenu -Name 'View'
    $item = Wait-CodexMicroMenuItem -Name $CommandPrefix -Prefix
    if ($null -eq $item) {
        throw "The verified Codex View command '$CommandPrefix' is not currently available."
    }
    $item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}

function Get-CodexMicroComposerModelButton {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Automation.AutomationElement]$Window
    )

    $dictate = Get-CodexMicroFirstElement `
        -Root $Window `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name 'Dictate' `
        -Visible `
        -Enabled `
        -Pattern ([System.Windows.Automation.InvokePattern]::Pattern)
    if ($null -eq $dictate) {
        throw 'Codex does not currently expose its Dictate control, so the composer model control cannot be located safely.'
    }

    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $candidate = $walker.GetPreviousSibling($dictate)
    while ($null -ne $candidate) {
        if (
            $candidate.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
            -not $candidate.Current.IsOffscreen -and
            $candidate.Current.IsEnabled
        ) {
            $pattern = $null
            if ($candidate.TryGetCurrentPattern(
                [System.Windows.Automation.ExpandCollapsePattern]::Pattern,
                [ref]$pattern
            )) {
                return $candidate
            }
        }
        $candidate = $walker.GetPreviousSibling($candidate)
    }

    throw 'Codex composer model control was not found next to its verified Dictate control.'
}

function Close-CodexMicroModelMenu {
    try {
        $window = Get-CodexMicroMainWindow
        if ($null -eq $window) {
            return
        }
        $modelButton = Get-CodexMicroComposerModelButton -Window $window
        $pattern = $modelButton.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        if ($pattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) {
            $pattern.Collapse()
        }
    }
    catch {
    }
}

function Step-CodexMicroReasoningLevel {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet(-1, 1)]
        [int]$Delta
    )

    $window = Get-CodexMicroWindowOrOpen
    $modelButton = Get-CodexMicroComposerModelButton -Window $window
    $modelMenu = $modelButton.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($modelMenu.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) {
        $modelMenu.Collapse()
        Start-Sleep -Milliseconds 100
        $window = Get-CodexMicroMainWindow
        $modelButton = Get-CodexMicroComposerModelButton -Window $window
        $modelMenu = $modelButton.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    }

    try {
        $modelButton.SetFocus()
        $modelMenu.Expand()

        $effort = Wait-CodexMicroMenuItem `
            -Name 'Effort ' `
            -Prefix `
            -Pattern ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        if ($null -eq $effort) {
            $advanced = Wait-CodexMicroMenuItem `
                -Name 'Show advanced options' `
                -Pattern ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
            if ($null -eq $advanced) {
                throw "Codex model menu exposed neither its Effort control nor 'Show advanced options'."
            }
            $advanced.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
            $effort = Wait-CodexMicroMenuItem `
                -Name 'Effort ' `
                -Prefix `
                -Pattern ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        }
        if ($null -eq $effort) {
            throw 'Codex advanced model menu did not expose its current Effort control.'
        }

        $currentLevel = ([string]$effort.Current.Name).Substring('Effort '.Length).Trim()
        $levels = @($script:CodexMicroReasoningLevels.Keys)
        $currentIndex = [Array]::IndexOf($levels, $currentLevel)
        if ($currentIndex -lt 0) {
            throw "Codex reported unverified reasoning level '$currentLevel'."
        }

        $effort.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
        $targetIndex = $currentIndex + $Delta
        if ($targetIndex -lt 0 -or $targetIndex -ge $levels.Count) {
            return "Reasoning Level: $currentLevel (limit)"
        }

        $targetLevel = [string]$levels[$targetIndex]
        $targetName = [string]$script:CodexMicroReasoningLevels[$targetLevel]
        $target = Wait-CodexMicroMenuItem -Name $targetName
        if ($null -eq $target) {
            throw "Codex did not expose verified reasoning option '$targetName'."
        }
        $target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        return "Reasoning Level: $currentLevel -> $targetLevel"
    }
    finally {
        Close-CodexMicroModelMenu
    }
}

function Get-CodexMicroSelectedThreadTitle {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Automation.AutomationElement]$Window
    )

    $actions = Get-CodexMicroFirstElement `
        -Root $Window `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name 'Task actions' `
        -Visible `
        -Enabled
    if ($null -eq $actions) {
        return ''
    }

    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $parent = $walker.GetParent($actions)
    if ($null -eq $parent) {
        return ''
    }
    $child = $walker.GetFirstChild($parent)
    while ($null -ne $child) {
        if (
            $child.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and
            -not [string]::IsNullOrWhiteSpace([string]$child.Current.Name)
        ) {
            return ([string]$child.Current.Name).Trim()
        }
        $child = $walker.GetNextSibling($child)
    }

    return ''
}

function Get-CodexMicroOverlayState {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId,
        [Parameter(Mandatory = $true)]
        [string]$ThreadTitle
    )

    if ([string]::IsNullOrWhiteSpace($ThreadTitle)) {
        return ''
    }

    foreach ($candidate in Get-CodexMicroTopLevelWindows) {
        if (
            $candidate.Current.ProcessId -ne $ProcessId -or
            $candidate.Current.ControlType -ne [System.Windows.Automation.ControlType]::Pane
        ) {
            continue
        }

        $buttons = Get-CodexMicroElements `
            -Root $candidate `
            -ControlType ([System.Windows.Automation.ControlType]::Button) `
            -Visible `
            -Enabled
        foreach ($button in $buttons) {
            $name = [string]$button.Current.Name
            if (-not $name.StartsWith("$ThreadTitle.", [StringComparison]::OrdinalIgnoreCase)) {
                continue
            }
            if ($name.IndexOf('. Running.', [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return 'Working'
            }
            if ($name.IndexOf('. Needs input.', [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return 'Needs Input'
            }
            if ($name.IndexOf('. Ready.', [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return 'Completed'
            }
            if ($name.IndexOf('. Blocked.', [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return 'Error'
            }
        }
    }

    return ''
}

function Test-CodexMicroVisibleTextPrefix {
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Automation.AutomationElement]$Window,
        [Parameter(Mandatory = $true)]
        [string]$Prefix
    )

    $texts = Get-CodexMicroElements `
        -Root $Window `
        -ControlType ([System.Windows.Automation.ControlType]::Text) `
        -Visible
    foreach ($text in $texts) {
        if (([string]$text.Current.Name).StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Get-CodexMicroThreadStatus {
    $window = Get-CodexMicroMainWindow
    if ($null -eq $window) {
        return 'Unknown'
    }

    $applyChanges = Get-CodexMicroFirstElement `
        -Root $window `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name 'Apply changes' `
        -Visible `
        -Enabled
    $apply = Get-CodexMicroFirstElement `
        -Root $window `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name 'Apply' `
        -Visible `
        -Enabled
    if ($null -ne $applyChanges -or $null -ne $apply) {
        return 'Changes Ready'
    }

    $threadTitle = Get-CodexMicroSelectedThreadTitle -Window $window
    $overlayState = Get-CodexMicroOverlayState `
        -ProcessId $window.Current.ProcessId `
        -ThreadTitle $threadTitle
    if (-not [string]::IsNullOrWhiteSpace($overlayState)) {
        return $overlayState
    }

    $deny = Get-CodexMicroFirstElement `
        -Root $window `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name 'Deny' `
        -Visible `
        -Enabled
    if ($null -ne $deny) {
        return 'Needs Input'
    }

    $stop = Get-CodexMicroFirstElement `
        -Root $window `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name 'Stop' `
        -Visible `
        -Enabled `
        -Pattern ([System.Windows.Automation.InvokePattern]::Pattern)
    if ($null -ne $stop) {
        return 'Working'
    }

    if (Test-CodexMicroVisibleTextPrefix -Window $window -Prefix 'Worked for ') {
        return 'Completed'
    }

    return 'Unknown'
}

function Invoke-CodexMicroAction {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet(
            'OpenCodex',
            'NewTask',
            'VoicePrompt',
            'PreviousThread',
            'NextThread',
            'StopCurrentTask',
            'ReasoningLevelUp',
            'ReasoningLevelDown',
            'RefreshThreadStatus'
        )]
        [string]$Action
    )

    switch ($Action) {
        'OpenCodex' {
            $result = Open-CodexMicroDesktop
            "Open Codex: $($result.Package.Name) $($result.Package.Version)"
        }
        'NewTask' {
            Invoke-CodexMicroButton -Name 'New task'
            'New Task: invoked'
        }
        'VoicePrompt' {
            Invoke-CodexMicroButton -Name 'Dictate'
            'Voice Prompt: invoked Dictate'
        }
        'PreviousThread' {
            Invoke-CodexMicroViewCommand -CommandPrefix 'Previous Task'
            'Previous Thread: invoked Previous Task'
        }
        'NextThread' {
            Invoke-CodexMicroViewCommand -CommandPrefix 'Next Task'
            'Next Thread: invoked Next Task'
        }
        'StopCurrentTask' {
            Invoke-CodexMicroButton -Name 'Stop'
            'Stop Current Task: invoked Stop'
        }
        'ReasoningLevelUp' {
            Step-CodexMicroReasoningLevel -Delta 1
        }
        'ReasoningLevelDown' {
            Step-CodexMicroReasoningLevel -Delta -1
        }
        'RefreshThreadStatus' {
            Get-CodexMicroThreadStatus
        }
    }
}
