import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ButtonStateDocument } from "../types";
import {
  createButtonDraftRequestId,
  requestButtonDraft,
  subscribeButtonCommits,
  subscribeButtonDraftCancel,
  subscribeButtonDrafts
} from "../state/ButtonDraftBus";
import { loadButtonStateDocument } from "../state/ButtonStateRepository";
import { withCanonicalPanelFanMotion, withCanonicalProgramPopoutThemes } from "./buttonWindowThemeDocument";
import { withAddedCanonicalPanelButtons } from "../state/panelPopoutReconciliation";

export interface ButtonWindowDocumentState {
  document: ButtonStateDocument | null;
  loading: boolean;
  error: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useButtonWindowDocument(
  draftSessionId?: string
): ButtonWindowDocumentState {
  const [state, setState] = useState<ButtonWindowDocumentState>({
    document: null,
    loading: true,
    error: null
  });

  useEffect(() => {
    let cancelled = false;
    let savedLoadVersion = 0;
    let canonicalDocument: ButtonStateDocument | null = null;
    let activeDraftDocument: ButtonStateDocument | null = null;
    let awaitingFirstDraft = Boolean(draftSessionId);
    const cleanups: Array<() => void> = [];
    const requesterLabel = getCurrentWindow().label;
    const requestId = createButtonDraftRequestId(requesterLabel);

    setState({ document: null, loading: true, error: null });

    const addCleanup = (cleanup: () => void) => {
      if (cancelled) {
        cleanup();
      } else {
        cleanups.push(cleanup);
      }
    };

    const acceptDocument = (document: ButtonStateDocument) => {
      if (!cancelled) {
        setState({ document: withCanonicalPanelFanMotion(document, canonicalDocument), loading: false, error: null });
      }
    };

    const renderDraft = (document: ButtonStateDocument) => {
      acceptDocument(withCanonicalProgramPopoutThemes(
        withAddedCanonicalPanelButtons(document, canonicalDocument), canonicalDocument
      ));
    };

    const acceptDraft = (document: ButtonStateDocument) => {
      if (cancelled) return;
      activeDraftDocument = document;
      awaitingFirstDraft = false;
      renderDraft(document);
    };

    const acceptCanonicalDocument = (document: ButtonStateDocument) => {
      canonicalDocument = document;
      if (activeDraftDocument) {
        renderDraft(activeDraftDocument);
      } else if (!awaitingFirstDraft) {
        acceptDocument(document);
      }
    };

    const loadSavedDocument = async () => {
      const loadVersion = ++savedLoadVersion;
      const document = await loadButtonStateDocument();
      if (
        cancelled ||
        loadVersion !== savedLoadVersion
      ) {
        return;
      }
      // Canonical state supplies shared rules; a transient setup exists only in
      // its draft. Keep waiting for that draft, or retain it across this read.
      acceptCanonicalDocument(canonicalDocument && document.revision < canonicalDocument.revision
        ? canonicalDocument : document);
    };

    const cancelDraft = () => {
      activeDraftDocument = null;
      awaitingFirstDraft = false;
      return loadSavedDocument();
    };

    const requestActiveDraft = () => draftSessionId
      ? requestButtonDraft(draftSessionId, requesterLabel, requestId)
      : Promise.resolve();

    void (async () => {
      try {
        addCleanup(await subscribeButtonCommits(async (document) => {
          acceptCanonicalDocument(document);
          await requestActiveDraft();
        }));

        if (draftSessionId) {
          addCleanup(await subscribeButtonDrafts(draftSessionId, acceptDraft, {
            requesterLabel,
            requestId
          }));
          addCleanup(
            await subscribeButtonDraftCancel(draftSessionId, cancelDraft)
          );
        }

        const initialSavedLoad = loadSavedDocument();
        await requestActiveDraft();
        await initialSavedLoad;
      } catch (error) {
        if (!cancelled) {
          setState({ document: null, loading: false, error: errorMessage(error) });
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [draftSessionId]);

  return state;
}
