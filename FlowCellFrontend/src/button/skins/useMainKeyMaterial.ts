import { useSyncExternalStore } from "react";
import type { ButtonSkin } from "../types";
import {
  CONCRETE_MOSS_KEY_MATERIAL,
  MAIN_KEY_MATERIAL_ATTRIBUTE,
  concreteMossKeyTwin,
  type ConcreteMossKeySet
} from "./concreteMossKeyTwin";
import { PLASTERED_WALL_03_KEY_MATERIAL, plasteredWall03KeyTwin } from "./plasteredWall03KeyTwin";

// Rendered keys load only while their Main page theme is active.
let keys: ConcreteMossKeySet | null = null;
let loading = false;
let plasterKeys: ConcreteMossKeySet | null = null;
let plasterLoading = false;
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
  const material = rootMaterial();
  if (material === CONCRETE_MOSS_KEY_MATERIAL && !keys && !loading) {
    loading = true;
    void import("./concreteMossKeys")
      .then((module) => { keys = module.CONCRETE_MOSS_KEYS; notify(); })
      .catch(() => {})
      .finally(() => { loading = false; });
  } else if (material === PLASTERED_WALL_03_KEY_MATERIAL && !plasterKeys && !plasterLoading) {
    plasterLoading = true;
    void import("./plasteredWall03Keys")
      .then((module) => { plasterKeys = module.PLASTERED_WALL_03_KEYS; notify(); })
      .catch(() => {})
      .finally(() => { plasterLoading = false; });
  }
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
  const material = rootMaterial();
  return material === CONCRETE_MOSS_KEY_MATERIAL ? keys
    : material === PLASTERED_WALL_03_KEY_MATERIAL ? plasterKeys : null;
}

/**
 * Main page only: draw Chipped Concrete keys in the selected rendered material, or as saved.
 */
export function useMainKeyMaterial(): ((skin: ButtonSkin) => ButtonSkin) | undefined {
  const loaded = useSyncExternalStore(subscribe, currentKeys, () => null);
  if (!loaded) return undefined;
  let render = renderers.get(loaded);
  if (!render) {
    render = loaded === plasterKeys
      ? (skin: ButtonSkin) => plasteredWall03KeyTwin(skin, loaded)
      : (skin: ButtonSkin) => concreteMossKeyTwin(skin, loaded);
    renderers.set(loaded, render);
  }
  return render;
}
