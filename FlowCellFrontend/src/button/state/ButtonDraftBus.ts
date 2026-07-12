import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ButtonDesktopBounds,
  ButtonRect,
  ButtonStateDocument,
  ButtonWindowFitMode
} from "../types";
import { cloneButtonDocument } from "./buttonDefaults";

const DRAFT_EVENT = "flowcell:button-draft";
const DRAFT_REQUEST_EVENT = "flowcell:button-draft-request";
const DRAFT_CANCEL_EVENT = "flowcell:button-draft-cancel";
const COMMIT_EVENT = "flowcell:button-commit";
const RESTING_WINDOW_BOUNDS_EVENT = "flowcell:button-resting-window-bounds";

interface DraftPayload {
  sessionId: string;
  document: ButtonStateDocument;
  requesterLabel?: string;
  requestId?: string;
}

interface DraftRequestPayload {
  sessionId: string;
  requesterLabel: string;
  requestId: string;
}

interface DraftCancelPayload {
  sessionId: string;
}

interface CommitPayload {
  document: ButtonStateDocument;
}

export type ButtonRestingWindowBoundsUpdate =
  | {
      kind: "popout";
      popoutUnitId: string;
      fitMode: ButtonWindowFitMode;
      bounds: ButtonDesktopBounds;
      envelope: ButtonRect;
    }
  | {
      kind: "fan";
      fanSetupId: string;
      fitMode: ButtonWindowFitMode;
      bounds: ButtonDesktopBounds;
      envelope: ButtonRect;
    };

interface RestingWindowBoundsPayload {
  sessionId: string;
  update: ButtonRestingWindowBoundsUpdate;
}

export interface ButtonDraftSubscriptionOptions {
  requesterLabel?: string;
  requestId?: string;
}

let nextDraftRequestId = 0;

export function createButtonDraftRequestId(requesterLabel: string): string {
  nextDraftRequestId += 1;
  return `${requesterLabel}:${Date.now().toString(36)}:${nextDraftRequestId.toString(36)}`;
}

export function publishButtonDraft(
  sessionId: string,
  document: ButtonStateDocument
): Promise<void> {
  return emit(DRAFT_EVENT, { sessionId, document: cloneButtonDocument(document) } satisfies DraftPayload);
}

export function publishButtonDraftToWindow(
  sessionId: string,
  requesterLabel: string,
  document: ButtonStateDocument
): Promise<void> {
  return emit(DRAFT_EVENT, {
    sessionId,
    requesterLabel,
    document: cloneButtonDocument(document)
  } satisfies DraftPayload);
}

export function requestButtonDraft(
  sessionId: string,
  requesterLabel: string,
  requestId = createButtonDraftRequestId(requesterLabel)
): Promise<void> {
  return emit(DRAFT_REQUEST_EVENT, {
    sessionId,
    requesterLabel,
    requestId
  } satisfies DraftRequestPayload);
}

export function subscribeButtonDrafts(
  sessionId: string,
  handler: (document: ButtonStateDocument) => void | Promise<void>,
  options: ButtonDraftSubscriptionOptions = {}
): Promise<UnlistenFn> {
  return listen<DraftPayload>(DRAFT_EVENT, (event) => {
    if (event.payload.sessionId !== sessionId) return;
    if (
      event.payload.requesterLabel &&
      options.requesterLabel &&
      event.payload.requesterLabel !== options.requesterLabel
    ) {
      return;
    }
    if (
      event.payload.requestId &&
      options.requestId &&
      event.payload.requestId !== options.requestId
    ) {
      return;
    }
    return handler(cloneButtonDocument(event.payload.document));
  });
}

export function registerButtonDraftResponder(
  sessionId: string,
  getDocument: () => ButtonStateDocument
): Promise<UnlistenFn> {
  return listen<DraftRequestPayload>(DRAFT_REQUEST_EVENT, (event) => {
    if (event.payload.sessionId !== sessionId) return;
    return emit(DRAFT_EVENT, {
      sessionId,
      requesterLabel: event.payload.requesterLabel,
      requestId: event.payload.requestId,
      document: cloneButtonDocument(getDocument())
    } satisfies DraftPayload);
  });
}

export function publishButtonCommit(document: ButtonStateDocument): Promise<void> {
  return emit(COMMIT_EVENT, { document: cloneButtonDocument(document) } satisfies CommitPayload);
}

export function subscribeButtonCommits(
  handler: (document: ButtonStateDocument) => void | Promise<void>
): Promise<UnlistenFn> {
  return listen<CommitPayload>(COMMIT_EVENT, (event) => handler(cloneButtonDocument(event.payload.document)));
}

export function publishButtonDraftCancel(sessionId: string): Promise<void> {
  return emit(DRAFT_CANCEL_EVENT, { sessionId } satisfies DraftCancelPayload);
}

export function subscribeButtonDraftCancel(
  sessionId: string,
  handler: () => void | Promise<void>
): Promise<UnlistenFn> {
  return listen<DraftCancelPayload>(DRAFT_CANCEL_EVENT, (event) => {
    if (event.payload.sessionId !== sessionId) return;
    return handler();
  });
}

export function publishButtonRestingWindowBounds(
  sessionId: string,
  update: ButtonRestingWindowBoundsUpdate
): Promise<void> {
  return emit(RESTING_WINDOW_BOUNDS_EVENT, {
    sessionId,
    update
  } satisfies RestingWindowBoundsPayload);
}

export function subscribeButtonRestingWindowBounds(
  sessionId: string,
  handler: (update: ButtonRestingWindowBoundsUpdate) => void | Promise<void>
): Promise<UnlistenFn> {
  return listen<RestingWindowBoundsPayload>(RESTING_WINDOW_BOUNDS_EVENT, (event) => {
    if (event.payload.sessionId !== sessionId) return;
    return handler(event.payload.update);
  });
}
