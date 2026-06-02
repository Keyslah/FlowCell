import type { ButtonRecord } from "../pages/main/mainLayout";
import { getSkinDefinition } from "../skins/skinRegistry";

type SkinRendererProps = {
  button: ButtonRecord;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function SkinRenderer({ button }: SkinRendererProps) {
  const skin = getSkinDefinition(button.skinId);
  const markup = skin.html.replaceAll("{{label}}", escapeHtml(button.label));

  return (
    <div
      className="skin-renderer"
      data-skin-id={skin.id}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
