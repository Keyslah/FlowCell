import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

// FlowCell rail-motion settings.

const MOTION_SETTINGS_STORAGE_KEY = "flowcell.motion-settings.v1";
const LEGACY_MOTION_SETTINGS_STORAGE_KEY = "flowcell.appearance-settings.v1";
export const MOTION_SETTINGS_CHANGED_EVENT = "flowcell:motion-settings-changed";

export type EasingId =
  | "accelerate"
  | "decelerate"
  | "smooth"
  | "snappy"
  | "overshoot"
  | "linear";

export interface EasingOption {
  id: EasingId;
  label: string;
  description: string;
  cubicBezier: [number, number, number, number];
}

// Ordered for display. "accelerate" is the "starts slow then speeds up" curve.
export const EASING_OPTIONS: readonly EasingOption[] = [
  {
    id: "accelerate",
    label: "Slow → fast",
    description: "Starts slow, then speeds up",
    cubicBezier: [0.4, 0, 1, 1]
  },
  {
    id: "decelerate",
    label: "Fast → slow",
    description: "Starts fast, eases to a stop",
    cubicBezier: [0, 0, 0.3, 1]
  },
  {
    id: "smooth",
    label: "Ease in-out",
    description: "Slow at both ends",
    cubicBezier: [0.45, 0, 0.55, 1]
  },
  {
    id: "snappy",
    label: "Snappy",
    description: "Quick, then settles",
    cubicBezier: [0.22, 1, 0.36, 1]
  },
  {
    id: "overshoot",
    label: "Overshoot",
    description: "Passes, then eases back",
    cubicBezier: [0.34, 1.56, 0.64, 1]
  },
  {
    id: "linear",
    label: "Linear",
    description: "Constant speed",
    cubicBezier: [0, 0, 1, 1]
  }
];

const EASING_BY_ID = new Map(EASING_OPTIONS.map((option) => [option.id, option]));

export function resolveEasingOption(id: EasingId): EasingOption {
  return EASING_BY_ID.get(id) ?? EASING_OPTIONS[0];
}

export function easingCss(id: EasingId): string {
  const [a, b, c, d] = resolveEasingOption(id).cubicBezier;
  return `cubic-bezier(${a}, ${b}, ${c}, ${d})`;
}

export interface RailHoverMotionSettings {
  // How the rail settles down when a pointer enters it.
  dropDurationMs: number;
  dropEasingId: EasingId;
  // How the rail rises back when the pointer leaves.
  riseDurationMs: number;
  riseEasingId: EasingId;
  // How far it travels, and whether the frost clears. Modeled with defaults now so
  // sliders for them can be added later without a storage migration.
  dropOffsetPx: number;
  clearOnHover: boolean;
}

export interface MotionSettings {
  version: 1;
  railHover: RailHoverMotionSettings;
}

export const DURATION_MIN_MS = 60;
export const DURATION_MAX_MS = 2000;
export const DROP_OFFSET_MIN_PX = 0;
export const DROP_OFFSET_MAX_PX = 60;

export const DEFAULT_MOTION_SETTINGS: MotionSettings = {
  version: 1,
  railHover: {
    dropDurationMs: 420,
    dropEasingId: "accelerate",
    riseDurationMs: 620,
    riseEasingId: "decelerate",
    dropOffsetPx: 13,
    clearOnHover: true
  }
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, min), max)
    : fallback;
}

function normalizeEasingId(value: unknown, fallback: EasingId): EasingId {
  return typeof value === "string" && EASING_BY_ID.has(value as EasingId)
    ? (value as EasingId)
    : fallback;
}

function normalizeRailHover(value: unknown): RailHoverMotionSettings {
  const defaults = DEFAULT_MOTION_SETTINGS.railHover;
  const source = (value ?? {}) as Partial<RailHoverMotionSettings>;
  return {
    dropDurationMs: clampNumber(
      source.dropDurationMs,
      DURATION_MIN_MS,
      DURATION_MAX_MS,
      defaults.dropDurationMs
    ),
    dropEasingId: normalizeEasingId(source.dropEasingId, defaults.dropEasingId),
    riseDurationMs: clampNumber(
      source.riseDurationMs,
      DURATION_MIN_MS,
      DURATION_MAX_MS,
      defaults.riseDurationMs
    ),
    riseEasingId: normalizeEasingId(source.riseEasingId, defaults.riseEasingId),
    dropOffsetPx: clampNumber(
      source.dropOffsetPx,
      DROP_OFFSET_MIN_PX,
      DROP_OFFSET_MAX_PX,
      defaults.dropOffsetPx
    ),
    clearOnHover: source.clearOnHover !== false
  };
}

export function normalizeMotionSettings(value: unknown): MotionSettings {
  const source = (value ?? {}) as Partial<MotionSettings>;
  return {
    version: 1,
    railHover: normalizeRailHover(source.railHover)
  };
}

export function readMotionSettings(): MotionSettings {
  if (!canUseStorage()) {
    return normalizeMotionSettings(null);
  }

  const rawValue =
    window.localStorage.getItem(MOTION_SETTINGS_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_MOTION_SETTINGS_STORAGE_KEY);
  if (!rawValue) {
    return normalizeMotionSettings(null);
  }

  try {
    return normalizeMotionSettings(JSON.parse(rawValue));
  } catch {
    return normalizeMotionSettings(null);
  }
}

export function writeMotionSettings(settings: MotionSettings): MotionSettings {
  const normalized = normalizeMotionSettings(settings);
  if (canUseStorage()) {
    window.localStorage.setItem(
      MOTION_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalized)
    );
    window.localStorage.removeItem(LEGACY_MOTION_SETTINGS_STORAGE_KEY);
  }
  // Broadcast to sibling windows. localStorage's own "storage" event does not fire
  // in the window that made the change, and does not cross Tauri webviews reliably,
  // so the Tauri event is the primary cross-window signal.
  void emit(MOTION_SETTINGS_CHANGED_EVENT, normalized).catch(() => {});
  return normalized;
}

// Subscribe to motion changes from any window. Fires with the freshly read
// settings whenever this or another window writes them.
export function subscribeMotionSettings(
  onChange: (settings: MotionSettings) => void
): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key &&
      event.key !== MOTION_SETTINGS_STORAGE_KEY &&
      event.key !== LEGACY_MOTION_SETTINGS_STORAGE_KEY
    ) {
      return;
    }
    onChange(readMotionSettings());
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }

  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  void listen<MotionSettings>(MOTION_SETTINGS_CHANGED_EVENT, (event) => {
    onChange(normalizeMotionSettings(event.payload));
  })
    .then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    })
    .catch(() => {});

  return () => {
    disposed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
    if (unlisten) {
      unlisten();
    }
  };
}
