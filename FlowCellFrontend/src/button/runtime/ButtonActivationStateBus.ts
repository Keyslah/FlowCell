import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ButtonCycleAdvanceTrigger } from "../types.js";

const BUTTON_ACTIVATION_ADVANCE_EVENT = "flowcell://button-activation/advance";
const BUTTON_ACTIVATION_SET_EVENT = "flowcell://button-activation/set";
const BUTTON_ACTIVATION_TRIGGER_EVENT = "flowcell://button-activation/trigger";
const BUTTON_ACTIVATION_SNAPSHOT_EVENT = "flowcell://button-activation/snapshot";
const BUTTON_ACTIVATION_UPDATE_EVENT = "flowcell://button-activation/update";
const MAX_CONSUMED_INTERACTION_IDS_PER_KEY = 256;

interface ButtonActivationRequest {
  activationKey: string;
  stateCount: number;
}

interface ButtonActivationUpdate extends ButtonActivationRequest {
  index: number;
}

interface ButtonActivationTriggerRequest extends ButtonActivationRequest {
  trigger: ButtonCycleAdvanceTrigger;
  advanceTriggers: ButtonCycleAdvanceTrigger[];
  interactionId: string;
}

interface ButtonActivationConsumedInteractionIds {
  ids: Set<string>;
  order: string[];
}

const coordinatorIndexes = new Map<string, number>();
const coordinatorPublishQueues = new Map<string, Promise<void>>();
const coordinatorConsumedInteractionIds = new Map<string, ButtonActivationConsumedInteractionIds>();
const localIndexes = new Map<string, number>();
const localConsumedInteractionIds = new Map<string, ButtonActivationConsumedInteractionIds>();
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
  localIndexes.set(update.activationKey, index);
  localSubscribers.get(update.activationKey)?.forEach((subscriber) => subscriber(index));
}

async function publishCoordinatorUpdate(update: ButtonActivationUpdate): Promise<void> {
  localIndexes.set(update.activationKey, normalizedIndex(update.index, update.stateCount));
  try {
    await emit(BUTTON_ACTIVATION_UPDATE_EVENT, update);
  } catch {
    publishLocal(update);
  }
}

function queueCoordinatorUpdate(update: ButtonActivationUpdate): void {
  const previous = coordinatorPublishQueues.get(update.activationKey) ?? Promise.resolve();
  const queued = previous.then(
    () => publishCoordinatorUpdate(update),
    () => publishCoordinatorUpdate(update)
  );
  coordinatorPublishQueues.set(update.activationKey, queued);
  const finish = () => {
    if (coordinatorPublishQueues.get(update.activationKey) === queued) {
      coordinatorPublishQueues.delete(update.activationKey);
    }
  };
  void queued.then(finish, finish);
}

function interactionWasConsumed(
  consumedInteractionIds: Map<string, ButtonActivationConsumedInteractionIds>,
  activationKey: string,
  interactionId: string
): boolean {
  return consumedInteractionIds.get(activationKey)?.ids.has(interactionId) ?? false;
}

function rememberConsumedInteraction(
  consumedInteractionIds: Map<string, ButtonActivationConsumedInteractionIds>,
  activationKey: string,
  interactionId: string
): void {
  const history = consumedInteractionIds.get(activationKey) ?? {
    ids: new Set<string>(),
    order: []
  };
  if (history.ids.has(interactionId)) return;
  history.ids.add(interactionId);
  history.order.push(interactionId);
  while (history.order.length > MAX_CONSUMED_INTERACTION_IDS_PER_KEY) {
    const expired = history.order.shift();
    if (expired) history.ids.delete(expired);
  }
  consumedInteractionIds.set(activationKey, history);
}

export function resolveTriggeredIndex(
  request: ButtonActivationTriggerRequest,
  indexes: Map<string, number>,
  consumedInteractionIds: Map<string, ButtonActivationConsumedInteractionIds>
): number | null {
  if (!request.activationKey || !request.interactionId) return null;
  if (interactionWasConsumed(consumedInteractionIds, request.activationKey, request.interactionId)) return null;
  const stateCount = normalizedCount(request.stateCount);
  const current = normalizedIndex(indexes.get(request.activationKey) ?? 0, stateCount);
  if (request.advanceTriggers[current] !== request.trigger) return null;
  rememberConsumedInteraction(consumedInteractionIds, request.activationKey, request.interactionId);
  return (current + 1) % stateCount;
}

