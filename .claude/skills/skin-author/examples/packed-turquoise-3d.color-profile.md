# Color Profile Preview

- Surface — `--flowcell-button-color-surface: #38A19D`
  - Face light target `#3DCD9E`; driven by `--flowcell-button-shade-surface-face-light: color-mix(in oklch,var(--flowcell-button-color-surface,#38A19D),white 12%)`
  - Face dark target `#369D8D`; driven by `--flowcell-button-shade-surface-face-dark: color-mix(in oklch,var(--flowcell-button-color-surface,#38A19D),black 7%)`
  - Depth target `#38A19D`; driven by `--flowcell-button-shade-surface-depth: var(--flowcell-button-color-surface,#38A19D)`
- Text — `--flowcell-button-color-text: #FFFFFF`
- Effects excluded — preserved literally
  - Text shadow: `rgba(0,0,0,.25)`
  - Face inset/outer highlights: `rgba(255,255,255,.2)`
  - Depth glints: `rgba(255,255,255,.25)` and `white`
  - Depth/base shadows: `rgba(0,0,0,.5)`, `rgba(0,0,0,.4)`, `rgba(0,0,0,.15)`, `black`, and `rgba(0,0,0,.25)`
- Needs confirmation — none

This preview demonstrates the report shape for the existing literal example; it is review metadata, not another skin section. During a real conversion, tune and visually verify every formula so its initial rendered color matches the listed target before returning the skin. The adjacent `packed-turquoise-3d.skin.txt` remains a clean canonical paste block.
