export type ProgramUndoShortcut = "undo" | "redo-shift-z" | "redo-y";

const pendingProgramActions = new Map<string, Set<Promise<unknown>>>();

export async function trackProgramAction<T>(
  programName: string,
  action: () => Promise<T>
): Promise<T> {
  const key = programName.trim().toLowerCase();
  let pending = pendingProgramActions.get(key);
  if (!pending) {
    pending = new Set();
    pendingProgramActions.set(key, pending);
  }
  const completion = Promise.resolve().then(action);
  pending.add(completion);
  try {
    return await completion;
  } finally {
    pending.delete(completion);
    if (pending.size === 0) pendingProgramActions.delete(key);
  }
}

export async function waitForPendingProgramActions(programName?: string): Promise<void> {
  const key = programName?.trim().toLowerCase();
  // Capture only work already started when Undo was requested, including failed work.
  const pending = key
    ? Array.from(pendingProgramActions.get(key) ?? [])
    : Array.from(pendingProgramActions.values()).flatMap((actions) => Array.from(actions));
  await Promise.allSettled(pending);
}

/** Keep this function self-contained: installed pages inject its compiled source. */
export function installProgramUndoKeys(
  targetWindow: Window,
  forward: (shortcut: ProgramUndoShortcut) => Promise<void>,
  onError: (error: unknown) => void
): () => void {
  let disposed = false;
  let inFlight = false;

  const isEditable = (target: EventTarget | null): boolean => {
    const element = target as HTMLElement | null;
    if (!element || element.nodeType !== 1) return false;
    return element.isContentEditable || Boolean(
      element.closest("input, textarea, select, [data-button-inline-editor]")
    );
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (
      disposed || event.defaultPrevented || event.repeat || event.isComposing ||
      event.keyCode === 229 || !event.ctrlKey || event.altKey || event.metaKey
    ) return;

    const key = event.key.toLowerCase();
    const shortcut: ProgramUndoShortcut | null = key === "z"
      ? (event.shiftKey ? "redo-shift-z" : "undo")
      : key === "y" && !event.shiftKey ? "redo-y" : null;
    if (!shortcut) return;

    if (event.composedPath().some(isEditable) || isEditable(event.target)) return;
    let active = targetWindow.document.activeElement;
    while (active) {
      if (isEditable(active)) return;
      active = active.shadowRoot?.activeElement ?? null;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (inFlight) {
      onError(new Error("Undo/Redo is waiting for the current request to finish."));
      return;
    }
    inFlight = true;
    void (async () => {
      try {
        await forward(shortcut);
      } catch (error) {
        if (!disposed) onError(error);
      } finally {
        inFlight = false;
      }
    })();
  };

  targetWindow.addEventListener("keydown", handleKeyDown, true);
  return () => {
    disposed = true;
    targetWindow.removeEventListener("keydown", handleKeyDown, true);
  };
}
