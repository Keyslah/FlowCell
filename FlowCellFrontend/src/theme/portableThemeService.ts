import { invoke } from "@tauri-apps/api/core";
import type { ButtonStateDocument } from "../button/types.js";
import { cloneButtonDocument, createStableButtonId } from "../button/state/buttonDefaults.js";
import {
  buttonStateDocumentsEqual, commitButtonStateDocument, installButtonSource, loadButtonStateDocument,
  mergeLegacyInstallsIntoDocument, uninstallButtonSource, type InstallButtonSourceResult
} from "../button/state/ButtonStateRepository.js";
import { ensureFanSetup, ensureRegularPopout } from "../button/state/buttonDocumentOperations.js";
import { reconcileProgramPanelOwners } from "../button/state/panelOwnerButtonOperations.js";
import {
  applyPortableTheme, planPortableThemeImport, portableThemeForScope, type PortableTheme,
  type PortableThemeDependency, type PortableThemeImportPlan, type ThemeToolDescriptor
} from "./portableTheme.js";
import type { ThemeTarget } from "./themeModel.js";

export function getThemeToolDescriptors(target: ThemeTarget): Promise<ThemeToolDescriptor[]> {
  if (target.kind === "flowcell") return Promise.resolve([]);
  return invoke<ThemeToolDescriptor[]>("get_theme_tool_descriptors", {
    programName: target.kind === "program" ? target.programName : null
  });
}

function installationCandidates(dependency: PortableThemeDependency, descriptors: readonly ThemeToolDescriptor[]): ThemeToolDescriptor[] {
  const seen = new Set<string>();
  return descriptors.filter((entry) => {
    const path = entry.sourcePath || entry.catalogPath;
    if (entry.ownerButtonId || !path || seen.has(path.toLowerCase()) ||
      entry.programId.toLowerCase() !== dependency.programId.toLowerCase() ||
      entry.sourceId !== dependency.sourceId || entry.sourceVersion !== dependency.sourceVersion ||
      entry.importKind !== dependency.importKind || !dependency.slots.every((slot) => entry.slots.includes(slot))) return false;
    seen.add(path.toLowerCase());
    return true;
  });
}

export async function previewPortableThemeImport(theme: PortableTheme, target: ThemeTarget, extraDescriptors: readonly ThemeToolDescriptor[] = []): Promise<{
  document: ButtonStateDocument; descriptors: ThemeToolDescriptor[]; plan: PortableThemeImportPlan;
}> {
  const [document, installed] = await Promise.all([loadButtonStateDocument(), getThemeToolDescriptors(target)]);
  const descriptors = [...installed, ...extraDescriptors];
  let plan = planPortableThemeImport(document, theme, target, descriptors);
  if (plan.missingDependencies.length === 0) {
    const preview = cloneButtonDocument(document);
    prepareThemeSurfaces(preview, theme, plan);
    plan = planPortableThemeImport(preview, theme, target, descriptors);
  }
  const available = new Set<string>();
  for (const dependency of plan.missingDependencies) {
    const candidates = installationCandidates(dependency, descriptors);
    if (candidates.length !== 1) plan.issues.push(
      `${dependency.sourceName} (${dependency.sourceVersion}) has ${candidates.length} compatible installation sources.`
    );
    else available.add(dependency.id);
  }
  if (available.size === plan.missingDependencies.length && available.size > 0) {
    plan.issues = plan.issues.filter((issue) => !issue.startsWith("Arrangement '") && !issue.includes("has 0 compatible identities."));
  }
  return { document, descriptors, plan };
}

/** Create only missing canonical arrangements, through the same Button operations used by Pop/Fan. */
function prepareThemeSurfaces(document: ButtonStateDocument, theme: PortableTheme, plan: PortableThemeImportPlan): void {
  theme = portableThemeForScope(theme, plan.selectedTarget);
  for (const appearance of theme.theme.buttons) {
    const reference = theme.references[appearance.buttonId];
    if (reference.kind !== "panel" || appearance.surfaceKind !== "main" || plan.buttonIds[appearance.buttonId]) continue;
    const saved = theme.presentation[appearance.placementId].placement;
    const result = reconcileProgramPanelOwners(document, { programName: reference.programName, removeStaleOwners: false,
      panels: [{ panelName: reference.panelName, rect: { x: saved.x, y: saved.y, width: saved.width, height: saved.height } }] });
    const owner = Object.values(document.buttons).find((button) => button.role === "panel-owner" &&
      button.metadata.programName === reference.programName && button.metadata.panelName === reference.panelName);
    if (owner && result.surfaceId) plan.buttonIds[appearance.buttonId] = owner.id;
  }
  for (const surface of theme.surfaces) {
    if (plan.surfaceIds[surface.id]) continue;
    const appearances = theme.theme.buttons.filter((appearance) => appearance.surfaceId === surface.id);
    const buttons = [...new Set(appearances.map((appearance) => plan.buttonIds[appearance.buttonId]))]
      .flatMap((id) => id && document.buttons[id] ? [document.buttons[id]] : []);
    if (surface.kind === "regular-popout" && buttons.length === appearances.length) {
      ensureRegularPopout(document, buttons);
    } else if (surface.kind === "fan" && surface.ownerButtonId) {
      const owner = theme.references[surface.ownerButtonId];
      if (owner?.kind === "panel") ensureFanSetup({
        document, programName: owner.programName, panelName: owner.panelName,
        buttons: [
          ...buttons.filter((button) => button.role !== "panel-owner"),
          ...(surface.fan?.selectedToolSetOwnerButtonIds ?? []).flatMap((id) =>
            document.buttons[plan.buttonIds[id]] ? [document.buttons[plan.buttonIds[id]]] : [])
        ]
      });
    }
  }
}

