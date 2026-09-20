# shortcycle

The first press opens setup. Enter one keyboard shortcut per line and click Save.
The next press sends the first shortcut to the last active application. Later
presses send the next shortcut and wrap to the beginning after the last one.
Restarting FlowCell resets the position; the list stays saved. Hold Shift while
pressing the button to edit its list and reset the position.

Use names such as `Ctrl+S`, `Ctrl+Shift+S`, `Alt+Tab`, `F5`, `Win+E` or `Space`.
For punctuation use `Plus`, `Minus`, `Comma`, `Period`, `Slash`, `Backslash`,
`Semicolon`, `Quote`, `LeftBracket`, `RightBracket` or `Backtick`. These refer to
Windows virtual keys on the current keyboard layout; add Shift when needed.

The default button is in Windows / Utility. To add an independent copy to any
program's panel, use Add Button and select this folder's `flowcell.script.json`
or `shortcycle.ps1`. Each installed button stores its own list and cycle position
in its preserved `runtime/shortcycle.json`. Saving or cancelling setup sends no
keys. A missing target or failed key injection does not advance the cycle.
