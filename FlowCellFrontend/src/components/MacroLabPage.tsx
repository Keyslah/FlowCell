import { cursorPosition } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAvailableCandidateShortcuts,
  buildUsedShortcutMap,
  formatShortcutForDisplay,
  normalizeShortcut,
  parseShortcutInput
} from "../lib/bindings";
import {
  clearButtonBinding,
  createRecordedMacroDraft,
  deleteRecordedMacro,
  listRecordedMacros,
  loadRecordedMacro,
  recordMacro,
  runRecordedMacro,
  saveButtonBinding,
  saveRecordedMacro,
  showOpenFileDialog
} from "../lib/tauri";
import type {
  FlowCellBindingsState,
  FlowCellButton,
  LoadStateResponse,
  RecordedMacroChoice,
  RecordedMacroDefinition,
  RecordedMacroStep,
  RecordedMacroStepType
} from "../types";

const STEP_TYPE_OPTIONS: RecordedMacroStepType[] = [
  "ActivateIllustrator",
  "ActivateBlender",
  "ActivatePhotoshop",
  "ActivateWindows",
  "Click",
  "Wheel",
  "Text",
  "Key",
  "Script",
  "Macro"
];

const STEP_TYPE_LABELS: Record<RecordedMacroStepType, string> = {
  ActivateIllustrator: "Activate Illustrator",
  ActivateBlender: "Activate Blender",
  ActivatePhotoshop: "Activate Photoshop",
  ActivateWindows: "Activate Windows",
  Click: "Click",
  Wheel: "Wheel",
  Text: "Text",
  Key: "Keys",
  Script: "Script",
  Macro: "Macro"
};

const BUTTON_OPTIONS = ["Left", "Right", "Middle"];
const DIRECTION_OPTIONS = ["Down", "Up"];

type BulkStepType = "" | RecordedMacroStepType;

interface MacroLabProgramOption {
  id: number;
  label: string;
  scriptFolder?: string;
}

interface MacroLabPageProps {
  bindingsState: FlowCellBindingsState | null;
  selectedProgramId: number;
  selectedProgramName: string;
  selectedProgramScriptFolder?: string;
  programOptions: MacroLabProgramOption[];
  onSelectProgram: (programId: number) => void;
  onReloadAppFromDisk: () => Promise<LoadStateResponse>;
  onFrontendEvent: (message: string) => void;
}

interface BulkStepEditor {
  type: BulkStepType;
  delayMs: string;
  x: string;
  y: string;
  button: string;
  count: string;
  direction: string;
  text: string;
  keys: string;
  target: string;
}

function cloneStep(step: RecordedMacroStep): RecordedMacroStep {
  return {
    ...step
  };
}

function cloneDefinition(definition: RecordedMacroDefinition): RecordedMacroDefinition {
  return {
    ...definition,
    steps: definition.steps.map(cloneStep)
  };
}

function isRecordedMacroStepType(value: string): value is RecordedMacroStepType {
  return STEP_TYPE_OPTIONS.includes(value as RecordedMacroStepType);
}

function normalizeDelayMs(value: number | string | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  }
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function getActivationStepTypeForProgram(programName: string): RecordedMacroStepType {
  const normalized = programName.trim().toLowerCase();
  if (normalized.includes("illustrator")) {
    return "ActivateIllustrator";
  }
  if (normalized.includes("blender")) {
    return "ActivateBlender";
  }
  if (normalized.includes("photoshop")) {
    return "ActivatePhotoshop";
  }
  return "ActivateWindows";
}

function createEmptyBulkEditor(): BulkStepEditor {
  return {
    type: "",
    delayMs: "0",
    x: "",
    y: "",
    button: "",
    count: "",
    direction: "",
    text: "",
    keys: "",
    target: ""
  };
}

function buildDefaultStep(type: RecordedMacroStepType): RecordedMacroStep {
  switch (type) {
    case "Wheel":
      return { type, delayMs: 0, x: "0", y: "0", direction: "Down", count: "1" };
    case "Text":
      return { type, delayMs: 0, text: "" };
    case "Key":
      return { type, delayMs: 0, keys: "" };
    case "Script":
      return { type, delayMs: 0, scriptPath: "" };
    case "Macro":
      return { type, delayMs: 0, macroPath: "" };
    case "ActivateIllustrator":
    case "ActivateBlender":
    case "ActivatePhotoshop":
    case "ActivateWindows":
      return { type, delayMs: 0 };
    case "Click":
    default:
      return { type: "Click", delayMs: 0, x: "0", y: "0", button: "Left", count: "1" };
  }
}

function normalizeStep(step: RecordedMacroStep): RecordedMacroStep {
  const nextType = isRecordedMacroStepType(String(step.type ?? "").trim())
    ? (String(step.type).trim() as RecordedMacroStepType)
    : "Click";
  const nextDelay = normalizeDelayMs(step.delayMs);
  switch (nextType) {
    case "ActivateIllustrator":
    case "ActivateBlender":
    case "ActivatePhotoshop":
    case "ActivateWindows":
      return { type: nextType, delayMs: nextDelay };
    case "Wheel":
      return {
        type: nextType,
        delayMs: nextDelay,
        x: step.x?.trim() || "0",
        y: step.y?.trim() || "0",
        direction: step.direction?.trim() || "Down",
        count: step.count?.trim() || "1"
      };
    case "Text":
      return { type: nextType, delayMs: nextDelay, text: step.text ?? "" };
    case "Key":
      return { type: nextType, delayMs: nextDelay, keys: step.keys ?? "" };
    case "Script":
      return { type: nextType, delayMs: nextDelay, scriptPath: step.scriptPath?.trim() ?? "" };
    case "Macro":
      return {
        type: nextType,
        delayMs: nextDelay,
        macroPath: step.macroPath?.trim() ?? step.scriptPath?.trim() ?? ""
      };
    case "Click":
    default:
      return {
        type: "Click",
        delayMs: nextDelay,
        x: step.x?.trim() || "0",
        y: step.y?.trim() || "0",
        button: step.button?.trim() || "Left",
        count: step.count?.trim() || "1"
      };
  }
}

function getStepTargetValue(step: RecordedMacroStep): string {
  if (step.type === "Macro") {
    return step.macroPath?.trim() ?? "";
  }
  if (step.type === "Script") {
    return step.scriptPath?.trim() ?? "";
  }
  return "";
}

function setStepTargetValue(step: RecordedMacroStep, target: string): RecordedMacroStep {
  const trimmed = target.trim();
  if (step.type === "Macro") {
    return { ...step, macroPath: trimmed, scriptPath: "" };
  }
  return { ...step, scriptPath: trimmed, macroPath: "" };
}

