import { useEffect, useState } from "react";
import { createButtonSkinFromFile } from "../editor/buttonSkinFiles";
import { getButtonSkinDirectory, listButtonSkinFiles, loadButtonSkinFile } from "../state/ButtonStateRepository";
import type { ButtonSkin } from "../types";
import { buttonSkinFamilyVariantPath, nearestButtonSkinFamilyPath } from "./buttonSkinFamily";
import { validateButtonSkin } from "./skinValidator";

const pendingVariants = new Map<string, Promise<ButtonSkin | null>>();

async function readVariant(path: string): Promise<ButtonSkin | null> {
  try {
    const source = await loadButtonSkinFile(path);
    const skin = createButtonSkinFromFile(source, path, `skin-family-${path}`);
    return validateButtonSkin(skin).valid ? skin : null;
  } catch {
    return null;
  }
}

function loadFamilyVariant(relativePath: string): Promise<ButtonSkin | null> {
  const pending = pendingVariants.get(relativePath);
  if (pending) return pending;
  const request = (async () => {
    const directory = await getButtonSkinDirectory();
    const path = `${directory}/${relativePath}`;
    const exact = await readVariant(path);
    if (exact) return exact;
    const nearest = nearestButtonSkinFamilyPath(await listButtonSkinFiles(), path, directory);
    return nearest ? readVariant(nearest) : null;
  })().catch(() => null).finally(() => pendingVariants.delete(relativePath));
  pendingVariants.set(relativePath, request);
  return request;
}

export function useButtonSkinFamily(skin: ButtonSkin, placementId: string, label: string): ButtonSkin {
  const path = buttonSkinFamilyVariantPath(skin, placementId, label);
  const [variant, setVariant] = useState<{ path: string; skin: ButtonSkin } | null>(null);
  useEffect(() => {
    setVariant(null);
    if (!path) return;
    let active = true;
    void loadFamilyVariant(path).then((loadedSkin) => {
      if (active && loadedSkin) setVariant({ path, skin: loadedSkin });
    });
    return () => { active = false; };
  }, [path]);
  return variant && variant.path === path ? variant.skin : skin;
}
