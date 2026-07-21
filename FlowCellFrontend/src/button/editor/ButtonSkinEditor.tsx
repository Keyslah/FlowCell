import { useMemo, useRef, useState } from "react";
import {
  BUTTON_SKIN_COMPILER_VERSION,
  type ButtonCoreMeasurement,
  type ButtonSkin,
  type ButtonSkinSectionName
} from "../types";
import {
  BUTTON_SKIN_SECTION_ORDER,
  type ButtonSkinSectionSource
} from "../skins/buttonSkinFormat";
import {
  applyNamedButtonSkinSections,
  parseButtonSkinPaste,
  replaceEntireButtonSkin
} from "../skins/skinPasteParser";
import { compileButtonSkin, diagnosticsBySkinSection } from "../skins/skinCompiler";
import { ButtonSkinRenderer } from "../skins/ButtonSkinRenderer";

export interface ButtonSkinEditorProps {
  skin: ButtonSkin | null;
  buttonLabel: string;
  onButtonLabelChange: (label: string) => void;
  onSkinChange: (skin: ButtonSkin, label: string, coalesceKey?: string) => void;
  onCreateSkin: () => void;
  onDuplicateSkin: () => void;
}

function skinSections(skin: ButtonSkin): ButtonSkinSectionSource {
  return Object.fromEntries(
    BUTTON_SKIN_SECTION_ORDER.map((section) => [section, skin[section]])
  ) as unknown as ButtonSkinSectionSource;
}

function withSections(skin: ButtonSkin, sections: ButtonSkinSectionSource): ButtonSkin {
  const next = { ...skin, ...sections };
  const compiled = compileButtonSkin(next);
  next.compileCache = compiled.ok
    ? {
        compilerVersion: BUTTON_SKIN_COMPILER_VERSION,
        sourceFingerprint: compiled.compiled.sourceFingerprint
      }
    : skin.compileCache;
  return next;
}

function sectionLabel(section: ButtonSkinSectionName): string {
  return section.replace(/(^|-)([a-z])/g, (_, separator: string, letter: string) => `${separator ? " " : ""}${letter.toUpperCase()}`);
}

