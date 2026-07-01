import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export async function isNativeSpaceKeyDown(): Promise<boolean> {
  try {
    return await invoke<boolean>("is_space_key_down");
  } catch {
    return false;
  }
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
