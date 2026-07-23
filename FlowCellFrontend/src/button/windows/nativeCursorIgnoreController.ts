export interface NativeCursorIgnoreController {
  request(ignored: boolean): void;
  invalidate(): void;
  reset(ignored: boolean): void;
  shutdown(onIgnored?: () => void): void;
}

interface NativeCursorIgnoreControllerOptions {
  retryDelaysMs?: readonly number[];
}

const DEFAULT_RETRY_DELAYS_MS = [50, 100, 250, 500, 1_000] as const;

export function shouldIgnoreButtonWindowCursor(
  scopeActive: boolean,
  hovered: boolean,
  pointerPressActive = false
): boolean {
  return !scopeActive || (!hovered && !pointerPressActive);
}

export function isNativeQueryRevisionCurrent(
  queryRevision: number,
  eventRevision: number
): boolean {
  return queryRevision === eventRevision;
}

export function createNativeCursorIgnoreController(
  applyIgnored: (ignored: boolean) => Promise<void>,
  options?: NativeCursorIgnoreControllerOptions
): NativeCursorIgnoreController {
  const retryDelays = options?.retryDelaysMs?.length
    ? options.retryDelaysMs
    : DEFAULT_RETRY_DELAYS_MS;
  let desiredState: boolean | null = null;
  let appliedState: boolean | null = null;
  let applying = false;
  let disposed = false;
  let shuttingDown = false;
  let externalRevision = 0;
  let onShutdownIgnored: (() => void) | undefined;
  let failureCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelRetry = () => {
    if (retryTimer === null) return;
    globalThis.clearTimeout(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = (pump: () => void) => {
    if (disposed || retryTimer !== null) return;
    const delay = retryDelays[Math.min(failureCount - 1, retryDelays.length - 1)] ?? 1_000;
    retryTimer = globalThis.setTimeout(() => {
      retryTimer = null;
      pump();
    }, delay);
  };

  const pump = () => {
    if (
      disposed ||
      applying ||
      desiredState === null ||
      appliedState === desiredState
    ) {
      return;
    }

    const targetState = desiredState;
    const applyRevision = externalRevision;
    applying = true;
    void applyIgnored(targetState)
      .then(() => {
        applying = false;
        appliedState = applyRevision === externalRevision ? targetState : null;
        failureCount = 0;
        if (shuttingDown && targetState && appliedState === true) {
          disposed = true;
          cancelRetry();
          onShutdownIgnored?.();
          onShutdownIgnored = undefined;
          return;
        }
        if (desiredState !== appliedState) pump();
      })
      .catch(() => {
        applying = false;
        appliedState = null;
        failureCount += 1;
        if (desiredState !== targetState) {
          cancelRetry();
          pump();
        } else {
          scheduleRetry(pump);
        }
      });
  };

  return {
    request(ignored) {
      if (disposed || shuttingDown) return;
      const changed = desiredState !== ignored;
      desiredState = ignored;
      if (changed) cancelRetry();
      pump();
    },
    invalidate() {
      if (disposed || shuttingDown) return;
      externalRevision += 1;
      appliedState = null;
      cancelRetry();
      pump();
    },
    reset(ignored) {
      if (disposed || shuttingDown) return;
      desiredState = ignored;
      externalRevision += 1;
      appliedState = null;
      cancelRetry();
      pump();
    },
    shutdown(onIgnored) {
      if (disposed || shuttingDown) return;
      shuttingDown = true;
      onShutdownIgnored = onIgnored;
      externalRevision += 1;
      desiredState = true;
      appliedState = null;
      cancelRetry();
      pump();
    }
  };
}
