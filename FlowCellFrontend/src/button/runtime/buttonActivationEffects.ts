import type { ButtonRecord } from "../types.js";
import { canButtonRunActivationAnimation } from "../animations/buttonActivationAnimations.js";

type ButtonActivationEffectHandler = (
  button: ButtonRecord
) => void | Promise<void>;

let activeHandler: ButtonActivationEffectHandler | null = null;

export function registerButtonActivationEffectHandler(
  handler: ButtonActivationEffectHandler
): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) {
      activeHandler = null;
    }
  };
}

export function notifyButtonActivationEffect(button: ButtonRecord): void {
  if (
    !button.activationAnimation ||
    !activeHandler ||
    !canButtonRunActivationAnimation(button)
  ) {
    return;
  }
  void Promise.resolve(activeHandler(button)).catch((error) => {
    console.error(`Button '${button.label}' animation failed.`, error);
  });
}
