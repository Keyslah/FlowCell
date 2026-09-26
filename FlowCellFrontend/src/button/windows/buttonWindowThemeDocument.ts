import type { ButtonStateDocument } from "../types.js";
import { placementMatchesThemeTarget } from "../../theme/themeModel.js";

/** Program popout rules are canonical even while a Button editor owns its layout draft. */
export function withCanonicalProgramPopoutThemes(
  draft: ButtonStateDocument,
  canonical: ButtonStateDocument | null
): ButtonStateDocument {
  if (!canonical || (draft.programPopoutThemes === canonical.programPopoutThemes &&
    draft.programPopoutColorOverrides === canonical.programPopoutColorOverrides &&
    draft.programPopoutColorOverrideRevisions === canonical.programPopoutColorOverrideRevisions)) return draft;
  let overrides = canonical.programPopoutColorOverrides;
  const revisions = draft.programPopoutColorOverrideRevisions
    ? { ...draft.programPopoutColorOverrideRevisions, ...canonical.programPopoutColorOverrideRevisions }
    : canonical.programPopoutColorOverrideRevisions;
  const programNames = Object.keys(draft.programPopoutColorOverrideRevisions ?? {});
  for (const [id, override] of Object.entries(draft.programPopoutColorOverrides ?? {})) {
    // Canonical placements use canonical presence or absence, so Reset cannot
    // resurrect an older exception. Only transient placements remain draft-owned.
    if (canonical.placements[id]) continue;
    const placement = draft.placements[id];
    if (!placement) continue;
    const programName = programNames.find((name) => placementMatchesThemeTarget(draft, placement, {
      kind: "program", programName: name, panelName: null
    }));
    if (!programName) continue;
    for (const channel of ["surface", "text"] as const) {
      const color = override[channel];
      if (!color || canonical.programPopoutColorOverrides?.[id]?.[channel] !== undefined) continue;
      const draftRevision = draft.programPopoutColorOverrideRevisions?.[programName]?.[channel] ?? 0;
      const canonicalRevision = canonical.programPopoutColorOverrideRevisions?.[programName]?.[channel] ?? 0;
      if (draftRevision !== canonicalRevision) continue;
      overrides = { ...overrides, [id]: { ...overrides?.[id], [channel]: color } };
    }
  }
  return {
    ...draft,
    programPopoutThemes: canonical.programPopoutThemes,
    programPopoutColorOverrides: overrides,
    programPopoutColorOverrideRevisions: revisions
  };
}
