export async function afterPendingWindowOpens<T>(
  pendingOpens: ReadonlyMap<string, Promise<unknown>>,
  windowLabel: string,
  operation: () => Promise<T>
): Promise<T> {
  const observed = new Set<Promise<unknown>>();
  while (true) {
    const pendingOpen = pendingOpens.get(windowLabel);
    if (!pendingOpen || observed.has(pendingOpen)) break;
    observed.add(pendingOpen);
    await pendingOpen.catch(() => {});
  }
  return operation();
}
