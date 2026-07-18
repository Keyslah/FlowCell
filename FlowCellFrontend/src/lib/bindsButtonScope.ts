import type { BindableButtonRecord } from "../types.js";

export type BindsPanelButtonScope = {
  toolbarButtons: BindableButtonRecord[];
  currentPanelButtons: BindableButtonRecord[];
  toolbarButtonId: string;
};

function normalizedKind(button: BindableButtonRecord): string {
  return button.kind.trim().toLowerCase();
}

function isToolSetChild(button: BindableButtonRecord): boolean {
  return normalizedKind(button) === "tool-set-child";
}

function isToolSetOwner(button: BindableButtonRecord): boolean {
  return normalizedKind(button) === "tool-set-owner";
}

export function deriveBindsPanelButtonScope(
  buttons: readonly BindableButtonRecord[],
  selectedButtonId: string
): BindsPanelButtonScope {
  const toolbarButtons = buttons.filter((button) => !isToolSetChild(button));
  const selectedButton = buttons.find((button) => button.id === selectedButtonId) ?? null;
  const selectedOwnerId =
    selectedButton && (isToolSetOwner(selectedButton) || isToolSetChild(selectedButton))
      ? selectedButton.ownerButtonId?.trim() ?? ""
      : "";
  const selectedOwner = selectedOwnerId
    ? toolbarButtons.find(
        (button) => isToolSetOwner(button) && button.ownerButtonId?.trim() === selectedOwnerId
      ) ?? null
    : null;

  if (!selectedOwner) {
    return {
      toolbarButtons,
      currentPanelButtons: toolbarButtons,
      toolbarButtonId: toolbarButtons.some((button) => button.id === selectedButtonId)
        ? selectedButtonId
        : ""
    };
  }

  return {
    toolbarButtons,
    currentPanelButtons: [
      selectedOwner,
      ...buttons.filter(
        (button) =>
          isToolSetChild(button) && button.ownerButtonId?.trim() === selectedOwnerId
      )
    ],
    toolbarButtonId: selectedOwner.id
  };
}
