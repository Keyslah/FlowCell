# FlowCell AI Skills

Use this page when prompting Codex or another AI helper to work on FlowCell.

Use the skill names first. The source paths below show the current local install paths.

Copy/paste this line when the task is about Blender Add Script, toolsets, popouts, skins, or FlowCell maintenance:

```text
Use the FlowCell AI skills in docs/ai-skills.md. For Blender Add Script/toolset work, use flow-test and toolsets; add svgtools for exact SVG layouts, blender-theme for theme/HDRI work, and react-tauri-button-skin-contract when button skins, hitboxes, or imported visual code are involved.
```

## Skills

### flow-test

Use for the main FlowCell/FlowTest maintenance workflow: frontend/backend changes, Blender bridge work, generated actions, scripts, logs, runtime state, and the State Layer / Functional Host Layer / Visual Skin Layer split.

Skill source: `C:/Users/aaron/AppData/Local/CodexClean/skills/flow-test/SKILL.md`

### layout

Use for Save Layout / Load Layout bugs, Pop/Fan windows, tool windows, wrong window size or position, restore races, topmost behavior, taskbar previews, and saved bounds.

Skill source: `C:/Users/aaron/AppData/Local/CodexClean/skills/layout/SKILL.md`

### toolsets

Use for Add Script owner-button imports, child-bearing toolsets, Pop/Fan routing, dedicated or generic toolset popouts, selected states, dropdown fanouts, and program-scoped topmost behavior.

Skill source: `C:/Users/aaron/AppData/Local/CodexClean/skills/flowtest-tool-set-buttons/SKILL.md`

### flowtest-fanout-buttons

Use for fanout buttons and panel Fan popout windows: hover-open, click-pin, collapsed owner bounds, child button placement, and keeping fan windows scoped to their owning program.

Skill source: `C:/Users/aaron/AppData/Local/CodexClean/skills/flowtest-fanout-buttons/SKILL.md`

### svgtools

Use for exact SVG-driven FlowCell/FlowTest toolboxes where the SVG is the geometry contract: fixed hitboxes, literal dimensions, canonical bounds, and no interpreted layout.

Skill source: `C:/Users/aaron/AppData/Local/CodexClean/skills/svgtools/SKILL.md`

### blender-theme

Use for Blender theme/HDRI work, Blender UI theme color mapping, theme bridge actions, and Blender-version-specific theme RNA paths.

Skill source: `C:/Users/aaron/AppData/Local/CodexClean/skills/blender-theme/SKILL.md`

### react-tauri-button-skin-contract

Use for imported button skins, host-vs-skin separation, hitboxes, label measurement, row fitting, and keeping visual skin code separate from FlowCell behavior.

Skill source: `C:/Users/aaron/AppData/Local/CodexClean/skills/react-tauri-button-skin-contract/SKILL.md`
