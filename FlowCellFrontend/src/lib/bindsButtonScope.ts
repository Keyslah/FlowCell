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
  const topLevelButtons = buttons.filter((button) => !isToolSetChild(button));
  const selectedButton = buttons.find((button) => button.id === selectedButtonId) ?? null;
  const selectedOwnerId =
    selectedButton && (isToolSetOwner(selectedButton) || isToolSetChild(selectedButton))
      ? selectedButton.ownerButtonId?.trim() ?? ""
      : "";
  const selectedOwner = selectedOwnerId
    ? topLevelButtons.find(
        (button) => isToolSetOwner(button) && button.ownerButtonId?.trim() === selectedOwnerId
      ) ?? null
    : null;

  if (!selectedOwner) {
    return {
      toolbarButtons: topLevelButtons,
      currentPanelButtons: topLevelButtons,
      toolbarButtonId: topLevelButtons.some((button) => button.id === selectedButtonId)
        ? selectedButtonId
        : ""
    };
  }

  const selectedChildren = buttons.filter(
    (button) => isToolSetChild(button) && button.ownerButtonId?.trim() === selectedOwnerId
  );
  const toolbarButtons = topLevelButtons.flatMap((button) =>
    button.id === selectedOwner.id ? [button, ...selectedChildren] : [button]
  );

  return {
    toolbarButtons,
    currentPanelButtons: [selectedOwner, ...selectedChildren],
    toolbarButtonId: selectedButton?.id ?? selectedOwner.id
  };
}