function buildBulkEditorFromStep(step: RecordedMacroStep): BulkStepEditor {
  const normalized = normalizeStep(step);
  return {
    type: normalized.type as BulkStepType,
    delayMs: String(normalized.delayMs),
    x: normalized.x ?? "",
    y: normalized.y ?? "",
    button: normalized.button ?? "",
    count: normalized.count ?? "",
    direction: normalized.direction ?? "",
    text: normalized.text ?? "",
    keys: normalized.keys ?? "",
    target: getStepTargetValue(normalized)
  };
}

function buildStepFromBulkEditor(editor: BulkStepEditor): RecordedMacroStep {
  const nextType =
    editor.type && isRecordedMacroStepType(editor.type)
      ? editor.type
      : editor.target.trim()
        ? "Script"
        : "Click";
  const base = buildDefaultStep(nextType);
  return normalizeStep({
    ...base,
    delayMs: normalizeDelayMs(editor.delayMs),
    x: editor.x.trim(),
    y: editor.y.trim(),
    button: editor.button.trim(),
    count: editor.count.trim(),
    direction: editor.direction.trim(),
    text: editor.text,
    keys: editor.keys,
    scriptPath: nextType === "Script" ? editor.target.trim() : "",
    macroPath: nextType === "Macro" ? editor.target.trim() : ""
  });
}

function applyBulkEditorToStep(step: RecordedMacroStep, editor: BulkStepEditor): RecordedMacroStep {
  const current = normalizeStep(step);
  const nextType =
    editor.type && isRecordedMacroStepType(editor.type) ? editor.type : current.type;
  const target = editor.target.trim();
  return normalizeStep({
    ...current,
    type: nextType,
    delayMs: normalizeDelayMs(editor.delayMs),
    x: editor.x.trim(),
    y: editor.y.trim(),
    button: editor.button.trim(),
    count: editor.count.trim(),
    direction: editor.direction.trim(),
    text: editor.text,
    keys: editor.keys,
    scriptPath: nextType === "Script" ? target : "",
    macroPath: nextType === "Macro" ? target : ""
  });
}

function clearStepForType(step: RecordedMacroStep): RecordedMacroStep {
  const normalized = normalizeStep(step);
  switch (normalized.type) {
    case "Text":
      return { type: normalized.type, delayMs: 0, text: "" };
    case "Key":
      return { type: normalized.type, delayMs: 0, keys: "" };
    case "Script":
      return { type: normalized.type, delayMs: 0, scriptPath: "" };
    case "Macro":
      return { type: normalized.type, delayMs: 0, macroPath: "" };
    default:
      return buildDefaultStep(normalized.type as RecordedMacroStepType);
  }
}

function buildMacroBindingButton(definition: RecordedMacroDefinition, shortcut: string): FlowCellButton {
  return {
    Id: `macro_bind_${definition.id}`,
    Kind: "macro",
    command_id: "flowcell.run_macro",
    Label: definition.label,
    Target: definition.id,
    Shortcut: shortcut,
    BindingId: 0,
    style_group_id: ""
  };
}

function normalizeMacroDefinition(definition: RecordedMacroDefinition | null): string {
  return JSON.stringify(definition ?? null);
}

function buildDefinitionForSave(definition: RecordedMacroDefinition): RecordedMacroDefinition {
  return {
    ...definition,
    label: definition.label.trim(),
    steps: definition.steps.map(normalizeStep)
  };
}

function validateMacroDefinition(definition: RecordedMacroDefinition): string | null {
  if (!definition.label.trim()) {
    return "Enter a macro name before saving.";
  }
  if (definition.steps.length === 0) {
    return "Add at least one step before saving.";
  }
  for (let index = 0; index < definition.steps.length; index += 1) {
    const step = normalizeStep(definition.steps[index]);
    if (step.type === "Script" && !step.scriptPath?.trim()) {
      return `Step ${index + 1} needs a script target.`;
    }
    if (step.type === "Macro" && !step.macroPath?.trim()) {
      return `Step ${index + 1} needs a nested macro target.`;
    }
  }
  return null;
}

function formatMousePosition(point: { x: number; y: number } | null): string {
  return point ? `${Math.round(point.x)}, ${Math.round(point.y)}` : "Unavailable";
}

function waitMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

