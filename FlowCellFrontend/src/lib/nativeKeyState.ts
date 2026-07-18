import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export const NATIVE_INPUT_SNAPSHOT_EVENT = "flowcell-native-input-snapshot";

export interface NativeInputSnapshot {
  x: number;
  y: number;
  spaceDown: boolean;
  primaryButtonDown: boolean;
}

function normalizeNativeInputSnapshot(value: NativeInputSnapshot): NativeInputSnapshot | null {
  return Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    typeof value.spaceDown === "boolean" &&
    typeof value.primaryButtonDown === "boolean"
    ? value
    : null;
}

export async function getNativeInputSnapshot(): Promise<NativeInputSnapshot | null> {
  try {
    const snapshot = await invoke<NativeInputSnapshot>("get_native_input_snapshot");
    return normalizeNativeInputSnapshot(snapshot);
  } catch {
    return null;
  }
}

export function listenNativeInputSnapshots(
  onSnapshot: (snapshot: NativeInputSnapshot) => void
): Promise<UnlistenFn> {
  return listen<NativeInputSnapshot>(NATIVE_INPUT_SNAPSHOT_EVENT, ({ payload }) => {
    const snapshot = normalizeNativeInputSnapshot(payload);
    if (snapshot) onSnapshot(snapshot);
  });
}

export async function isNativeSpaceKeyDown(): Promise<boolean> {
  try {
    return await invoke<boolean>("is_space_key_down");
  } catch {
    return false;
  }
}

export async function isNativePrimaryMouseButtonDown(): Promise<boolean> {
  try {
    return await invoke<boolean>("is_primary_mouse_button_down");
  } catch {
    return false;
  }
}

export async function waitForNativeWindowDragEnd(options?: {
  pollMs?: number;
  settleMs?: number;
  maxWaitMs?: number;
}): Promise<void> {
  const pollMs = options?.pollMs ?? 40;
  const settleMs = options?.settleMs ?? 80;
  const maxWaitMs = options?.maxWaitMs ?? 30000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (!(await isNativePrimaryMouseButtonDown())) {
      break;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, pollMs));
  }
  await new Promise<void>((resolve) => window.setTimeout(resolve, settleMs));
}

export function useNativeSpaceDragActive(pollMs = 32): boolean {
  const [spaceDown, setSpaceDown] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const syncSpaceState = () => {
      void isNativeSpaceKeyDown().then((nextSpaceDown) => {
        if (!cancelled) {
          setSpaceDown(nextSpaceDown);
        }
      });
    };

    syncSpaceState();
    const intervalId = window.setInterval(syncSpaceState, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [pollMs]);

  return spaceDown;
}