export interface PreparedPortableThemeImport {
  document: ButtonStateDocument;
  plan: PortableThemeImportPlan;
  commit(): Promise<ButtonStateDocument>;
  rollback(): Promise<void>;
}

/**
 * Called only after the user applies a preview. Source files remain in the normal
 * Button installer. All presentation is committed in one revision-checked save.
 */
export async function preparePortableThemeImport(args: {
  theme: PortableTheme; target: ThemeTarget; document?: ButtonStateDocument;
  descriptors?: readonly ThemeToolDescriptor[]; extraDescriptors?: readonly ThemeToolDescriptor[];
}): Promise<PreparedPortableThemeImport> {
  const original = args.document ?? await loadButtonStateDocument();
  let descriptors = [...(args.descriptors ?? await getThemeToolDescriptors(args.target)), ...(args.extraDescriptors ?? [])];
  let candidate = cloneButtonDocument(original);
  let plan = planPortableThemeImport(candidate, args.theme, args.target, descriptors);
  // Missing arrangements may be created after dependency installation; identity/version errors may not.
  const blocking = plan.issues.filter((issue) => !issue.startsWith("Arrangement '") && !issue.includes("has 0 compatible identities."));
  if (blocking.length) throw new Error(blocking.join("\n"));
  const sources = plan.missingDependencies.map((dependency) => {
    const matches = installationCandidates(dependency, descriptors);
    if (matches.length !== 1) throw new Error(`${dependency.sourceName} (${dependency.sourceVersion}) has ${matches.length} compatible installation sources.`);
    return { dependency, source: matches[0] };
  });
  const staged: InstallButtonSourceResult[] = [];
  let committed = false;
  const rollback = async () => {
    if (committed) return;
    const failures: string[] = [];
    const latest = await loadButtonStateDocument();
    for (const installed of [...staged].reverse()) {
      // A post-commit cleanup failure must never uninstall a successfully committed owner.
      if (latest.buttons[installed.ownerButtonId]) continue;
      try { await uninstallButtonSource(installed); }
      catch (error) { failures.push(`${installed.label}: ${String(error)}`); }
    }
    if (failures.length) throw new Error(`Theme source recovery remains pending: ${failures.join("; ")}`);
  };
  try {
    for (const { dependency, source } of sources) {
      const installed = await installButtonSource({
        ownerButtonId: createStableButtonId("button"), programName: source.programName,
        panelName: dependency.panelName, sourcePath: source.sourcePath || source.catalogPath!, importKind: dependency.importKind
      });
      staged.push(installed);
      candidate = mergeLegacyInstallsIntoDocument(candidate, [installed]);
      descriptors.push({ ...source, ownerButtonId: installed.ownerButtonId, panelName: installed.sourceIdentity.displayPanelName });
    }
    if (staged.length > 0) descriptors = [...await getThemeToolDescriptors(args.target), ...(args.extraDescriptors ?? [])];
    plan = planPortableThemeImport(candidate, args.theme, args.target, descriptors);
    prepareThemeSurfaces(candidate, args.theme, plan);
    plan = planPortableThemeImport(candidate, args.theme, args.target, descriptors);
    const next = applyPortableTheme(candidate, args.theme, plan);
    return { document: next, plan, rollback,
      commit: async () => {
        try {
          if (buttonStateDocumentsEqual(next, original)) {
            const latest = await loadButtonStateDocument();
            if (latest.revision !== original.revision) throw new Error("Theme preview is stale. Preview again before applying.");
            committed = true;
            return latest;
          }
          const saved = await commitButtonStateDocument(next, original.revision);
          committed = true;
          return saved;
        } catch (error) {
          const latest = await loadButtonStateDocument();
          const expected = { ...next, revision: original.revision + 1 };
          if (JSON.stringify(latest) === JSON.stringify(expected)) {
            committed = true;
            return latest;
          }
          await rollback();
          throw error;
        }
      }
    };
  } catch (error) {
    try { await rollback(); }
    catch (recoveryError) { throw new Error(`${String(error)}\n${String(recoveryError)}`); }
    throw error;
  }
}
