import { invoke } from "@tauri-apps/api/core";

import { openBuildLayersWindow, openWindowGridWindow } from "../../lib/coreWindows";
import { showOpenFileDialog, showSaveFileDialog } from "../../lib/tauri";
import type { CoreActionExecutionTarget, JsonValue } from "../types";
import { registerButtonCoreAction, type ButtonCoreActionContext } from "./ButtonRuntimeAdapter";

interface SampledPhotoThemeColors {
  headersHex: string;
  textHex: string;
  sceneHex: string;
  controlsHex: string;
  miscHex: string;
  highlightsHex: string;
}

function payloadString(payload: Readonly<Record<string, JsonValue>> | undefined, key: string): string {
  const value = payload?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function fieldString(values: Readonly<Record<string, JsonValue>>, fieldId: string): string {
  const value = values[fieldId];
  return typeof value === "string" ? value.trim() : "";
}

function fileStem(path: string): string {
  const name = path.split(/[\\/]/).pop()?.trim() ?? "";
  return name.replace(/\.[^.]+$/, "").trim() || "Tool Fields";
}

export function registerLegacyProgramCoreActions(): () => void {
  const unregister = [
    registerButtonCoreAction("open-illustrator-layer-tree", async (target: CoreActionExecutionTarget) => {
      const programName = payloadString(target.payload, "programName");
      const panelName = payloadString(target.payload, "panelName");
      const fileName = payloadString(target.payload, "fileName");
      if (!programName || !panelName || !fileName) {
        throw new Error("The installed Layer Tree Button is missing its owned source identity.");
      }
      await openBuildLayersWindow({ programName, panelName, fileName, label: "Layer Tree" });
      return { opened: true };
    }),
    registerButtonCoreAction("open-window-grid", async () => {
      await openWindowGridWindow();
      return { opened: true };
    }),
    registerButtonCoreAction("sample-blender-theme-image", async (
      _target: CoreActionExecutionTarget,
      context: ButtonCoreActionContext
    ) => {
      const imagePath = fieldString(context.fieldValues, "theme_image_path");
      if (!imagePath) throw new Error("Choose a theme image first.");
      const sampled = await invoke<SampledPhotoThemeColors>("sample_photo_theme_colors", { imagePath });
      return {
        fieldPatch: {
          theme_image_path: imagePath,
          static_background_path: imagePath,
          tabs_hex: sampled.headersHex,
          tabs_text_hex: sampled.textHex,
          headers_hex: sampled.headersHex,
          header_text_hex: sampled.textHex,
          text_hex: sampled.textHex,
          control_text_hex: sampled.textHex,
          accent_text_hex: sampled.textHex,
          editor_background_hex: sampled.miscHex,
          scene_hex: sampled.sceneHex,
          controls_hex: sampled.controlsHex,
          highlights_hex: sampled.highlightsHex,
          viewport_background_hex: sampled.sceneHex,
          viewport_gradient_hex: sampled.miscHex
        }
      };
    }),
    registerButtonCoreAction("save-blender-theme-fields", async (
      _target: CoreActionExecutionTarget,
      context: ButtonCoreActionContext
    ) => {
      const suggestedName = `${fileStem(fieldString(context.fieldValues, "theme_image_path"))} Theme`;
      const selectedPath = await showSaveFileDialog({
        title: "Save Blender Theme Fields",
        filter: "JSON Files (*.json)|*.json|All Files (*.*)|*.*",
        defaultFileName: `${suggestedName}.json`
      });
      if (!selectedPath) return { cancelled: true };
      const savedPath = await invoke<string>("save_blender_theme_file", {
        suggestedName,
        path: selectedPath,
        values: context.fieldValues
      });
      return { savedPath };
    }),
    registerButtonCoreAction("load-blender-theme-fields", async () => {
      const selectedPaths = await showOpenFileDialog({
        title: "Load Blender Theme Fields",
        filter: "JSON Files (*.json)|*.json|All Files (*.*)|*.*",
        multiselect: false
      });
      const selectedPath = selectedPaths[0]?.trim();
      if (!selectedPath) return { cancelled: true };
      const fieldPatch = await invoke<Record<string, JsonValue>>("load_blender_theme_file", {
        path: selectedPath
      });
      return { fieldPatch };
    })
  ];
  return () => unregister.reverse().forEach((dispose) => dispose());
}