export function MacroLabPage(props: MacroLabPageProps) {
  const {
    bindingsState,
    selectedProgramId,
    selectedProgramName,
    selectedProgramScriptFolder,
    programOptions,
    onSelectProgram,
    onReloadAppFromDisk,
    onFrontendEvent
  } = props;

  const [macroChoices, setMacroChoices] = useState<RecordedMacroChoice[]>([]);
  const [selectedMacroId, setSelectedMacroId] = useState("");
  const [draft, setDraft] = useState<RecordedMacroDefinition | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState(normalizeMacroDefinition(null));
  const [feedback, setFeedback] = useState("Loading recorded macros...");
  const [shortcutInput, setShortcutInput] = useState("");
  const [bulkEditor, setBulkEditor] = useState<BulkStepEditor>(createEmptyBulkEditor());
  const [selectedStepIndexes, setSelectedStepIndexes] = useState<number[]>([]);
  const [mousePoint, setMousePoint] = useState<{ x: number; y: number } | null>(null);
  const [undoStack, setUndoStack] = useState<RecordedMacroStep[][]>([]);
  const [redoStack, setRedoStack] = useState<RecordedMacroStep[][]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isPickingXY, setIsPickingXY] = useState(false);
  const editTokenRef = useRef("");

  const draftFingerprint = useMemo(() => normalizeMacroDefinition(draft), [draft]);
  const isDirty = draft !== null && draftFingerprint !== savedFingerprint;
  const savedMacroIds = useMemo(() => new Set(macroChoices.map((choice) => choice.id)), [macroChoices]);
  const isSavedMacro = draft ? savedMacroIds.has(draft.id) : false;
  const currentShortcut = draft ? bindingsState?.actionHotkeys?.[draft.id] ?? "" : "";
  const nestedMacroChoices = useMemo(() => {
    if (!draft) {
      return macroChoices;
    }
    return macroChoices.filter((choice) => choice.id !== draft.id);
  }, [draft, macroChoices]);
  const parsedShortcut = parseShortcutInput(shortcutInput);
  const usedShortcuts = useMemo(
    () => buildUsedShortcutMap(bindingsState, currentShortcut),
    [bindingsState, currentShortcut]
  );
  const availableShortcuts = useMemo(
    () => buildAvailableCandidateShortcuts(bindingsState, parsedShortcut || currentShortcut),
    [bindingsState, currentShortcut, parsedShortcut]
  );
  const bindConflict =
    parsedShortcut.length > 0 && usedShortcuts.has(normalizeShortcut(parsedShortcut));

  useEffect(() => {
    setShortcutInput(formatShortcutForDisplay(currentShortcut));
  }, [currentShortcut, draft?.id]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void cursorPosition()
        .then((position) => {
          setMousePoint({ x: position.x, y: position.y });
        })
        .catch(() => {});
    }, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const resetHistory = () => {
    editTokenRef.current = "";
    setUndoStack([]);
    setRedoStack([]);
  };

  const syncDraftState = (definition: RecordedMacroDefinition | null, nextFeedback?: string) => {
    if (!definition) {
      setDraft(null);
      setSelectedMacroId("");
      setSavedFingerprint(normalizeMacroDefinition(null));
      setSelectedStepIndexes([]);
      setBulkEditor(createEmptyBulkEditor());
      resetHistory();
      if (nextFeedback) {
        setFeedback(nextFeedback);
      }
      return;
    }

    const normalized = {
      ...cloneDefinition(definition),
      steps: definition.steps.map(normalizeStep)
    };
    setDraft(normalized);
    setSelectedMacroId(normalized.id);
    setSavedFingerprint(normalizeMacroDefinition(normalized));
    setSelectedStepIndexes(normalized.steps.length > 0 ? [0] : []);
    setBulkEditor(
      normalized.steps.length > 0
        ? buildBulkEditorFromStep(normalized.steps[0])
        : createEmptyBulkEditor()
    );
    resetHistory();
    if (nextFeedback) {
      setFeedback(nextFeedback);
    }
  };

  const refreshMacroList = async (
    preferredId?: string,
    options?: { feedback?: string; preserveDraft?: boolean }
  ) => {
    const list = await listRecordedMacros();
    setMacroChoices(list);

    if (options?.preserveDraft && draft && !list.some((choice) => choice.id === draft.id)) {
      if (options.feedback) {
        setFeedback(options.feedback);
      }
      return;
    }

    if (list.length === 0) {
      if (!options?.preserveDraft) {
        syncDraftState(null, options?.feedback ?? "No recorded macros yet. Create one or record a new macro.");
      } else if (options.feedback) {
        setFeedback(options.feedback);
      }
      return;
    }

    const nextId =
      preferredId && list.some((choice) => choice.id === preferredId)
        ? preferredId
        : selectedMacroId && list.some((choice) => choice.id === selectedMacroId)
          ? selectedMacroId
          : list[0].id;
    const loaded = await loadRecordedMacro(nextId);
    syncDraftState(loaded, options?.feedback);
  };

  useEffect(() => {
    void refreshMacroList().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Load Macro Lab failed. ${message}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draft) {
      setSelectedStepIndexes([]);
      setBulkEditor(createEmptyBulkEditor());
      return;
    }
    if (selectedStepIndexes.length === 0) {
      return;
    }
    const [firstIndex] = selectedStepIndexes;
    if (firstIndex < 0 || firstIndex >= draft.steps.length) {
      const fallbackSelection = draft.steps.length > 0 ? [0] : [];
      setSelectedStepIndexes(fallbackSelection);
      setBulkEditor(
        fallbackSelection.length > 0
          ? buildBulkEditorFromStep(draft.steps[fallbackSelection[0]])
          : createEmptyBulkEditor()
      );
      return;
    }
    setBulkEditor(buildBulkEditorFromStep(draft.steps[firstIndex]));
  }, [draft, selectedStepIndexes]);

  const guardDirtyDraft = () => {
    if (!isDirty) {
      return true;
    }
    return window.confirm("Discard unsaved Macro Lab changes?");
  };

  const pushUndoSnapshot = (steps: RecordedMacroStep[]) => {
    const snapshot = steps.map(cloneStep);
    setUndoStack((current) => [...current.slice(-59), snapshot]);
    setRedoStack([]);
  };

  const commitStepMutation = (
    mutator: (currentSteps: RecordedMacroStep[]) => {
      steps: RecordedMacroStep[];
      selection?: number[];
      nextBulkEditor?: BulkStepEditor;
    },
    options?: { recordHistory?: boolean }
  ) => {
    if (!draft) {
      return;
    }

    const currentSteps = draft.steps.map(cloneStep);
    if (options?.recordHistory) {
      pushUndoSnapshot(currentSteps);
    }
    editTokenRef.current = "";

    const result = mutator(currentSteps);
    const nextSteps = result.steps.map(normalizeStep);
    const nextSelection =
      result.selection?.filter((index) => index >= 0 && index < nextSteps.length) ??
      selectedStepIndexes.filter((index) => index >= 0 && index < nextSteps.length);

    setDraft({
      ...draft,
      steps: nextSteps
    });
    setSelectedStepIndexes(nextSelection);
    setBulkEditor(
      result.nextBulkEditor ??
        (nextSelection.length > 0 && nextSteps[nextSelection[0]]
          ? buildBulkEditorFromStep(nextSteps[nextSelection[0]])
          : createEmptyBulkEditor())
    );
  };

  const persistDefinition = async (
    definition: RecordedMacroDefinition,
    successFeedback: string,
    successEvent: string
  ) => {
    const nextDefinition = buildDefinitionForSave(definition);
    const validationMessage = validateMacroDefinition(nextDefinition);
    if (validationMessage) {
      throw new Error(validationMessage);
    }
    const saved = await saveRecordedMacro(nextDefinition);
    await refreshMacroList(saved.id, {
      feedback: successFeedback.replace("{label}", saved.label)
    });
    onFrontendEvent(successEvent.replace("{label}", saved.label));
    return saved;
  };

  const handleSelectMacro = async (id: string) => {
    if (!id || id === selectedMacroId || isBusy) {
      return;
    }
    if (!guardDirtyDraft()) {
      return;
    }
    setIsBusy(true);
    try {
      const loaded = await loadRecordedMacro(id);
      syncDraftState(loaded, `Loaded ${loaded.label}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Load macro failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateDraft = async () => {
    const nextLabel = window.prompt("New Macro Name", "New Macro")?.trim();
    if (!nextLabel) {
      return;
    }
    if (!guardDirtyDraft()) {
      return;
    }
    setIsBusy(true);
    try {
      const created = await createRecordedMacroDraft(nextLabel);
      const nextDraft = {
        ...created,
        label: nextLabel,
        steps:
          created.steps.length > 0
            ? created.steps.map(normalizeStep)
            : [buildDefaultStep(getActivationStepTypeForProgram(selectedProgramName))]
      };
      setDraft(nextDraft);
      setSelectedMacroId("");
      setSavedFingerprint(normalizeMacroDefinition(null));
      setSelectedStepIndexes([0]);
      setBulkEditor(buildBulkEditorFromStep(nextDraft.steps[0]));
      resetHistory();
      setFeedback(`Created a new draft for ${nextDraft.label}. Save it when ready.`);
      onFrontendEvent(`Created Macro Lab draft ${nextDraft.label}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Create macro draft failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRecordMacro = async () => {
    const nextLabel = window.prompt("Record Macro Name", "New Recorded Macro")?.trim();
    if (!nextLabel) {
      return;
    }
    if (!guardDirtyDraft()) {
      return;
    }
    setIsBusy(true);
    try {
      const recorded = await recordMacro(nextLabel);
      await onReloadAppFromDisk();
      await refreshMacroList(recorded.id, {
        feedback: `Recorded macro saved as ${recorded.label}.`
      });
      onFrontendEvent(`Recorded macro saved: ${recorded.label}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Record macro failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveMacro = async () => {
    if (!draft) {
      return;
    }
    setIsBusy(true);
    try {
      await persistDefinition(draft, "Saved {label}.", "Saved macro {label}.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Save macro failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveAsMacro = async () => {
    if (!draft) {
      return;
    }
    const nextLabel = window.prompt("Save Macro As", draft.label)?.trim();
    if (!nextLabel) {
      return;
    }
    setIsBusy(true);
    try {
      const duplicate = await createRecordedMacroDraft(nextLabel);
      const saved = await persistDefinition(
        {
          ...duplicate,
          label: nextLabel,
          steps: draft.steps.map(cloneStep)
        },
        "Saved {label} as a new macro.",
        "Saved macro as {label}."
      );
      await refreshMacroList(saved.id, {
        feedback: `Saved ${saved.label} as a new macro.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Save As failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRenameMacro = async () => {
    if (!draft) {
      return;
    }
    const nextLabel = window.prompt("Rename Macro", draft.label)?.trim();
    if (!nextLabel) {
      return;
    }
    setIsBusy(true);
    try {
      if (!isSavedMacro) {
        setDraft({
          ...draft,
          label: nextLabel
        });
        setFeedback(`Renamed draft to ${nextLabel}.`);
      } else {
        await persistDefinition(
          {
            ...draft,
            label: nextLabel
          },
          "Renamed macro to {label}.",
          "Renamed macro to {label}."
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Rename macro failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopyMacro = async () => {
    if (!draft) {
      return;
    }
    const nextLabel = window.prompt("Copy Macro Name", `${draft.label} Copy`)?.trim();
    if (!nextLabel) {
      return;
    }
    setIsBusy(true);
    try {
      const duplicate = await createRecordedMacroDraft(nextLabel);
      const saved = await persistDefinition(
        {
          ...duplicate,
          label: nextLabel,
          steps: draft.steps.map(cloneStep)
        },
        "Copied macro to {label}.",
        "Copied macro to {label}."
      );
      await refreshMacroList(saved.id, {
        feedback: `Copied macro to ${saved.label}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Copy macro failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteMacro = async () => {
    if (!draft) {
      return;
    }

    if (!isSavedMacro) {
      syncDraftState(null, "Discarded the unsaved macro draft.");
      return;
    }

    if (!window.confirm(`Recycle "${draft.label}"?`)) {
      return;
    }

    const remainingChoices = macroChoices.filter((choice) => choice.id !== draft.id);
    const fallbackId = remainingChoices[0]?.id;

    setIsBusy(true);
    try {
      const message = await deleteRecordedMacro(draft.id);
      await onReloadAppFromDisk();
      if (fallbackId) {
        await refreshMacroList(fallbackId, {
          feedback: message
        });
      } else {
        const list = await listRecordedMacros();
        setMacroChoices(list);
        syncDraftState(null, message);
      }
      onFrontendEvent(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Delete macro failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleRunMacro = async () => {
    if (!draft) {
      return;
    }
    if (!isSavedMacro) {
      setFeedback("Save this macro before running it.");
      return;
    }
    setIsBusy(true);
    try {
      let macroId = draft.id;
      if (isDirty) {
        const saved = await persistDefinition(draft, "Saved {label}.", "Saved macro {label}.");
        macroId = saved.id;
      }
      const message = await runRecordedMacro(macroId);
      setFeedback(message);
      onFrontendEvent(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Run macro failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleReloadSelectedMacro = async () => {
    if (!selectedMacroId) {
      return;
    }
    if (!guardDirtyDraft()) {
      return;
    }
    setIsBusy(true);
    try {
      const loaded = await loadRecordedMacro(selectedMacroId);
      syncDraftState(loaded, `Reloaded ${loaded.label}.`);
      onFrontendEvent(`Reloaded macro ${loaded.label}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Reload macro failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleBindShortcut = async () => {
    if (!draft || !isSavedMacro) {
      return;
    }
    if (!parsedShortcut.trim()) {
      setFeedback("Enter a shortcut before binding.");
      return;
    }
    if (bindConflict) {
      setFeedback("That shortcut is already in use.");
      return;
    }
    setIsBusy(true);
    try {
      const shortcut = normalizeShortcut(parsedShortcut);
      const button = buildMacroBindingButton(draft, shortcut);
      const result = await saveButtonBinding({
        button,
        programId: selectedProgramId,
        shortcut
      });
      await onReloadAppFromDisk();
      setFeedback(result.message);
      onFrontendEvent(result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Bind macro shortcut failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleClearShortcut = async () => {
    if (!draft || !isSavedMacro || !currentShortcut) {
      return;
    }
    setIsBusy(true);
    try {
      const button = buildMacroBindingButton(draft, currentShortcut);
      button.BindingId = 0;
      const result = await clearButtonBinding({
        button,
        programId: selectedProgramId
      });
      await onReloadAppFromDisk();
      setFeedback(result.message);
      onFrontendEvent(result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Clear macro shortcut failed. ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const beginStepEdit = (token: string, index: number) => {
    if (!draft) {
      return;
    }
    if (editTokenRef.current !== token) {
      pushUndoSnapshot(draft.steps);
      editTokenRef.current = token;
    }
    if (selectedStepIndexes.length !== 1 || selectedStepIndexes[0] !== index) {
      setSelectedStepIndexes([index]);
    }
  };

  const finishStepEdit = (token: string) => {
    if (editTokenRef.current === token) {
      editTokenRef.current = "";
    }
  };

  const updateStep = (index: number, patch: Partial<RecordedMacroStep>) => {
    commitStepMutation((currentSteps) => {
      currentSteps[index] = normalizeStep({
        ...currentSteps[index],
        ...patch
      });
      return {
        steps: currentSteps,
        selection: [index]
      };
    });
  };

  const handleStepTypeChange = (index: number, nextType: RecordedMacroStepType) => {
    commitStepMutation((currentSteps) => {
      const currentStep = normalizeStep(currentSteps[index]);
      const currentTarget = getStepTargetValue(currentStep);
      const nextStep = buildDefaultStep(nextType);
      nextStep.delayMs = currentStep.delayMs;
      if (nextType === "Click" || nextType === "Wheel") {
        nextStep.x = currentStep.x ?? nextStep.x;
        nextStep.y = currentStep.y ?? nextStep.y;
        nextStep.count = currentStep.count ?? nextStep.count;
      }
      if (nextType === "Click") {
        nextStep.button = currentStep.button ?? nextStep.button;
      }
      if (nextType === "Wheel") {
        nextStep.direction = currentStep.direction ?? nextStep.direction;
      }
      if (nextType === "Text") {
        nextStep.text = currentStep.text ?? "";
      }
      if (nextType === "Key") {
        nextStep.keys = currentStep.keys ?? "";
      }
      if (nextType === "Script") {
        nextStep.scriptPath = currentTarget;
      }
      if (nextType === "Macro") {
        nextStep.macroPath = currentTarget;
      }
      currentSteps[index] = normalizeStep(nextStep);
      return {
        steps: currentSteps,
        selection: [index]
      };
    });
  };

  const handleToggleSelectedStep = (index: number, checked: boolean) => {
    setSelectedStepIndexes((current) => {
      const next = checked ? [...current, index] : current.filter((entry) => entry !== index);
      return Array.from(new Set(next)).sort((left, right) => left - right);
    });
  };

  const handleSelectAllSteps = (checked: boolean) => {
    if (!draft || !checked) {
      setSelectedStepIndexes([]);
      return;
    }
    setSelectedStepIndexes(draft.steps.map((_, index) => index));
  };

  const applyBulkEditorToSelection = (editor: BulkStepEditor = bulkEditor) => {
    if (!draft || selectedStepIndexes.length === 0) {
      setFeedback("Select one or more steps first.");
      return;
    }
    commitStepMutation(
      (currentSteps) => {
        selectedStepIndexes.forEach((index) => {
          currentSteps[index] = applyBulkEditorToStep(currentSteps[index], editor);
        });
        return {
          steps: currentSteps,
          selection: [...selectedStepIndexes],
          nextBulkEditor: editor
        };
      },
      { recordHistory: true }
    );
    setFeedback(`Updated ${selectedStepIndexes.length} selected step${selectedStepIndexes.length === 1 ? "" : "s"}.`);
  };

  const handlePickScriptTarget = async () => {
    try {
      const selectedPaths = await showOpenFileDialog({
        title: `Choose ${selectedProgramName} script for macro step`,
        filter: "All Files (*.*)|*.*",
        initialDirectory: selectedProgramScriptFolder,
        multiselect: false
      });
      if (selectedPaths.length === 0) {
        return;
      }
      const nextEditor: BulkStepEditor = {
        ...bulkEditor,
        type: "Script",
        target: selectedPaths[0]
      };
      setBulkEditor(nextEditor);
      if (selectedStepIndexes.length > 0) {
        applyBulkEditorToSelection(nextEditor);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Pick macro script failed. ${message}`);
    }
  };

  const handlePickCurrentXY = async () => {
    if (isPickingXY) {
      return;
    }

    setIsPickingXY(true);
    setFeedback("Move the mouse. Capturing XY in 2 seconds...");

    try {
      await waitMs(2000);
      const position = await cursorPosition();
      const nextX = String(Math.round(position.x));
      const nextY = String(Math.round(position.y));

      if (draft && selectedStepIndexes.length > 0) {
        commitStepMutation(
          (currentSteps) => {
            selectedStepIndexes.forEach((index) => {
              currentSteps[index] = normalizeStep({
                ...currentSteps[index],
                x: nextX,
                y: nextY
              });
            });
            return {
              steps: currentSteps,
              selection: [...selectedStepIndexes],
              nextBulkEditor: {
                ...bulkEditor,
                x: nextX,
                y: nextY
              }
            };
          },
          { recordHistory: true }
        );
        setFeedback(
          `Captured XY ${nextX}, ${nextY} into ${selectedStepIndexes.length} selected step${selectedStepIndexes.length === 1 ? "" : "s"}.`
        );
      } else {
        setBulkEditor((current) => ({
          ...current,
          x: nextX,
          y: nextY
        }));
        setFeedback(`Captured XY ${nextX}, ${nextY}. Select steps to write it into the grid.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(message);
      onFrontendEvent(`Pick XY failed. ${message}`);
    } finally {
      setIsPickingXY(false);
    }
  };

  const handleMoveSelectedSteps = (direction: -1 | 1) => {
    if (!draft || selectedStepIndexes.length === 0) {
      return;
    }
    const sortedIndexes = [...selectedStepIndexes].sort((left, right) => left - right);
    if (direction < 0 && sortedIndexes[0] <= 0) {
      return;
    }
    if (direction > 0 && sortedIndexes[sortedIndexes.length - 1] >= draft.steps.length - 1) {
      return;
    }
    commitStepMutation(
      (currentSteps) => {
        const selectedSet = new Set(sortedIndexes);
        const moving = sortedIndexes.map((index) => currentSteps[index]);
        const remaining = currentSteps.filter((_, index) => !selectedSet.has(index));
        const insertAt =
          direction < 0
            ? Math.max(sortedIndexes[0] - 1, 0)
            : Math.min(sortedIndexes[sortedIndexes.length - 1] + 2 - sortedIndexes.length, remaining.length);
        return {
          steps: [
            ...remaining.slice(0, insertAt),
            ...moving,
            ...remaining.slice(insertAt)
          ],
          selection: moving.map((_, offset) => insertAt + offset)
        };
      },
      { recordHistory: true }
    );
  };

  const handleAddStep = () => {
    if (!draft) {
      return;
    }
    const step = buildStepFromBulkEditor(bulkEditor);
    const sortedIndexes = [...selectedStepIndexes].sort((left, right) => left - right);
    commitStepMutation(
      (currentSteps) => {
        const insertAt = sortedIndexes.length > 0 ? sortedIndexes[sortedIndexes.length - 1] + 1 : currentSteps.length;
        currentSteps.splice(insertAt, 0, step);
        return {
          steps: currentSteps,
          selection: [insertAt]
        };
      },
      { recordHistory: true }
    );
    setFeedback("Added a step.");
  };

  const handleClearStep = () => {
    if (!draft) {
      return;
    }
    if (selectedStepIndexes.length === 0) {
      setBulkEditor(createEmptyBulkEditor());
      setFeedback("Cleared the step inputs above the grid.");
      return;
    }
    commitStepMutation(
      (currentSteps) => {
        selectedStepIndexes.forEach((index) => {
          currentSteps[index] = clearStepForType(currentSteps[index]);
        });
        return {
          steps: currentSteps,
          selection: [...selectedStepIndexes]
        };
      },
      { recordHistory: true }
    );
    setFeedback(`Cleared ${selectedStepIndexes.length} selected step${selectedStepIndexes.length === 1 ? "" : "s"}.`);
  };

  const handleDuplicateSelectedSteps = () => {
    if (!draft || selectedStepIndexes.length === 0) {
      return;
    }
    const sortedIndexes = [...selectedStepIndexes].sort((left, right) => left - right);
    commitStepMutation(
      (currentSteps) => {
        const copies = sortedIndexes.map((index) => cloneStep(currentSteps[index]));
        const insertAt = sortedIndexes[sortedIndexes.length - 1] + 1;
        currentSteps.splice(insertAt, 0, ...copies);
        return {
          steps: currentSteps,
          selection: copies.map((_, offset) => insertAt + offset)
        };
      },
      { recordHistory: true }
    );
    setFeedback(`Duplicated ${selectedStepIndexes.length} step${selectedStepIndexes.length === 1 ? "" : "s"}.`);
  };

  const handleDeleteSelectedSteps = () => {
    if (!draft || selectedStepIndexes.length === 0) {
      return;
    }
    const sortedIndexes = [...selectedStepIndexes].sort((left, right) => right - left);
    commitStepMutation(
      (currentSteps) => {
        sortedIndexes.forEach((index) => {
          currentSteps.splice(index, 1);
        });
        return {
          steps: currentSteps,
          selection: currentSteps.length > 0 ? [Math.min(sortedIndexes[sortedIndexes.length - 1], currentSteps.length - 1)] : []
        };
      },
      { recordHistory: true }
    );
    setFeedback(`Deleted ${selectedStepIndexes.length} step${selectedStepIndexes.length === 1 ? "" : "s"}.`);
  };

  const handleUndo = () => {
    if (!draft || undoStack.length === 0) {
      return;
    }
    const previous = undoStack[undoStack.length - 1].map(cloneStep);
    const currentSnapshot = draft.steps.map(cloneStep);
    editTokenRef.current = "";
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, currentSnapshot]);
    setDraft({
      ...draft,
      steps: previous
    });
    setSelectedStepIndexes(previous.length > 0 ? [Math.min(selectedStepIndexes[0] ?? 0, previous.length - 1)] : []);
    setBulkEditor(previous.length > 0 ? buildBulkEditorFromStep(previous[0]) : createEmptyBulkEditor());
    setFeedback("Undid the last step change.");
  };

  const handleRedo = () => {
    if (!draft || redoStack.length === 0) {
      return;
    }
    const next = redoStack[redoStack.length - 1].map(cloneStep);
    const currentSnapshot = draft.steps.map(cloneStep);
    editTokenRef.current = "";
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current.slice(-59), currentSnapshot]);
    setDraft({
      ...draft,
      steps: next
    });
    setSelectedStepIndexes(next.length > 0 ? [Math.min(selectedStepIndexes[0] ?? 0, next.length - 1)] : []);
    setBulkEditor(next.length > 0 ? buildBulkEditorFromStep(next[0]) : createEmptyBulkEditor());
    setFeedback("Redid the last step change.");
  };

  const selectedCount = selectedStepIndexes.length;
  const allSelected = !!draft && draft.steps.length > 0 && selectedCount === draft.steps.length;
  const activeProgramOption = programOptions.find((option) => option.id === selectedProgramId);

  return (
    <div className="macro-lab-page">
      <section className="surface-card macro-lab-card macro-lab-toolbar-card">
        <div className="macro-lab-toolbar-row macro-lab-toolbar-row--topline">
          <label className="bind-editor-field">
            <span>Program</span>
            <select
              value={selectedProgramId}
              disabled={isBusy}
              onChange={(event) => onSelectProgram(Number(event.target.value))}
            >
              {programOptions.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.label}
                </option>
              ))}
            </select>
          </label>
          <label className="bind-editor-field macro-lab-toolbar-row__macro-select">
            <span>Macro</span>
            <select
              value={selectedMacroId || ""}
              disabled={isBusy}
              onChange={(event) => {
                if (!event.target.value) {
                  return;
                }
                void handleSelectMacro(event.target.value);
              }}
            >
              {!selectedMacroId ? (
                <option value="">
                  {draft && !isSavedMacro ? "Unsaved Draft" : "Choose a recorded macro"}
                </option>
              ) : null}
              {macroChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label className="bind-editor-field macro-lab-toolbar-row__file">
            <span>File</span>
            <input
              type="text"
              value={draft?.path ?? ""}
              readOnly
              title={draft?.path ?? ""}
            />
          </label>
          <div className="macro-lab-toolbar-row__session">
            <span>{activeProgramOption?.label ?? selectedProgramName}</span>
            <span>Mouse {formatMousePosition(mousePoint)}</span>
            <span>{draft ? `${draft.steps.length} Step${draft.steps.length === 1 ? "" : "s"}` : "No Macro"}</span>
            <span>{selectedCount} Selected</span>
          </div>
        </div>

        <div className="macro-lab-toolbar-row macro-lab-toolbar-row--actions">
          <div className="macro-lab-action-cluster">
            <button type="button" className="surface-action" disabled={isBusy} onClick={() => void handleCreateDraft()}>New Macro</button>
            <button type="button" className="surface-action" disabled={!draft || isBusy} onClick={() => void handleSaveMacro()}>Save</button>
            <button type="button" className="surface-action" disabled={!draft || isBusy} onClick={() => void handleSaveAsMacro()}>Save As</button>
            <button type="button" className="surface-action" disabled={!draft || isBusy} onClick={() => void handleRenameMacro()}>Rename</button>
            <button type="button" className="surface-action" disabled={!draft || isBusy} onClick={() => void handleCopyMacro()}>Copy</button>
            <button type="button" className="surface-action" disabled={!draft || isBusy} onClick={() => void handleDeleteMacro()}>Delete</button>
            <button type="button" className="surface-action" disabled={!draft || !isSavedMacro || isBusy} onClick={() => void handleReloadSelectedMacro()}>Reload</button>
          </div>
          <div className="macro-lab-emphasis-actions">
            <div className="macro-lab-emphasis-actions__buttons">
              <button
                type="button"
                className="surface-action macro-lab-emphasis-button"
                disabled={isBusy}
                onClick={() => void handleRecordMacro()}
              >
                Record
              </button>
              <button
                type="button"
                className="surface-action macro-lab-emphasis-button"
                disabled={!draft || isBusy}
                onClick={() => void handleRunMacro()}
              >
                Run
              </button>
            </div>
            <span className="caption macro-lab-record-note">
              Recording: `F8` stops and saves, `F12` cancels.
            </span>
          </div>
        </div>

        <div className="macro-lab-toolbar-row macro-lab-toolbar-row--binds">
          <label className="bind-editor-field">
            <span>Shortcut Input</span>
            <input
              type="text"
              value={shortcutInput}
              placeholder="Control + Alt + K"
              onChange={(event) => setShortcutInput(event.target.value)}
            />
          </label>
          <label className="bind-editor-field">
            <span>Available Shortcuts</span>
            <select
              value=""
              onChange={(event) => {
                if (!event.target.value) {
                  return;
                }
                setShortcutInput(formatShortcutForDisplay(event.target.value));
              }}
            >
              <option value="">Pick an available shortcut</option>
              {availableShortcuts.map((shortcut) => (
                <option key={shortcut} value={shortcut}>
                  {formatShortcutForDisplay(shortcut)}
                </option>
              ))}
            </select>
          </label>
          <div className="macro-lab-toolbar-row__bind-status">
            <span>Current {formatShortcutForDisplay(currentShortcut) || "None"}</span>
            <span>{isSavedMacro ? "Saved Macro" : "Unsaved Draft"}</span>
          </div>
          <div className="bind-editor-actions">
            <button type="button" className="surface-action" disabled={!isSavedMacro || isBusy || !shortcutInput.trim()} onClick={() => void handleBindShortcut()}>Bind Shortcut</button>
            <button type="button" className="surface-action" disabled={!isSavedMacro || isBusy || !currentShortcut} onClick={() => void handleClearShortcut()}>Clear Shortcut</button>
          </div>
        </div>

        <div className="macro-lab-status-line">
          <span className={isDirty ? "caption macro-lab-status__dirty" : "caption"}>
            {draft ? (isDirty ? "Unsaved changes" : "Saved") : "No macro selected"}
          </span>
          <span className={bindConflict ? "caption bind-editor-feedback is-error" : "caption bind-editor-feedback"}>
            {bindConflict ? "That shortcut is already in use." : feedback || "Build, edit, bind, and run recorded macros here."}
          </span>
        </div>
      </section>
      <section className="surface-card macro-lab-card macro-lab-bulk-card">
        <div className="macro-lab-bulk-grid">
          <label className="bind-editor-field macro-lab-bulk-grid__type">
            <span>Apply Type</span>
            <select value={bulkEditor.type} onChange={(event) => setBulkEditor((current) => ({ ...current, type: event.target.value as BulkStepType }))}>
              <option value="">Keep Type</option>
              {STEP_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {STEP_TYPE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="bind-editor-field macro-lab-bulk-grid__delay">
            <span>Delay</span>
            <input type="number" step="1" value={bulkEditor.delayMs} onChange={(event) => setBulkEditor((current) => ({ ...current, delayMs: event.target.value }))} />
          </label>
          <div className="macro-lab-bulk-grid__pick-xy">
            <span>XY Tools</span>
            <button type="button" className="surface-action" disabled={isPickingXY} onClick={() => void handlePickCurrentXY()}>
              {isPickingXY ? "Picking XY..." : "Pick XY"}
            </button>
          </div>
          <label className="bind-editor-field macro-lab-bulk-grid__xy">
            <span>X</span>
            <input type="text" value={bulkEditor.x} onChange={(event) => setBulkEditor((current) => ({ ...current, x: event.target.value }))} />
          </label>
          <label className="bind-editor-field macro-lab-bulk-grid__xy">
            <span>Y</span>
            <input type="text" value={bulkEditor.y} onChange={(event) => setBulkEditor((current) => ({ ...current, y: event.target.value }))} />
          </label>
          <label className="bind-editor-field macro-lab-bulk-grid__button">
            <span>Button</span>
            <select value={bulkEditor.button} onChange={(event) => setBulkEditor((current) => ({ ...current, button: event.target.value }))}>
              <option value="">Keep Button</option>
              {BUTTON_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="bind-editor-field macro-lab-bulk-grid__count">
            <span>Count</span>
            <input type="text" value={bulkEditor.count} onChange={(event) => setBulkEditor((current) => ({ ...current, count: event.target.value }))} />
          </label>
          <label className="bind-editor-field macro-lab-bulk-grid__direction">
            <span>Direction</span>
            <select value={bulkEditor.direction} onChange={(event) => setBulkEditor((current) => ({ ...current, direction: event.target.value }))}>
              <option value="">Keep Direction</option>
              {DIRECTION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="bind-editor-field macro-lab-bulk-grid__text">
            <span>Text</span>
            <input type="text" value={bulkEditor.text} onChange={(event) => setBulkEditor((current) => ({ ...current, text: event.target.value }))} />
          </label>
          <label className="bind-editor-field macro-lab-bulk-grid__keys">
            <span>Keys</span>
            <input type="text" value={bulkEditor.keys} placeholder="^c or {Enter}" onChange={(event) => setBulkEditor((current) => ({ ...current, keys: event.target.value }))} />
          </label>
          <label className="bind-editor-field macro-lab-bulk-grid__target">
            <span>Target</span>
            <input type="text" value={bulkEditor.target} title={bulkEditor.target} onChange={(event) => setBulkEditor((current) => ({ ...current, target: event.target.value }))} />
          </label>
          <label className="bind-editor-field macro-lab-bulk-grid__target-select">
            <span>Macro</span>
            <select value={bulkEditor.type === "Macro" ? bulkEditor.target : ""} onChange={(event) => setBulkEditor((current) => ({ ...current, type: event.target.value ? "Macro" : current.type, target: event.target.value }))}>
              <option value="">Choose a nested macro</option>
              {nestedMacroChoices.map((choice) => (
                <option key={choice.id} value={choice.path}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <div className="macro-lab-bulk-grid__browse-script">
            <span>Script</span>
            <button type="button" className="surface-action" onClick={() => void handlePickScriptTarget()}>Browse</button>
          </div>
        </div>

        <div className="macro-lab-bulk-actions">
          <button type="button" className="surface-action" disabled={!draft || selectedStepIndexes.length === 0} onClick={() => applyBulkEditorToSelection()}>Apply Selected</button>
          <button type="button" className="surface-action" disabled={!draft || selectedStepIndexes.length === 0} onClick={() => handleMoveSelectedSteps(-1)}>Move Up</button>
          <button type="button" className="surface-action" disabled={!draft || selectedStepIndexes.length === 0} onClick={() => handleMoveSelectedSteps(1)}>Move Down</button>
          <button type="button" className="surface-action" disabled={!draft} onClick={() => handleAddStep()}>Add Step</button>
          <button type="button" className="surface-action" disabled={!draft} onClick={() => handleClearStep()}>Clear Step</button>
          <button type="button" className="surface-action" disabled={!draft || selectedStepIndexes.length === 0} onClick={() => handleDuplicateSelectedSteps()}>Duplicate</button>
          <button type="button" className="surface-action" disabled={!draft || selectedStepIndexes.length === 0} onClick={() => handleDeleteSelectedSteps()}>Delete Step</button>
          <button type="button" className="surface-action" disabled={undoStack.length === 0} onClick={() => handleUndo()}>Undo</button>
          <button type="button" className="surface-action" disabled={redoStack.length === 0} onClick={() => handleRedo()}>Redo</button>
        </div>
      </section>

      <section className="surface-card macro-lab-card macro-lab-grid-card">
        <div className="macro-lab-grid-header">
          <div>
            <span className="eyebrow">Step Grid</span>
            <h2>{draft ? `${draft.steps.length} Step${draft.steps.length === 1 ? "" : "s"}` : "No Steps"}</h2>
          </div>
          <div className="macro-lab-grid-header__meta">
            <span>{selectedCount} Selected</span>
            <span>{undoStack.length} Undo</span>
            <span>{redoStack.length} Redo</span>
          </div>
        </div>

        <div className="macro-lab-grid-shell">
          {draft ? (
            draft.steps.length > 0 ? (
              <table className="macro-step-table">
                <thead>
                  <tr>
                    <th className="macro-step-table__select">
                      <input type="checkbox" checked={allSelected} aria-label="Select all steps" onChange={(event) => handleSelectAllSteps(event.target.checked)} />
                    </th>
                    <th>#</th>
                    <th>Type</th>
                    <th className="macro-step-table__delay-col">Delay</th>
                    <th className="macro-step-table__xy-col">X</th>
                    <th className="macro-step-table__xy-col">Y</th>
                    <th>Text</th>
                    <th className="macro-step-table__keys-col">Keys</th>
                    <th className="macro-step-table__target-col">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.steps.map((step, index) => {
                    const isSelected = selectedStepIndexes.includes(index);
                    const stepTarget = getStepTargetValue(step);
                    const positionEnabled = step.type === "Click" || step.type === "Wheel";
                    const textEnabled = step.type === "Text";
                    const keysEnabled = step.type === "Key";
                    const targetEnabled = step.type === "Script" || step.type === "Macro";
                    return (
                      <tr key={`${draft.id}-${index}`} className={isSelected ? "is-selected" : undefined}>
                        <td className="macro-step-table__select">
                          <input type="checkbox" checked={isSelected} aria-label={`Select step ${index + 1}`} onChange={(event) => handleToggleSelectedStep(index, event.target.checked)} />
                        </td>
                        <td className="macro-step-table__number">{index + 1}</td>
                        <td>
                          <select value={step.type} onFocus={() => beginStepEdit(`type-${index}`, index)} onBlur={() => finishStepEdit(`type-${index}`)} onChange={(event) => handleStepTypeChange(index, event.target.value as RecordedMacroStepType)}>
                            {STEP_TYPE_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {STEP_TYPE_LABELS[option]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="macro-step-table__delay-col">
                          <input className="macro-step-table__compact-input" type="number" step="1" value={String(step.delayMs)} onFocus={() => beginStepEdit(`delay-${index}`, index)} onBlur={() => finishStepEdit(`delay-${index}`)} onChange={(event) => updateStep(index, { delayMs: normalizeDelayMs(event.target.value) })} />
                        </td>
                        <td className="macro-step-table__xy-col">
                          <input className="macro-step-table__compact-input" type="text" value={step.x ?? ""} disabled={!positionEnabled} onFocus={() => beginStepEdit(`x-${index}`, index)} onBlur={() => finishStepEdit(`x-${index}`)} onChange={(event) => updateStep(index, { x: event.target.value })} />
                        </td>
                        <td className="macro-step-table__xy-col">
                          <input className="macro-step-table__compact-input" type="text" value={step.y ?? ""} disabled={!positionEnabled} onFocus={() => beginStepEdit(`y-${index}`, index)} onBlur={() => finishStepEdit(`y-${index}`)} onChange={(event) => updateStep(index, { y: event.target.value })} />
                        </td>
                        <td>
                          <input type="text" value={step.text ?? ""} disabled={!textEnabled} onFocus={() => beginStepEdit(`text-${index}`, index)} onBlur={() => finishStepEdit(`text-${index}`)} onChange={(event) => updateStep(index, { text: event.target.value })} />
                        </td>
                        <td className="macro-step-table__keys-col">
                          <input className="macro-step-table__compact-input" type="text" value={step.keys ?? ""} disabled={!keysEnabled} onFocus={() => beginStepEdit(`keys-${index}`, index)} onBlur={() => finishStepEdit(`keys-${index}`)} onChange={(event) => updateStep(index, { keys: event.target.value })} />
                        </td>
                        <td className="macro-step-table__target-col">
                          <input className="macro-step-table__target-input" type="text" value={stepTarget} title={stepTarget} disabled={!targetEnabled} onFocus={() => beginStepEdit(`target-${index}`, index)} onBlur={() => finishStepEdit(`target-${index}`)} onChange={(event) => updateStep(index, setStepTargetValue(step, event.target.value))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="macro-lab-empty">
                <span className="caption">No steps yet. Use the inputs above the grid and add one.</span>
              </div>
            )
          ) : (
            <div className="macro-lab-empty">
              <span className="caption">Create or load a macro to edit its steps.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
