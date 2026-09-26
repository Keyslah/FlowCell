# Krita Tools

The Tools panel contains **Ellipse Assistant** and **SVG Stencil**. Ellipse Assistant selects Krita's
Assistant Tool and sets the assistant type to Ellipse, ready for the user to
place it on the canvas. It does not draw an ellipse or add assistant geometry.
An open document is required.

The ordinary script package calls the existing FlowCell Layers bridge action
`ellipse_assistant`. The bridge selects `KisAssistantTool`, locates the native
`availableAssistantsComboBox` in the active window, and selects the `ellipse`
item data. It verifies both selections and rejects missing or ambiguous controls.
This follows [Krita's assistant tool source](https://github.com/KDE/krita/blob/master/plugins/assistants/Assistants/kis_assistant_tool.cc).

Restart Krita after installing the updated plugin, and restart FlowCell after
installing the panel manifest/registration. Existing Toolbox buttons are retained.
`tests/test_ellipse_assistant.py` runs without launching either application;
these checks do not replace a live button click in Krita.

SVG Stencil opens an SVG file picker, imports its shapes with Krita's vector
layer API, and creates a group named for the file. The vector **SVG Stencil**
layer is above a **Paint Here** paint layer, receives color label index 1, and
Paint Here becomes active. Canceling or finding no importable shapes adds no
group. The SVG text goes to Krita unchanged apart from removing a UTF-8 BOM,
so the imported shapes retain the styling Krita supports. Set the Contiguous
Selection Tool to **Color Labeled Layers** manually and select label 1 there;
the Python API does not expose that tool option. Krita must load the updated
FlowCell Layers extension before this button can run.

The importer passed three focused headless checks and the installed bridge's
18/18 disposable-document self-tests, including real vector shapes and exported
stroke/fill styling.
The installed FlowCell state contains the new Tools Button. The interactive
file picker and Button click have not been exercised in a visible Krita session.
