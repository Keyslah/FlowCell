import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";
import {
  addFrontendMacroPanelButton,
  deleteFrontendMacro,
  emitMacroPanelChanged,
  getFrontendMacroDirectory,
  getCurrentMousePosition,
  listFrontendMacros,
  listFrontendPanelMacros,
  loadFrontendMacro,
  loadFrontendMacroFromPath,
  recordFrontendMacro,
  runFrontendMacro,
  saveFrontendMacro,
  type FrontendMacroDocument,
  type FrontendMacroStep,
  type FrontendMacroSummary,
  type MacroStepType
} from "../../lib/macros";
import {
  listPanelFolders,
  listProgramFolders
} from "../../lib/programRails";
import { showOpenFileDialog } from "../../lib/tauri";
import type { MacroLabWindowContext } from "../../lib/windowContext";
import "./macroLabWindowPage.css";

const STEP_TYPES: MacroStepType[] = [
  "Click",
  "RightClick",
  "Wheel",
  "Text",
  "Key",
  "Script",
  "Macro"
];

type StepDraft = {
  type: MacroStepType;
  delayMs: string;
  x: string;
  y: string;
  button: string;
  count: string;
  direction: string;
  text: string;
  keys: string;
  target: string;
};

type CursorPosition = {
  x: number;
  y: number;
};

type HistoryState = {
  past: FrontendMacroStep[][];
  future: FrontendMacroStep[][];
};

