import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

const BUTTON_ACTIVATION_ADVANCE_EVENT = "flowcell://button-activation/advance";
const BUTTON_ACTIVATION_SNAPSHOT_EVENT = "flowcell://button-activation/snapshot";
const BUTTON_ACTIVATION_UPDATE_EVENT = "flowcell://button-activation/update";

interface ButtonActivationRequest {
  buttonId: string;
  stateCount: number;
}

interface ButtonActivationUpdate extends ButtonActivationRequest {
  index: number;
}

const coordinatorIndexes = new Map<string, number>();
const coordinatorPublishQueues = new Map<string, Promise<void>>();
const localIndexes = new Map<string, number>();
const localSubscribers = new Map<string, Set<(index: number) => void>>();
let coordinatorRefCount = 0;
let coordinatorListeners: Promise<readonly UnlistenFn[]> | null = null;

function normalizedCount(stateCount: number): number {
  return Math.max(1, Math.floor(Number.isFinite(stateCount) ? stateCount : 1));
}

function normalizedIndex(index: number, stateCount: number): number {
  const count = normalizedCount(stateCount);
  const candidate = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0));
  return Math.min(count - 1, candidate);
}

function publishLocal(update: ButtonActivationUpdate): void {
  const index = normalizedIndex(update.index, update.stateCount);
  localIndexes.set(update.buttonId, index);
  localSubscribers.get(update.buttonId)?.forEach((subscriber) => subscriber(index));
}

async function publishCoordinatorUpdate(update: ButtonActivationUpdate): Promise<void> {
  localIndexes.set(update.buttonId, normalizedIndex(update.index, update.stateCount));
  try {
    await emit(BUTTON_ACTIVATION_UPDATE_EVENT, update);
  } catch {
    publishLocal(update);
  }
}

function queueCoordinatorUpdate(update: ButtonActivationUpdate): void {
  const previous = coordinatorPublishQueues.get(update.buttonId) ?? Promise.resolve();
  const queued = previous.then(
    () => publishCoordinatorUpdate(update),
    () => publishCoordinatorUpdate(update)
  );
  coordinatorPublishQueues.set(update.buttonId, queued);
  const finish = () => {
    if (coordinatorPublishQueues.get(update.buttonId) === queued) {
      coordinatorPublishQueues.delete(update.buttonId);
    }
  };
  void queued.then(finish, finish);
}

async function createCoordinatorListeners(): Promise<readonly UnlistenFn[]> {
  const advanceUnlisten = await listen<ButtonActivationRequest>(
    BUTTON_ACTIVATION_ADVANCE_EVENT,
    ({ payload }) => {
      const stateCount = normalizedCount(payload.stateCount);
      const current = normalizedIndex(coordinatorIndexes.get(payload.buttonId) ?? 0, stateCount);
      const index = (current + 1) % stateCount;
      coordinatorIndexes.set(payload.buttonId, index);
      queueCoordinatorUpdate({ ...payload, stateCount, index });
    }
  );
  try {
    const snapshotUnlisten = await listen<ButtonActivationRequest>(
      BUTTON_ACTIVATION_SNAPSHOT_EVENT,
      ({ payload }) => {
        const stateCount = normalizedCount(payload.stateCount);
        const index = normalizedIndex(coordinatorIndexes.get(payload.buttonId) ?? 0, stateCount);
        coordinatorIndexes.set(payload.buttonId, index);
        queueCoordinatorUpdate({ ...payload, stateCount, index });
      }
    );
    return [advanceUnlisten, snapshotUnlisten];
  } catch (error) {
    advanceUnlisten();
    throw error;
  }
}

/**
 * Main owns the session-only activation index so every Main, Pop, and Fan host
 * sees the same toggle/cycle state. The index intentionally resets on restart.
 */
export async function startButtonActivationStateCoordinator(): Promise<() => void> {
  coordinatorRefCount += 1;
  coordinatorListeners ??= createCoordinatorListeners();
  try {
    await coordinatorListeners;
  } catch (error) {
    coordinatorRefCount = Math.max(0, coordinatorRefCount - 1);
    coordinatorListeners = null;
    throw error;
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    coordinatorRefCount = Math.max(0, coordinatorRefCount - 1);
    if (coordinatorRefCount !== 0 || !coordinatorListeners) return;
    const listeners = coordinatorListeners;
    coordinatorListeners = null;
    coordinatorIndexes.clear();
    coordinatorPublishQueues.clear();
    void listeners.then((unlistenFns) => unlistenFns.forEach((unlisten) => unlisten()));
  };
}

export async function subscribeButtonActivationState(
  buttonId: string,
  stateCount: number,
  subscriber: (index: number) => void
): Promise<() => void> {
  const count = normalizedCount(stateCount);
  const subscribers = localSubscribers.get(buttonId) ?? new Set<(index: number) => void>();
  subscribers.add(subscriber);
  localSubscribers.set(buttonId, subscribers);
  subscriber(normalizedIndex(localIndexes.get(buttonId) ?? 0, count));

  let unlisten: UnlistenFn | null = null;
  try {
    unlisten = await listen<ButtonActivationUpdate>(
      BUTTON_ACTIVATION_UPDATE_EVENT,
      ({ payload }) => {
        if (payload.buttonId !== buttonId) return;
        const index = normalizedIndex(payload.index, count);
        localIndexes.set(buttonId, index);
        subscriber(index);
      }
    );
    await emit(BUTTON_ACTIVATION_SNAPSHOT_EVENT, { buttonId, stateCount: count } satisfies ButtonActivationRequest);
  } catch {
    // Browser/dev harnesses use the local session map without requiring Tauri.
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unlisten?.();
    const current = localSubscribers.get(buttonId);
    current?.delete(subscriber);
    if (current?.size === 0) localSubscribers.delete(buttonId);
  };
}

export async function advanceButtonActivationState(
  buttonId: string,
  stateCount: number
): Promise<void> {
  const count = normalizedCount(stateCount);
  if (count <= 1) return;
  try {
    await emit(BUTTON_ACTIVATION_ADVANCE_EVENT, { buttonId, stateCount: count } satisfies ButtonActivationRequest);
  } catch {
    const current = normalizedIndex(localIndexes.get(buttonId) ?? 0, count);
    publishLocal({ buttonId, stateCount: count, index: (current + 1) % count });
  }
}