async function createCoordinatorListeners(): Promise<readonly UnlistenFn[]> {
  const advanceUnlisten = await listen<ButtonActivationRequest>(
    BUTTON_ACTIVATION_ADVANCE_EVENT,
    ({ payload }) => {
      const stateCount = normalizedCount(payload.stateCount);
      const current = normalizedIndex(coordinatorIndexes.get(payload.activationKey) ?? 0, stateCount);
      const index = (current + 1) % stateCount;
      coordinatorIndexes.set(payload.activationKey, index);
      queueCoordinatorUpdate({ ...payload, stateCount, index });
    }
  );
  try {
    const setUnlisten = await listen<ButtonActivationUpdate>(
      BUTTON_ACTIVATION_SET_EVENT,
      ({ payload }) => {
        const stateCount = normalizedCount(payload.stateCount);
        const index = normalizedIndex(payload.index, stateCount);
        coordinatorIndexes.set(payload.activationKey, index);
        queueCoordinatorUpdate({ activationKey: payload.activationKey, stateCount, index });
      }
    );
    try {
      const triggerUnlisten = await listen<ButtonActivationTriggerRequest>(
        BUTTON_ACTIVATION_TRIGGER_EVENT,
        ({ payload }) => {
          const stateCount = normalizedCount(payload.stateCount);
          const index = resolveTriggeredIndex(
            { ...payload, stateCount },
            coordinatorIndexes,
            coordinatorConsumedInteractionIds
          );
          if (index === null) return;
          coordinatorIndexes.set(payload.activationKey, index);
          queueCoordinatorUpdate({ activationKey: payload.activationKey, stateCount, index });
        }
      );
      try {
        const snapshotUnlisten = await listen<ButtonActivationRequest>(
          BUTTON_ACTIVATION_SNAPSHOT_EVENT,
          ({ payload }) => {
            const stateCount = normalizedCount(payload.stateCount);
            const index = normalizedIndex(coordinatorIndexes.get(payload.activationKey) ?? 0, stateCount);
            coordinatorIndexes.set(payload.activationKey, index);
            queueCoordinatorUpdate({ ...payload, stateCount, index });
          }
        );
        return [advanceUnlisten, setUnlisten, triggerUnlisten, snapshotUnlisten];
      } catch (error) {
        triggerUnlisten();
        throw error;
      }
    } catch (error) {
      setUnlisten();
      throw error;
    }
  } catch (error) {
    advanceUnlisten();
    throw error;
  }
}

/**
 * Main owns each session-only activation index. Legacy behavior uses a Button
 * key; configured placement cycles use the placement key so mounted copies of
 * that placement stay synchronized without coupling sibling placements. Each
 * index starts at zero after restart; an action-backed placement may then set
 * its exact index from a package-owned status response.
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
    coordinatorConsumedInteractionIds.clear();
    void listeners.then((unlistenFns) => unlistenFns.forEach((unlisten) => unlisten()));
  };
}

export async function subscribeButtonActivationState(
  activationKey: string,
  stateCount: number,
  subscriber: (index: number) => void
): Promise<() => void> {
  const count = normalizedCount(stateCount);
  const subscribers = localSubscribers.get(activationKey) ?? new Set<(index: number) => void>();
  subscribers.add(subscriber);
  localSubscribers.set(activationKey, subscribers);
  subscriber(normalizedIndex(localIndexes.get(activationKey) ?? 0, count));

  let unlisten: UnlistenFn | null = null;
  try {
    unlisten = await listen<ButtonActivationUpdate>(
      BUTTON_ACTIVATION_UPDATE_EVENT,
      ({ payload }) => {
        if (payload.activationKey !== activationKey) return;
        const index = normalizedIndex(payload.index, count);
        localIndexes.set(activationKey, index);
        subscriber(index);
      }
    );
    await emit(BUTTON_ACTIVATION_SNAPSHOT_EVENT, { activationKey, stateCount: count } satisfies ButtonActivationRequest);
  } catch {
    // Browser/dev harnesses use the local session map without requiring Tauri.
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unlisten?.();
    const current = localSubscribers.get(activationKey);
    current?.delete(subscriber);
    if (current?.size === 0) localSubscribers.delete(activationKey);
  };
}

export async function setButtonActivationState(
  activationKey: string,
  stateCount: number,
  index: number
): Promise<void> {
  const count = normalizedCount(stateCount);
  const update: ButtonActivationUpdate = {
    activationKey,
    stateCount: count,
    index: normalizedIndex(index, count)
  };
  // The action response belongs to the window that received it. Apply it there
  // immediately, then publish it so Main and any other mounted copies converge
  // on the same index. Tauri emit can succeed with no coordinator listening, so
  // transport success alone cannot be used as proof that this host was updated.
  publishLocal(update);
  try {
    await emit(BUTTON_ACTIVATION_SET_EVENT, update);
  } catch {
    // Browser/dev harnesses and closing windows may not have Tauri transport.
    // The originating host already owns the authoritative response above.
  }
}

export async function advanceButtonActivationState(
  activationKey: string,
  stateCount: number
): Promise<void> {
  const count = normalizedCount(stateCount);
  if (count <= 1) return;
  try {
    await emit(BUTTON_ACTIVATION_ADVANCE_EVENT, { activationKey, stateCount: count } satisfies ButtonActivationRequest);
  } catch {
    const current = normalizedIndex(localIndexes.get(activationKey) ?? 0, count);
    publishLocal({ activationKey, stateCount: count, index: (current + 1) % count });
  }
}

export async function triggerButtonActivationState(
  activationKey: string,
  advanceTriggers: readonly ButtonCycleAdvanceTrigger[],
  trigger: ButtonCycleAdvanceTrigger,
  interactionId: string
): Promise<void> {
  const stateCount = normalizedCount(advanceTriggers.length);
  if (stateCount <= 1 || !interactionId) return;
  const request: ButtonActivationTriggerRequest = {
    activationKey,
    stateCount,
    trigger,
    advanceTriggers: [...advanceTriggers],
    interactionId
  };
  try {
    await emit(BUTTON_ACTIVATION_TRIGGER_EVENT, request);
  } catch {
    const index = resolveTriggeredIndex(request, localIndexes, localConsumedInteractionIds);
    if (index !== null) publishLocal({ activationKey, stateCount, index });
  }
}
