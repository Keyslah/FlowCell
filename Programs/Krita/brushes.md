# Krita brush Buttons

`save new brush` in **Krita / Brushes** opens Krita's native Save New Brush Preset
dialog. Name the preset and edit its thumbnail there. After a successful Save,
FlowCell creates a regular script Button labeled `Brush name · 25 px`. Cancel
creates nothing. Clicking the generated Button selects the saved preset and
restores the size captured when the dialog opened.

Brushes is only the default panel. Use **Add Panel** to create any Krita panel,
then right-click a saved brush Button on the main page and choose **Add to panel**.
Enter an existing panel name. This adds an independent normal Button linked to the
same brush and size; adding that brush to the same panel again does nothing.
Resaving the same preset updates its linked Buttons without changing their panels,
positions, skins, or custom labels. Deleting a FlowCell Button does not delete the
Krita preset, and acknowledged saves do not recreate deleted Buttons on restart.

The installed Krita extension emits a fixed JSON record only after the native
`resourceSelected` save signal. Records and acknowledgement revisions live under
`%LOCALAPPDATA%/FlowCell/KritaLayers/brush-buttons`. Preset identity uses its exact
resource filename; missing or ambiguous presets report an error instead of picking
a similar brush. Brush names remain JSON data and never become executable script.
Krita retains its native handling of preset-name collisions and overwrites.

FlowCell consumes pending saves while its main window is running, including when
minimized, and resumes pending saves on the next launch. Generated source packages
live in `SupportScripts/GeneratedBrushes`, with ordinary installed copies managed
by FlowCell. Canonical state is committed through the usual revision-checked
repository, then published to existing windows before acknowledging the save.

Krita's Python extension must be reloaded after deployment; the installer requires
Krita to be closed. During development, a controlled hot reload can preserve open
documents. `tests/kritaBrushButtons.test.mjs` covers cross-panel updates and custom
labels; native save/cancel/preset-selection checks run in the real Krita process.
