import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

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
