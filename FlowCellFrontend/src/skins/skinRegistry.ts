import glassHtml from "./glass/skin.html?raw";
import "./glass/skin.css";

export type SkinDefinition = {
  id: string;
  html: string;
};

export const skinRegistry: Record<string, SkinDefinition> = {
  glass: {
    id: "glass",
    html: glassHtml
  }
};

export function getSkinDefinition(skinId: string) {
  return skinRegistry[skinId] ?? skinRegistry.glass;
}