const DEFAULT_LABEL = "New Macro";
const MAX_HISTORY = 80;
const MOUSE_PICK_DELAY_MS = 2000;

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStepId(): string {
  return `step_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function cloneSteps(steps: FrontendMacroStep[]): FrontendMacroStep[] {
  return steps.map((step) => ({ ...step }));
}

function emptyStepDraft(): StepDraft {
  return {
    type: "Click",
    delayMs: "0",
    x: "",
    y: "",
    button: "Left",
    count: "1",
    direction: "Down",
    text: "",
    keys: "",
    target: ""
  };
}

function numberInput(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function stepToDraft(step: FrontendMacroStep | null | undefined): StepDraft {
  if (!step) {
    return emptyStepDraft();
  }

  return {
    type: step.type,
    delayMs: numberInput(step.delayMs) || "0",
    x: numberInput(step.x),
    y: numberInput(step.y),
    button: step.button?.trim() || (step.type === "RightClick" ? "Right" : "Left"),
    count: numberInput(step.count) || "1",
    direction: step.direction?.trim() || "Down",
    text: step.text ?? "",
    keys: step.keys ?? "",
    target: step.target ?? ""
  };
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function draftToStep(draft: StepDraft, existingId?: string): FrontendMacroStep {
  const type = draft.type;
  const delayMs = Math.max(0, parseInteger(draft.delayMs) ?? 0);
  const x = parseInteger(draft.x);
  const y = parseInteger(draft.y);
  const count = Math.max(1, parseInteger(draft.count) ?? 1);
  const target = draft.target.trim();

  return {
    id: existingId ?? createStepId(),
    type,
    delayMs,
    x,
    y,
    button:
      type === "RightClick"
        ? "Right"
        : type === "Click"
          ? draft.button.trim() || "Left"
          : null,
    count: type === "Click" || type === "RightClick" || type === "Wheel" ? count : null,
    direction: type === "Wheel" ? draft.direction.trim() || "Down" : null,
    text: type === "Text" ? draft.text : null,
    keys: type === "Key" ? draft.keys : null,
    target: type === "Script" || type === "Macro" ? target : null
  };
}

function defaultStep(): FrontendMacroStep {
  return draftToStep(emptyStepDraft());
}

function buildFingerprint(args: {
  id: string;
  programName: string;
  panelName: string;
  label: string;
  steps: FrontendMacroStep[];
}): string {
  return JSON.stringify({
    id: args.id,
    programName: args.programName,
    panelName: args.panelName,
    label: args.label.trim(),
    steps: args.steps
  });
}

function resolveName(names: string[], preferred: string): string {
  return (
    names.find((name) => name.localeCompare(preferred, undefined, { sensitivity: "accent" }) === 0) ??
    names[0] ??
    ""
  );
}

function formatStepDetail(step: FrontendMacroStep): string {
  switch (step.type) {
    case "Click":
    case "RightClick":
    case "Wheel":
      return `${step.x ?? "-"}, ${step.y ?? "-"}`;
    case "Text":
      return "";
    case "Key":
      return step.keys?.trim() || "Keys";
    case "Script":
    case "Macro":
      return "";
    default:
      return step.type.replace(/^Activate/, "Activate ");
  }
}

function formatStepText(step: FrontendMacroStep): string {
  return step.type === "Text" ? step.text?.trim() ?? "" : "";
}

function formatStepTarget(step: FrontendMacroStep): string {
  return step.type === "Script" || step.type === "Macro" ? step.target?.trim() ?? "" : "";
}

function shortenStart(value: string, maxLength = 44): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

export default function MacroLabWindowPage({
  context
}: {
  context: MacroLabWindowContext;
}) {
  const initialMacroIdRef = useRef(context.macroId?.trim() || "");
  const preserveLoadedDraftRef = useRef(false);
  const attachToPanel = context.attachToPanel === true;
  const [programNames, setProgramNames] = useState<string[]>([]);
  const [panelNames, setPanelNames] = useState<string[]>([]);
  const [macroSummaries, setMacroSummaries] = useState<FrontendMacroSummary[]>([]);
  const [allMacroSummaries, setAllMacroSummaries] = useState<FrontendMacroSummary[]>([]);
  const [programName, setProgramName] = useState(context.programName);
  const [panelName, setPanelName] = useState(context.panelName);
  const [macroId, setMacroId] = useState("");
  const [macroLabel, setMacroLabel] = useState(DEFAULT_LABEL);
  const [steps, setSteps] = useState<FrontendMacroStep[]>([]);
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string>("");
  const [editorDraft, setEditorDraft] = useState<StepDraft>(() => emptyStepDraft());
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({ x: 0, y: 0 });
  const [statusMessage, setStatusMessage] = useState("");
  const [statusKind, setStatusKind] = useState<"neutral" | "success" | "error">("neutral");
  const [isBusy, setIsBusy] = useState(false);
  const [isPickingMouse, setIsPickingMouse] = useState(false);
  const [hasAttachedPanelButton, setHasAttachedPanelButton] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [history, setHistory] = useState<HistoryState>({ past: [], future: [] });

  const selectedStepIdSet = useMemo(() => new Set(selectedStepIds), [selectedStepIds]);
  const selectedStep = useMemo(
    () => steps.find((step) => selectedStepIds.includes(step.id)) ?? null,
    [selectedStepIds, steps]
  );
  const currentFingerprint = useMemo(
    () =>
      buildFingerprint({
        id: macroId,
        programName,
        panelName,
        label: macroLabel,
        steps
      }),
    [macroId, macroLabel, panelName, programName, steps]
  );
  const isDirty = currentFingerprint !== savedFingerprint;
  const statusClass = statusKind === "success" ? "is-success" : statusKind === "error" ? "is-error" : "";

  const setStatus = (message: string, kind: "neutral" | "success" | "error" = "neutral") => {
    setStatusMessage(message);
    setStatusKind(kind);
  };

  const resetHistory = () => {
    setHistory({ past: [], future: [] });
  };

  const replaceDocument = (
    document: FrontendMacroDocument,
    options?: { preserveDraftAcrossPanelRefresh?: boolean }
  ) => {
    const nextSteps = cloneSteps(document.steps);
    if (options?.preserveDraftAcrossPanelRefresh) {
      preserveLoadedDraftRef.current = true;
    }
    setProgramName(document.programName);
    setPanelName(document.panelName);
    setMacroId(document.id);
    setMacroLabel(document.label);
    setSteps(nextSteps);
    setSelectedStepIds(nextSteps[0] ? [nextSteps[0].id] : []);
    setSelectionAnchorId(nextSteps[0]?.id ?? "");
    setEditorDraft(stepToDraft(nextSteps[0]));
    setSavedFingerprint(
      buildFingerprint({
        id: document.id,
        programName: document.programName,
        panelName: document.panelName,
        label: document.label,
        steps: nextSteps
      })
    );
    resetHistory();
  };

  const resetDraft = (nextProgramName = programName, nextPanelName = panelName) => {
    const nextSteps: FrontendMacroStep[] = [];
    setMacroId("");
    setMacroLabel(DEFAULT_LABEL);
    setSteps(nextSteps);
    setSelectedStepIds([]);
    setSelectionAnchorId("");
    setEditorDraft(emptyStepDraft());
    setSavedFingerprint(
      buildFingerprint({
        id: "",
        programName: nextProgramName,
        panelName: nextPanelName,
        label: DEFAULT_LABEL,
        steps: nextSteps
      })
    );
    resetHistory();
  };

  const commitSteps = (nextSteps: FrontendMacroStep[]) => {
    setHistory((current) => ({
      past: [...current.past.slice(-(MAX_HISTORY - 1)), cloneSteps(steps)],
      future: []
    }));
    setSteps(nextSteps);
  };

  const loadMacroById = async (nextMacroId: string) => {
    if (!nextMacroId.trim()) {
      resetDraft();
      return;
    }

    setIsBusy(true);
    try {
      const document = await loadFrontendMacro(nextMacroId);
      replaceDocument(document);
      setStatus(`Loaded ${document.label}.`, "success");
    } catch (error) {
      setStatus(formatErrorMessage(error), "error");
    } finally {
      setIsBusy(false);
    }
  };

  const loadMacroFromFile = async () => {
    try {
      const initialDirectory = await getFrontendMacroDirectory().catch(() => "");
      const selectedPaths = await showOpenFileDialog({
        title: "Load Macro",
        filter: "Macro files (*.ini)|*.ini|All Files (*.*)|*.*",
        initialDirectory: initialDirectory || undefined,
        multiselect: false
      });
      const selectedPath = selectedPaths[0]?.trim() ?? "";
      if (!selectedPath) {
        return;
      }

      setIsBusy(true);
      const document = await loadFrontendMacroFromPath({
        path: selectedPath,
        fallbackProgramName: programName,
        fallbackPanelName: panelName
      });
      replaceDocument(document, {
        preserveDraftAcrossPanelRefresh: !document.id.trim()
      });
      await refreshMacros(document.programName, document.panelName);
      setStatus(`Loaded ${document.label} from file.`, "success");
    } catch (error) {
      setStatus(formatErrorMessage(error), "error");
    } finally {
      setIsBusy(false);
    }
  };

  const refreshMacros = async (nextProgramName = programName, nextPanelName = panelName) => {
    if (!nextProgramName || !nextPanelName) {
      setMacroSummaries([]);
      setAllMacroSummaries(await listFrontendMacros());
      return [];
    }

    const [nextMacros, nextAllMacros] = await Promise.all([
      listFrontendPanelMacros(nextProgramName, nextPanelName),
      listFrontendMacros()
    ]);
    setMacroSummaries(nextMacros);
    setAllMacroSummaries(nextAllMacros);
    return nextMacros;
  };

  const attachMacroToCurrentPanel = async (document: FrontendMacroDocument) => {
    if (!attachToPanel) {
      return false;
    }
    if (hasAttachedPanelButton) {
      return false;
    }
    if (!programName || !panelName) {
      setStatus("Pick a program and panel before adding this macro to a panel.", "error");
      return false;
    }
    if (document.steps.length === 0) {
      setStatus("Add at least one step before adding this macro to a panel.", "error");
      return false;
    }

    await addFrontendMacroPanelButton({
      programName,
      panelName,
      actionId: document.id
    });
    setHasAttachedPanelButton(true);
    await emitMacroPanelChanged({ programName, panelName });
    return true;
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const names = await listProgramFolders();
        if (cancelled) {
          return;
        }

        setProgramNames(names);
        setProgramName(resolveName(names, context.programName));
      } catch (error) {
        setStatus(formatErrorMessage(error), "error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context.programName]);

  useEffect(() => {
    if (!programName) {
      setPanelNames([]);
      setPanelName("");
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const names = await listPanelFolders(programName);
        if (cancelled) {
          return;
        }

        setPanelNames(names);
        setPanelName((current) => resolveName(names, current || context.panelName));
      } catch (error) {
        setStatus(formatErrorMessage(error), "error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context.panelName, programName]);

  useEffect(() => {
    if (!programName || !panelName) {
      setMacroSummaries([]);
      void listFrontendMacros().then(setAllMacroSummaries).catch(() => {});
      resetDraft(programName, panelName);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const [nextMacros, nextAllMacros] = await Promise.all([
          listFrontendPanelMacros(programName, panelName),
          listFrontendMacros()
        ]);
        if (cancelled) {
          return;
        }

        setMacroSummaries(nextMacros);
        setAllMacroSummaries(nextAllMacros);
        const initialMacroId = initialMacroIdRef.current;
        if (initialMacroId) {
          initialMacroIdRef.current = "";
          await loadMacroById(initialMacroId);
          return;
        }

        if (preserveLoadedDraftRef.current) {
          preserveLoadedDraftRef.current = false;
          return;
        }

        if (macroId && nextMacros.some((macro) => macro.id === macroId)) {
          return;
        }

        resetDraft(programName, panelName);
      } catch (error) {
        if (!cancelled) {
          setStatus(formatErrorMessage(error), "error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [panelName, programName]);

  useEffect(() => {
    if (!selectedStep) {
      return;
    }

    setEditorDraft(stepToDraft(selectedStep));
  }, [selectedStep]);

  useEffect(() => {
    let cancelled = false;
    const updateCursorPosition = async () => {
      try {
        const nextPosition = await getCurrentMousePosition();
        if (!cancelled) {
          setCursorPosition(nextPosition);
        }
      } catch {
      }
    };

    void updateCursorPosition();
    const intervalId = window.setInterval(updateCursorPosition, 160);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setCursorPosition({
        x: Math.round(event.screenX),
        y: Math.round(event.screenY)
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  const handleProgramChange = (nextProgramName: string) => {
    setProgramName(nextProgramName);
    setPanelName("");
    setMacroSummaries([]);
    resetDraft(nextProgramName, "");
    setStatus("");
  };

  const handlePanelChange = (nextPanelName: string) => {
    setPanelName(nextPanelName);
    resetDraft(programName, nextPanelName);
    setStatus("");
  };

  const handleMacroChange = (nextMacroId: string) => {
    setStatus("");
    if (!nextMacroId) {
      resetDraft(programName, panelName);
      return;
    }
    void loadMacroById(nextMacroId);
  };

  const handleStepRowClick = (
    stepId: string,
    event: ReactMouseEvent<HTMLButtonElement>
  ) => {
    const stepIndex = steps.findIndex((step) => step.id === stepId);
    if (stepIndex < 0) {
      return;
    }

    if (event.shiftKey) {
      if (!selectionAnchorId) {
        setSelectedStepIds([stepId]);
        setSelectionAnchorId(stepId);
        return;
      }
      const anchorIndex = steps.findIndex((step) => step.id === selectionAnchorId);
      if (anchorIndex >= 0) {
        const start = Math.min(anchorIndex, stepIndex);
        const end = Math.max(anchorIndex, stepIndex);
        setSelectedStepIds(steps.slice(start, end + 1).map((step) => step.id));
        return;
      }
    }

    if (event.ctrlKey || event.metaKey) {
      setSelectedStepIds((current) => {
        const exists = current.includes(stepId);
        return exists ? current.filter((id) => id !== stepId) : [...current, stepId];
      });
      setSelectionAnchorId(stepId);
      return;
    }

    setSelectedStepIds([stepId]);
    setSelectionAnchorId(stepId);
  };

  const applyEditorToSelected = () => {
    if (selectedStepIds.length === 0) {
      setStatus("Select at least one step before applying editor values.", "error");
      return;
    }

    const selectedIds = new Set(selectedStepIds);
    commitSteps(
      steps.map((step) =>
        selectedIds.has(step.id) ? draftToStep(editorDraft, step.id) : step
      )
    );
    setStatus(`Applied editor values to ${selectedStepIds.length} step(s).`, "success");
  };

  const addStep = () => {
    const nextStep = draftToStep(editorDraft);
    const selectedIndexes = selectedStepIds
      .map((id) => steps.findIndex((step) => step.id === id))
      .filter((index) => index >= 0);
    const insertIndex =
      selectedIndexes.length > 0 ? Math.max(...selectedIndexes) + 1 : steps.length;
    const nextSteps = [
      ...steps.slice(0, insertIndex),
      nextStep,
      ...steps.slice(insertIndex)
    ];
    commitSteps(nextSteps);
    setSelectedStepIds([nextStep.id]);
    setSelectionAnchorId(nextStep.id);
    setStatus("Step added.", "success");
  };

  const clearStep = () => {
    if (selectedStepIds.length === 0) {
      setEditorDraft(emptyStepDraft());
      setStatus("Step editor cleared.", "success");
      return;
    }

    const selectedIds = new Set(selectedStepIds);
    const blankDraft = emptyStepDraft();
    commitSteps(
      steps.map((step) =>
        selectedIds.has(step.id) ? draftToStep(blankDraft, step.id) : step
      )
    );
    setEditorDraft(blankDraft);
    setStatus(`Cleared ${selectedStepIds.length} step(s).`, "success");
  };

  const duplicateSelectedSteps = () => {
    if (selectedStepIds.length === 0) {
      setStatus("Select at least one step before duplicating.", "error");
      return;
    }

    const selectedIds = new Set(selectedStepIds);
    const selectedIndexes = steps
      .map((step, index) => (selectedIds.has(step.id) ? index : -1))
      .filter((index) => index >= 0);
    const duplicates = selectedIndexes.map((index) => ({
      ...steps[index],
      id: createStepId()
    }));
    const insertIndex = Math.max(...selectedIndexes) + 1;
    commitSteps([
      ...steps.slice(0, insertIndex),
      ...duplicates,
      ...steps.slice(insertIndex)
    ]);
    setSelectedStepIds(duplicates.map((step) => step.id));
    setSelectionAnchorId(duplicates[0]?.id ?? "");
    setStatus(`Duplicated ${duplicates.length} step(s).`, "success");
  };

  const deleteSelectedSteps = () => {
    if (selectedStepIds.length === 0) {
      setStatus("Select at least one step before deleting.", "error");
      return;
    }

    const selectedIds = new Set(selectedStepIds);
    const firstSelectedIndex = steps.findIndex((step) => selectedIds.has(step.id));
    const nextSteps = steps.filter((step) => !selectedIds.has(step.id));
    commitSteps(nextSteps);
    const nextSelectedStep = nextSteps[Math.min(firstSelectedIndex, nextSteps.length - 1)] ?? null;
    setSelectedStepIds(nextSelectedStep ? [nextSelectedStep.id] : []);
    setSelectionAnchorId(nextSelectedStep?.id ?? "");
    setStatus(`Deleted ${selectedStepIds.length} step(s).`, "success");
  };

  const undo = () => {
    setHistory((current) => {
      const previous = current.past[current.past.length - 1];
      if (!previous) {
        return current;
      }

      setSteps(cloneSteps(previous));
      setSelectedStepIds(previous[0] ? [previous[0].id] : []);
      setSelectionAnchorId(previous[0]?.id ?? "");
      return {
        past: current.past.slice(0, -1),
        future: [cloneSteps(steps), ...current.future]
      };
    });
  };

  const redo = () => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) {
        return current;
      }

      setSteps(cloneSteps(next));
      setSelectedStepIds(next[0] ? [next[0].id] : []);
      setSelectionAnchorId(next[0]?.id ?? "");
      return {
        past: [...current.past, cloneSteps(steps)],
        future: current.future.slice(1)
      };
    });
  };

  const saveMacro = async (options?: { forceNewId?: boolean; label?: string }) => {
    const nextLabel = options?.label?.trim() || macroLabel.trim();
    if (!programName || !panelName) {
      setStatus("Pick a program and panel before saving.", "error");
      return null;
    }
    if (!nextLabel) {
      setStatus("Macro name cannot be empty.", "error");
      return null;
    }
    if (steps.length === 0) {
      setStatus("Add at least one step before saving.", "error");
      return null;
    }

    setIsBusy(true);
    try {
      const document = await saveFrontendMacro({
        currentId: macroId || null,
        programName,
        panelName,
        label: nextLabel,
        steps,
        forceNewId: options?.forceNewId ?? false
      });
      replaceDocument(document);
      await refreshMacros(document.programName, document.panelName);
      const attached = await attachMacroToCurrentPanel(document);
      await emitMacroPanelChanged({
        programName: document.programName,
        panelName: document.panelName
      });
      setStatus(
        attached ? `Saved ${document.label} and added it to this panel.` : `Saved ${document.label}.`,
        "success"
      );
      return document;
    } catch (error) {
      setStatus(formatErrorMessage(error), "error");
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const saveAsMacro = async () => {
    const requestedLabel = window.prompt("Save macro as.", macroLabel.trim() || DEFAULT_LABEL);
    if (requestedLabel === null) {
      return;
    }
    await saveMacro({ forceNewId: true, label: requestedLabel });
  };

  const renameMacro = async () => {
    const requestedLabel = window.prompt("Rename macro.", macroLabel.trim() || DEFAULT_LABEL);
    if (requestedLabel === null) {
      return;
    }
    const nextLabel = requestedLabel.trim();
    if (!nextLabel) {
      setStatus("Macro name cannot be empty.", "error");
      return;
    }

    setMacroLabel(nextLabel);
    if (macroId) {
      await saveMacro({ label: nextLabel });
    }
  };

  const copyMacro = async () => {
    const requestedLabel = window.prompt(
      "Copy macro as.",
      `Copy of ${macroLabel.trim() || DEFAULT_LABEL}`
    );
    if (requestedLabel === null) {
      return;
    }
    await saveMacro({ forceNewId: true, label: requestedLabel });
  };

  const deleteMacro = async () => {
    if (!macroId) {
      resetDraft(programName, panelName);
      setStatus("Unsaved macro draft cleared.", "success");
      return;
    }

    if (!window.confirm(`Delete '${macroLabel}'? The macro file and any panel buttons using it will be moved to the Recycle Bin.`)) {
      return;
    }

    setIsBusy(true);
    try {
      await deleteFrontendMacro(macroId);
      await emitMacroPanelChanged({ programName, panelName });
      await refreshMacros(programName, panelName);
      resetDraft(programName, panelName);
      setStatus("Macro deleted.", "success");
    } catch (error) {
      setStatus(formatErrorMessage(error), "error");
    } finally {
      setIsBusy(false);
    }
  };

  const runMacro = async () => {
    let runnableMacroId = macroId;
    if (isDirty) {
      if (!window.confirm("Save changes before running this macro?")) {
        return;
      }
      const document = await saveMacro();
      runnableMacroId = document?.id ?? "";
    }
    if (!runnableMacroId) {
      setStatus("Save the macro before running it.", "error");
      return;
    }

    setIsBusy(true);
    try {
      const result = await runFrontendMacro(runnableMacroId);
      setStatus(result || "Macro run started.", "success");
    } catch (error) {
      setStatus(formatErrorMessage(error), "error");
    } finally {
      setIsBusy(false);
    }
  };

  const recordMacro = async () => {
    if (!programName || !panelName) {
      setStatus("Pick a program and panel before recording.", "error");
      return;
    }
    if (!macroLabel.trim()) {
      setStatus("Macro name cannot be empty.", "error");
      return;
    }
    if (steps.length > 0 && !window.confirm("Recording will replace the current step list. Continue?")) {
      return;
    }

    setIsBusy(true);
    try {
      const document = await recordFrontendMacro({
        currentId: macroId || null,
        programName,
        panelName,
        label: macroLabel
      });
      replaceDocument(document);
      await refreshMacros(document.programName, document.panelName);
      const attached = await attachMacroToCurrentPanel(document);
      await emitMacroPanelChanged({
        programName: document.programName,
        panelName: document.panelName
      });
      setStatus(
        attached
          ? `Recorded ${document.steps.length} step(s) and added the macro to this panel.`
          : `Recorded ${document.steps.length} step(s).`,
        "success"
      );
    } catch (error) {
      setStatus(formatErrorMessage(error), "error");
    } finally {
      setIsBusy(false);
    }
  };

  const closeWindow = async (confirmDirty = true) => {
    if (confirmDirty && isDirty && !window.confirm("Close Macro Lab and discard unsaved changes?")) {
      return;
    }

    await getCurrentWindow().close().catch(() => {
      window.close();
    });
  };

  const pickMousePosition = async () => {
    if (isPickingMouse) {
      return;
    }

    setIsPickingMouse(true);
    setStatus("Move the mouse where you want it within two seconds to record the values.");
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, MOUSE_PICK_DELAY_MS));
      const nextPosition = await getCurrentMousePosition();
      const nextX = Math.round(nextPosition.x);
      const nextY = Math.round(nextPosition.y);
      setCursorPosition(nextPosition);
      setEditorDraft((current) => ({
        ...current,
        x: String(nextX),
        y: String(nextY)
      }));
      setStatus(`Picked ${nextX} / ${nextY}.`, "success");
    } catch (error) {
      setStatus(formatErrorMessage(error), "error");
    } finally {
      setIsPickingMouse(false);
    }
  };

  const browseScriptTarget = async () => {
    try {
      const selectedPaths = await showOpenFileDialog({
        title: "Choose Script Step Target",
        filter:
          "Scripts (*.ps1;*.ahk;*.cmd;*.bat;*.vbs;*.jsx;*.js;*.py)|*.ps1;*.ahk;*.cmd;*.bat;*.vbs;*.jsx;*.js;*.py|All Files (*.*)|*.*"
      });
      const selectedPath = selectedPaths[0]?.trim() ?? "";
      if (selectedPath) {
        setEditorDraft((current) => ({
          ...current,
          target: selectedPath
        }));
      }
    } catch (error) {
      setStatus(formatErrorMessage(error), "error");
    }
  };

  return (
    <main className="macro-lab-page">
      <section className="macro-lab">
        <header className="macro-lab__header">
          <div className="macro-lab__title">
            <span>Macro Lab</span>
            <h1>{macroLabel.trim() || DEFAULT_LABEL}</h1>
          </div>
          <div className="macro-lab__header-actions">
            <button type="button" onClick={() => void closeWindow()} disabled={isBusy}>
              Close
            </button>
            <button type="button" onClick={() => void closeWindow(false)} disabled={isBusy}>
              Cancel
            </button>
          </div>
        </header>

        <section className="macro-lab__toolbar" aria-label="Macro selectors">
          <label>
            <span>Program</span>
            <select value={programName} onChange={(event) => handleProgramChange(event.target.value)}>
              <option value="">Pick a program</option>
              {programNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Panel</span>
            <select value={panelName} onChange={(event) => handlePanelChange(event.target.value)} disabled={!programName}>
              <option value="">Pick a panel</option>
              {panelNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Macro</span>
            <select value={macroId} onChange={(event) => handleMacroChange(event.target.value)} disabled={!panelName}>
              <option value="">New macro draft</option>
              {macroSummaries.map((macro) => (
                <option key={macro.id} value={macro.id}>
                  {macro.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Name</span>
            <input
              type="text"
              value={macroLabel}
              onChange={(event) => setMacroLabel(event.target.value)}
            />
          </label>
        </section>

        <section className="macro-lab__command-bar" aria-label="Macro commands">
          <button type="button" onClick={() => resetDraft(programName, panelName)} disabled={isBusy}>
            New Macro
          </button>
          <button type="button" onClick={() => void loadMacroFromFile()} disabled={isBusy}>
            Load Macro
          </button>
          <button type="button" onClick={() => void saveMacro()} disabled={isBusy}>
            Save
          </button>
          <button type="button" onClick={() => void saveAsMacro()} disabled={isBusy}>
            Save As
          </button>
          <button type="button" onClick={() => void renameMacro()} disabled={isBusy}>
            Rename
          </button>
          <button type="button" onClick={() => void copyMacro()} disabled={isBusy}>
            Copy
          </button>
          <button type="button" onClick={() => void deleteMacro()} disabled={isBusy}>
            Delete
          </button>
          <button type="button" onClick={() => void runMacro()} disabled={isBusy}>
            Run
          </button>
          <button type="button" onClick={() => void recordMacro()} disabled={isBusy}>
            Record
          </button>
        </section>

        {statusMessage ? (
          <p className={`macro-lab__status ${statusClass}`}>{statusMessage}</p>
        ) : null}

        <section className="macro-lab__workspace">
          <section className="macro-lab__steps" aria-label="Macro steps">
            <header className="macro-lab__section-header">
              <h2>Steps</h2>
              <div>
                <button type="button" onClick={undo} disabled={history.past.length === 0 || isBusy}>
                  Undo
                </button>
                <button type="button" onClick={redo} disabled={history.future.length === 0 || isBusy}>
                  Redo
                </button>
              </div>
            </header>
            <div className="macro-lab__step-table" role="table" aria-label="Step table">
              <div className="macro-lab__step-head" role="row">
                <span>#</span>
                <span>Type</span>
                <span>Delay</span>
                <span>Detail</span>
                <span>Text</span>
                <span>Target</span>
              </div>
              <div className="macro-lab__step-body">
                {steps.length > 0 ? (
                  steps.map((step, index) => {
                    const text = formatStepText(step);
                    const target = formatStepTarget(step);
                    return (
                      <button
                        key={step.id}
                        type="button"
                        className={`macro-lab__step-row ${selectedStepIdSet.has(step.id) ? "is-selected" : ""}`}
                        role="row"
                        onClick={(event) => handleStepRowClick(step.id, event)}
                      >
                        <span>{index + 1}</span>
                        <span>{step.type}</span>
                        <span>{step.delayMs}</span>
                        <span>{formatStepDetail(step)}</span>
                        <span title={text}>{text}</span>
                        <span title={target}>{shortenStart(target)}</span>
                      </button>
                    );
                  })
                ) : (
                  <p className="macro-lab__empty">No steps yet.</p>
                )}
              </div>
            </div>
            <div className="macro-lab__step-actions">
              <button type="button" onClick={addStep} disabled={isBusy}>
                Add Step
              </button>
              <button type="button" onClick={clearStep} disabled={isBusy}>
                Clear Step
              </button>
              <button type="button" onClick={duplicateSelectedSteps} disabled={isBusy}>
                Duplicate
              </button>
              <button type="button" onClick={deleteSelectedSteps} disabled={isBusy}>
                Delete Step
              </button>
            </div>
          </section>

          <aside className="macro-lab__editor" aria-label="Step editor">
            <header className="macro-lab__section-header">
              <h2>Step Editor</h2>
              <button type="button" onClick={applyEditorToSelected} disabled={isBusy}>
                Apply Selected
              </button>
            </header>
            <div className="macro-lab__editor-grid">
              <label>
                <span>Type</span>
                <select
                  value={editorDraft.type}
                  onChange={(event) =>
                    setEditorDraft((current) => ({
                      ...current,
                      type: event.target.value as MacroStepType
                    }))
                  }
                >
                  {!STEP_TYPES.includes(editorDraft.type) ? (
                    <option value={editorDraft.type} hidden>
                      {editorDraft.type}
                    </option>
                  ) : null}
                  {STEP_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Delay ms</span>
                <input
                  type="number"
                  min="0"
                  value={editorDraft.delayMs}
                  onChange={(event) =>
                    setEditorDraft((current) => ({ ...current, delayMs: event.target.value }))
                  }
                />
              </label>
              <div className="macro-lab__xy-row">
                <label>
                  <span>X</span>
                  <input
                    type="number"
                    value={editorDraft.x}
                    onChange={(event) =>
                      setEditorDraft((current) => ({ ...current, x: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Y</span>
                  <input
                    type="number"
                    value={editorDraft.y}
                    onChange={(event) =>
                      setEditorDraft((current) => ({ ...current, y: event.target.value }))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="macro-lab__xy-pick"
                  title="Move the mouse where you want it within two seconds to record the values."
                  onClick={() => void pickMousePosition()}
                  disabled={isBusy || isPickingMouse}
                >
                  {isPickingMouse ? "Picking..." : "Pick"}
                </button>
                <div className="macro-lab__mouse-readout">
                  <span>Mouse X/Y</span>
                  <strong>{Math.round(cursorPosition.x)} / {Math.round(cursorPosition.y)}</strong>
                </div>
              </div>
              <label>
                <span>Button</span>
                <select
                  value={editorDraft.button}
                  onChange={(event) =>
                    setEditorDraft((current) => ({ ...current, button: event.target.value }))
                  }
                >
                  <option value="Left">Left</option>
                  <option value="Middle">Middle</option>
                  <option value="Right">Right</option>
                </select>
              </label>
              <label>
                <span>Count</span>
                <input
                  type="number"
                  min="1"
                  value={editorDraft.count}
                  onChange={(event) =>
                    setEditorDraft((current) => ({ ...current, count: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>Wheel</span>
                <select
                  value={editorDraft.direction}
                  onChange={(event) =>
                    setEditorDraft((current) => ({ ...current, direction: event.target.value }))
                  }
                >
                  <option value="Down">Down</option>
                  <option value="Up">Up</option>
                  <option value="Left">Left</option>
                  <option value="Right">Right</option>
                </select>
              </label>
              <label>
                <span>Keys</span>
                <input
                  type="text"
                  value={editorDraft.keys}
                  onChange={(event) =>
                    setEditorDraft((current) => ({ ...current, keys: event.target.value }))
                  }
                />
              </label>
              <label className="macro-lab__wide-field">
                <span>Text</span>
                <textarea
                  value={editorDraft.text}
                  onChange={(event) =>
                    setEditorDraft((current) => ({ ...current, text: event.target.value }))
                  }
                />
              </label>
              <label className="macro-lab__wide-field">
                <span>{editorDraft.type === "Macro" ? "Macro target id" : "Target"}</span>
                {editorDraft.type === "Macro" ? (
                  <select
                    value={editorDraft.target}
                    onChange={(event) =>
                      setEditorDraft((current) => ({ ...current, target: event.target.value }))
                    }
                  >
                    <option value="">Pick a macro</option>
                    {allMacroSummaries
                      .filter((macro) => macro.id !== macroId)
                      .map((macro) => (
                        <option key={macro.id} value={macro.id}>
                          {macro.label} ({macro.programName} / {macro.panelName})
                        </option>
                      ))}
                  </select>
                ) : null}
                <div className="macro-lab__target-row">
                  <input
                    type="text"
                    value={editorDraft.target}
                    onChange={(event) =>
                      setEditorDraft((current) => ({ ...current, target: event.target.value }))
                    }
                  />
                  <button type="button" onClick={() => void browseScriptTarget()} disabled={editorDraft.type !== "Script"}>
                    Browse
                  </button>
                </div>
              </label>
            </div>
          </aside>
        </section>
      </section>
    </main>
  );
}
