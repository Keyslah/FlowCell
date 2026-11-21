import { useSyncExternalStore } from "react";
import type { ButtonSkin } from "../types";
import {
  CONCRETE_MOSS_KEY_MATERIAL,
  MAIN_KEY_MATERIAL_ATTRIBUTE,
  concreteMossKeyTwin,
  type ConcreteMossKeySet
} from "./concreteMossKeyTwin";

// The rendered Concrete Moss keys load only while the Main page's theme is Concrete Moss.
let keys: ConcreteMossKeySet | null = null;
let loading = false;
let observer: MutationObserver | null = null;
const listeners = new Set<() => void>();
const renderers = new WeakMap<ConcreteMossKeySet, (skin: ButtonSkin) => ButtonSkin>();

function rootMaterial(): string | null {
  return typeof document === "undefined" ? null : document.documentElement.getAttribute(MAIN_KEY_MATERIAL_ATTRIBUTE);
}

function notify(): void {
  for (const listener of listeners) listener();
}

function ensureKeys(): void {
  if (keys || loading || rootMaterial() !== CONCRETE_MOSS_KEY_MATERIAL) return;
  loading = true;
  void import("./concreteMossKeys")
    .then((module) => {
      keys = module.CONCRETE_MOSS_KEYS;
      notify();
    })
    .catch(() => {})
    .finally(() => { loading = false; });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!observer && typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    observer = new MutationObserver(() => {
      ensureKeys();
      notify();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [MAIN_KEY_MATERIAL_ATTRIBUTE] });
  }
  ensureKeys();
  return () => {
    listeners.delete(listener);
    if (!listeners.size && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

function currentKeys(): ConcreteMossKeySet | null {
  return rootMaterial() === CONCRETE_MOSS_KEY_MATERIAL ? keys : null;
}

/**
 * Main page only: while its theme is Concrete Moss, a draw-time skin swap that shows each
 * Chipped Concrete key as its Concrete Moss twin; otherwise undefined (Buttons draw as saved).
 */
export function useMainKeyMaterial(): ((skin: ButtonSkin) => ButtonSkin) | undefined {
  const loaded = useSyncExternalStore(subscribe, currentKeys, () => null);
  if (!loaded) return undefined;
  let render = renderers.get(loaded);
  if (!render) {
    render = (skin: ButtonSkin) => concreteMossKeyTwin(skin, loaded);
    renderers.set(loaded, render);
  }
  return render;
}
