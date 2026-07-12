export const BUTTON_WINDOW_GEOMETRY_TRANSITION_ATTRIBUTE =
  "data-button-window-geometry-transition";

export function setButtonWindowGeometryTransitionActive(active: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.toggleAttribute(
    BUTTON_WINDOW_GEOMETRY_TRANSITION_ATTRIBUTE,
    active
  );
}

export function isButtonWindowGeometryTransitionActive(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(
    BUTTON_WINDOW_GEOMETRY_TRANSITION_ATTRIBUTE
  );
}

export function waitForAppliedButtonWindowRender(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

export function waitForButtonWindowHitTestTurn(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
