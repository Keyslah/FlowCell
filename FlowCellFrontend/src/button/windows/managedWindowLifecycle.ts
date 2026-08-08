export type ManagedWindowGeneration = symbol | undefined;

export class ManagedWindowGenerationRegistry {
  private readonly generations = new Map<string, symbol>();

  begin(windowLabel: string): symbol {
    const generation = Symbol(windowLabel);
    this.generations.set(windowLabel, generation);
    return generation;
  }

  current(windowLabel: string): ManagedWindowGeneration {
    return this.generations.get(windowLabel);
  }

  clearIfCurrent(windowLabel: string, generation: ManagedWindowGeneration): boolean {
    if (this.generations.get(windowLabel) !== generation) return false;
    this.generations.delete(windowLabel);
    return true;
  }
}

export async function waitForManagedWindowToDisappear<T>(args: {
  windowLabel: string;
  lookup: () => Promise<T | null>;
  timeoutMs: number;
  pollMs: number;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
}): Promise<void> {
  const now = args.now ?? Date.now;
  const delay =
    args.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds)));
  const deadline = now() + args.timeoutMs;
  while (await args.lookup()) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for FlowCell window "${args.windowLabel}" to close.`);
    }
    await delay(Math.min(args.pollMs, remaining));
  }
}
