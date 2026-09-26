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
import { withCanonicalProgramPopoutThemes } from "./buttonWindowThemeDocument";

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
    let acceptedDocumentVersion = 0;
    let savedLoadVersion = 0;
    let canonicalDocument: ButtonStateDocument | null = null;
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
      acceptedDocumentVersion += 1;
      if (!cancelled) {
        setState({ document, loading: false, error: null });
      }
    };

    const acceptDraft = (document: ButtonStateDocument) => {
      acceptDocument(withCanonicalProgramPopoutThemes(document, canonicalDocument));
    };

    const loadSavedDocument = async () => {
      const loadVersion = ++savedLoadVersion;
      const acceptedVersionAtStart = acceptedDocumentVersion;
      const document = await loadButtonStateDocument();
      if (
        cancelled ||
        loadVersion !== savedLoadVersion
      ) {
        return;
      }
      // A draft may arrive before the initial disk read. Keep its layout while
      // taking the authoritative program rules from the saved document.
      if (canonicalDocument && document.revision < canonicalDocument.revision) return;
      canonicalDocument = document;
      if (acceptedVersionAtStart !== acceptedDocumentVersion) {
        setState((current) => current.document
          ? { ...current, document: withCanonicalProgramPopoutThemes(current.document, document) }
          : current);
        return;
      }
      acceptDocument(document);
    };

    const requestActiveDraft = () => draftSessionId
      ? requestButtonDraft(draftSessionId, requesterLabel, requestId)
      : Promise.resolve();

    void (async () => {
      try {
        addCleanup(await subscribeButtonCommits(async (document) => {
          canonicalDocument = document;
          acceptDocument(document);
          await requestActiveDraft();
        }));

        if (draftSessionId) {
          addCleanup(await subscribeButtonDrafts(draftSessionId, acceptDraft, {
            requesterLabel,
            requestId
          }));
          addCleanup(
            await subscribeButtonDraftCancel(draftSessionId, loadSavedDocument)
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
