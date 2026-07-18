export type RegistrationFactory = () => () => void;

export interface LatestDesiredRegistrationCoordinator {
  setDesired(needed: boolean): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Serializes an asynchronously loaded registration against the latest requested state.
 * The loader returns a factory so registration itself happens only after the coordinator
 * re-checks whether the contribution is still wanted.
 */
export function createLatestDesiredRegistrationCoordinator(
  loadRegistration: () => Promise<RegistrationFactory>
): LatestDesiredRegistrationCoordinator {
  let desired = false;
  let disposed = false;
  let registrationFactory: RegistrationFactory | null = null;
  let unregister: (() => void) | null = null;
  let queue = Promise.resolve();

  const deactivate = () => {
    const current = unregister;
    unregister = null;
    current?.();
  };

  const reconcile = async () => {
    if (disposed || !desired) {
      deactivate();
      return;
    }
    if (unregister) return;

    const register = registrationFactory ?? await loadRegistration();
    registrationFactory = register;
    if (disposed || !desired) return;

    unregister = register();
    if (disposed || !desired) deactivate();
  };

  const enqueueReconciliation = () => {
    const next = queue.catch(() => {}).then(reconcile);
    queue = next;
    return next;
  };

  return {
    setDesired(needed) {
      if (!disposed) desired = needed;
      return enqueueReconciliation();
    },
    dispose() {
      if (disposed) return queue;
      disposed = true;
      desired = false;
      try {
        deactivate();
      } catch (error) {
        return Promise.reject(error);
      }
      return enqueueReconciliation();
    }
  };
}
