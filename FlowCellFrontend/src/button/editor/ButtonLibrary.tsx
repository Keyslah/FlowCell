import type { ReactNode } from "react";
import type { ButtonStateDocument } from "../types";

export interface ButtonLibraryProps {
  document: ButtonStateDocument;
  programName: string;
  panelName: string;
  selectedButtonId: string | null;
  canUpdateSource: boolean;
  busy?: boolean;
  onImportFile: () => void;
  onImportFolder: () => void;
  onUpdateSource: () => void;
  onDeleteButton: () => void;
  onNewRegularPopout: () => void;
  fanBuilder: ReactNode;
}

export function ButtonLibrary(props: ButtonLibraryProps) {
  const selectedButton = props.selectedButtonId
    ? props.document.buttons[props.selectedButtonId]
    : null;
  const importTarget = props.programName && props.panelName
    ? `${props.programName} / ${props.panelName}`
    : "Choose Program and Panel above";

  return (
    <aside className="button-library">
      <h2>Button Actions</h2>
      <p className="button-library__selection">
        {selectedButton ? `Selected: ${selectedButton.label}` : "Select a Button above or in the workspace."}
      </p>
      <button
        type="button"
        disabled={!props.selectedButtonId || selectedButton?.role === "panel-owner" || props.busy}
        onClick={props.onDeleteButton}
      >
        Delete Button
      </button>
      <h3>Add Button content</h3>
      <p className="button-library__target">Target: {importTarget}</p>
      <div className="button-editor-actions">
        <button type="button" disabled={!props.programName || !props.panelName || props.busy} onClick={props.onImportFile}>Choose Button file...</button>
        <button type="button" disabled={!props.programName || !props.panelName || props.busy} onClick={props.onImportFolder}>Choose Button package folder...</button>
        <button type="button" disabled={!props.canUpdateSource || props.busy} onClick={props.onUpdateSource}>Update selected source package...</button>
      </div>
      <div className="button-editor-actions">
        <button type="button" disabled={props.busy} onClick={props.onNewRegularPopout}>New regular popout</button>
      </div>
      {props.fanBuilder}
      <h3>Skin Library</h3>
      <ul>{Object.values(props.document.skins).map((skin) => <li key={skin.id}>{skin.name}</li>)}</ul>
    </aside>
  );
}
