import { useCallback, useMemo, useRef, useState } from "react";
import type { ButtonStateDocument } from "../types";
import { cloneButtonDocument } from "./buttonDefaults";

export interface ButtonDocumentTransactionOptions {
  label: string;
  coalesceKey?: string;
  coalesceWindowMs?: number;
}

interface ButtonHistoryEntry {
  document: ButtonStateDocument;
  label: string;
  coalesceKey?: string;
  timestamp: number;
}

interface ButtonEditorHistoryState {
  committed: ButtonStateDocument;
  draft: ButtonStateDocument;
  past: ButtonHistoryEntry[];
  future: ButtonHistoryEntry[];
}

export interface ButtonEditorStore {
  committed: ButtonStateDocument;
  draft: ButtonStateDocument;
  canUndo: boolean;
  canRedo: boolean;
  current: () => ButtonStateDocument;
  transact: (
    update: (draft: ButtonStateDocument) => void | ButtonStateDocument,
    options: ButtonDocumentTransactionOptions
  ) => void;
  undo: () => void;
  redo: () => void;
  acceptSaved: (document: ButtonStateDocument) => void;
  acceptScopedSaved: (
    document: ButtonStateDocument,
    applySavedScope: (draft: ButtonStateDocument, saved: ButtonStateDocument) => void
  ) => void;
  cancel: () => void;
  resetFromRepository: (document: ButtonStateDocument) => void;
}

const HISTORY_LIMIT = 150;

export function applyButtonDocumentTransaction(
  document: ButtonStateDocument,
  update: (draft: ButtonStateDocument) => void | ButtonStateDocument
): ButtonStateDocument {
  const next = cloneButtonDocument(document);
  return update(next) ?? next;
}

export function useButtonEditorStore(initialDocument: ButtonStateDocument): ButtonEditorStore {
  const [state, setState] = useState<ButtonEditorHistoryState>(() => ({
    committed: cloneButtonDocument(initialDocument),
    draft: cloneButtonDocument(initialDocument),
    past: [],
    future: []
  }));
  const draftRef = useRef(state.draft);
  draftRef.current = state.draft;

  const transact = useCallback<ButtonEditorStore["transact"]>((update, options) => {
    setState((current) => {
      const nextDraft = applyButtonDocumentTransaction(current.draft, update);
      const now = Date.now();
      const last = current.past[current.past.length - 1];
      const coalesce = Boolean(
        options.coalesceKey &&
        last?.coalesceKey === options.coalesceKey &&
        now - last.timestamp <= (options.coalesceWindowMs ?? 600)
      );
      const past = coalesce
        ? current.past.map((entry, index) =>
            index === current.past.length - 1 ? { ...entry, timestamp: now } : entry
          )
        : [
            ...current.past,
            {
              document: cloneButtonDocument(current.draft),
              label: options.label,
              coalesceKey: options.coalesceKey,
              timestamp: now
            }
          ].slice(-HISTORY_LIMIT);
      return { ...current, draft: nextDraft, past, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setState((current) => {
      const previous = current.past[current.past.length - 1];
      if (!previous) return current;
      return {
        ...current,
        draft: cloneButtonDocument(previous.document),
        past: current.past.slice(0, -1),
        future: [
          {
            document: cloneButtonDocument(current.draft),
            label: previous.label,
            timestamp: Date.now()
          },
          ...current.future
        ].slice(0, HISTORY_LIMIT)
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        ...current,
        draft: cloneButtonDocument(next.document),
        past: [
          ...current.past,
          {
            document: cloneButtonDocument(current.draft),
            label: next.label,
            timestamp: Date.now()
          }
        ].slice(-HISTORY_LIMIT),
        future: current.future.slice(1)
      };
    });
  }, []);

  const acceptSaved = useCallback((document: ButtonStateDocument) => {
    setState({
      committed: cloneButtonDocument(document),
      draft: cloneButtonDocument(document),
      past: [],
      future: []
    });
  }, []);

  const acceptScopedSaved = useCallback<ButtonEditorStore["acceptScopedSaved"]>((
    document,
    applySavedScope
  ) => {
    setState((current) => {
      const saved = cloneButtonDocument(document);
      const rebase = (source: ButtonStateDocument): ButtonStateDocument => {
        const next = cloneButtonDocument(source);
        applySavedScope(next, saved);
        next.revision = saved.revision;
        return next;
      };
      return {
        committed: saved,
        draft: rebase(current.draft),
        past: current.past.map((entry) => ({
          ...entry,
          document: rebase(entry.document)
        })),
        future: current.future.map((entry) => ({
          ...entry,
          document: rebase(entry.document)
        }))
      };
    });
  }, []);

  const cancel = useCallback(() => {
    setState((current) => ({
      ...current,
      draft: cloneButtonDocument(current.committed),
      past: [],
      future: []
    }));
  }, []);

  const resetFromRepository = useCallback((document: ButtonStateDocument) => {
    setState({
      committed: cloneButtonDocument(document),
      draft: cloneButtonDocument(document),
      past: [],
      future: []
    });
  }, []);

  return useMemo(() => ({
    committed: state.committed,
    draft: state.draft,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    current: () => draftRef.current,
    transact,
    undo,
    redo,
    acceptSaved,
    acceptScopedSaved,
    cancel,
    resetFromRepository
  }), [state, transact, undo, redo, acceptSaved, acceptScopedSaved, cancel, resetFromRepository]);
}