export function ButtonSkinEditor({
  skin,
  buttonLabel,
  onButtonLabelChange,
  onSkinChange,
  onCreateSkin,
  onDuplicateSkin
}: ButtonSkinEditorProps) {
  const [paste, setPaste] = useState("");
  const pasteRef = useRef<HTMLTextAreaElement | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [updatedSections, setUpdatedSections] = useState<Set<ButtonSkinSectionName>>(new Set());
  const [benchStackWords, setBenchStackWords] = useState(false);
  const [benchTextSize, setBenchTextSize] = useState<number | null>(null);
  const [benchMinimum, setBenchMinimum] = useState(8);
  const [benchMeasurement, setBenchMeasurement] = useState<ButtonCoreMeasurement | null>(null);
  const compileResult = useMemo(() => skin ? compileButtonSkin(skin) : null, [skin]);
  const diagnosticGroups = useMemo(
    () => compileResult && !compileResult.ok ? diagnosticsBySkinSection(compileResult.diagnostics) : {},
    [compileResult]
  );

  if (!skin) {
    return (
      <aside className="button-skin-editor">
        <h2>Skin Editor</h2>
        <p>Select a Button or create a skin.</p>
        <button type="button" onClick={onCreateSkin}>Create New Skin</button>
      </aside>
    );
  }

  const applyPaste = (operation: "named" | "replace", source = paste) => {
    const parsed = parseButtonSkinPaste(source);
    if (!parsed.ok) {
      setPasteError(parsed.message);
      return;
    }
    try {
      const sections = operation === "named"
        ? applyNamedButtonSkinSections(skinSections(skin), parsed)
        : replaceEntireButtonSkin(parsed);
      const next = withSections(skin, sections);
      onSkinChange(next, operation === "named" ? "Apply named skin sections" : "Replace entire skin");
      setUpdatedSections(new Set(parsed.presentSections));
      const compiled = compileButtonSkin(next);
      setPasteError(compiled.ok
        ? null
        : `Sections applied, but the skin does not compile yet:\n${compiled.diagnostics
            .slice(0, 3)
            .map((diagnostic) => `${diagnostic.section}: ${diagnostic.message}`)
            .join("\n")}`);
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <aside className="button-skin-editor">
      <h2>Skin Editor</h2>
      <div className="button-editor-actions">
        <button type="button" onClick={onCreateSkin}>Create New Skin</button>
        <button type="button" onClick={onDuplicateSkin}>Duplicate Skin for This Placement</button>
        <button type="button" onClick={() => pasteRef.current?.focus()}>Import Skin</button>
      </div>
      <label className="button-skin-paste">
        <span>Paste Skin</span>
        <textarea
          ref={pasteRef}
          value={paste}
          rows={9}
          onChange={(event) => setPaste(event.currentTarget.value)}
          onPaste={(event) => {
            const source = event.clipboardData.getData("text");
            if (!source) return;
            event.preventDefault();
            setPaste(source);
            applyPaste("named", source);
          }}
          onKeyDown={(event) => {
            if (event.ctrlKey && event.key === "Enter") {
              event.preventDefault();
              applyPaste("named");
            }
          }}
        />
      </label>
      <div className="button-editor-actions">
        <button type="button" onClick={() => applyPaste("named")}>Apply Named Sections</button>
        <button type="button" onClick={() => applyPaste("replace")}>Replace Entire Skin</button>
      </div>
      {pasteError && <p className="button-editor-error">{pasteError}</p>}
      {BUTTON_SKIN_SECTION_ORDER.map((section) => {
        const diagnostics = diagnosticGroups[section] ?? [];
        const status = diagnostics.length > 0
          ? "Invalid"
          : updatedSections.has(section)
            ? "Updated"
            : skin[section].length === 0
              ? "Empty"
              : "";
        return (
          <details key={section} className="button-skin-section">
            <summary><span>{sectionLabel(section)}</span><small className={status.toLowerCase()}>{status}</small></summary>
            <textarea
              value={skin[section]}
              rows={section === "structure" || section === "keyframes" ? 10 : 5}
              onChange={(event) => {
                const next = withSections(skin, { ...skinSections(skin), [section]: event.currentTarget.value });
                onSkinChange(next, `Edit ${section}`, `skin:${skin.id}:${section}`);
              }}
            />
            {section === "base" ? (
              <p>
                Ordinary declarations style the core. To style a nested face, icon, or frame,
                set the custom properties that its Structure markup consumes.
              </p>
            ) : null}
            {diagnostics.map((diagnostic, index) => <p key={index} className="button-editor-error">{diagnostic.message}</p>)}
          </details>
        );
      })}
      <details className="button-skin-section">
        <summary><span>Button Text</span></summary>
        <p>
          The Button label below is saved and updates every live placement. The remaining
          controls preview text fitting in this Skin Editor only.
        </p>
        <label><span>Button label</span><input value={buttonLabel} onChange={(event) => onButtonLabelChange(event.currentTarget.value)} /></label>
        <label className="button-editor-check"><input type="checkbox" checked={benchStackWords} onChange={(event) => setBenchStackWords(event.currentTarget.checked)} /><span>Stack Words</span></label>
        <label>
          <span>Text size override</span>
          <input
            type="number"
            min={1}
            value={benchTextSize ?? ""}
            placeholder="Auto (use Base)"
            onChange={(event) => {
              const value = event.currentTarget.value;
              setBenchTextSize(value === "" ? null : Math.max(1, Number(value)));
            }}
          />
        </label>
        <label><span>Minimum font-size preview</span><input type="number" min={1} value={benchMinimum} onChange={(event) => setBenchMinimum(Number(event.currentTarget.value))} /></label>
        <div className="button-text-bench-preview">
          <ButtonSkinRenderer
            skin={skin}
            label={buttonLabel}
            constrained={false}
            textFitMode={benchStackWords ? "stack-whole-words" : "shrink"}
            minimumFontSize={benchMinimum}
            textSizeOverride={benchTextSize ?? undefined}
            previewStackWords={benchStackWords}
            onMeasurement={setBenchMeasurement}
          />
        </div>
        <p>Core: {benchMeasurement ? `${benchMeasurement.width.toFixed(1)} x ${benchMeasurement.height.toFixed(1)}` : "measuring"}</p>
        {benchMeasurement && <p>Overflow: T {benchMeasurement.visualOverflow.top.toFixed(1)}, R {benchMeasurement.visualOverflow.right.toFixed(1)}, B {benchMeasurement.visualOverflow.bottom.toFixed(1)}, L {benchMeasurement.visualOverflow.left.toFixed(1)}</p>}
      </details>
    </aside>
  );
}
