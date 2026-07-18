import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ButtonHost } from "../ButtonHost";
import {
  executeButtonRecord,
  type ButtonExecutionResult
} from "../runtime/ButtonRuntimeAdapter";
import type {
  ButtonPlacement,
  ButtonRecord,
  ButtonSkin,
  JsonObject,
  JsonValue
} from "../types";
import {
  buildRefilledThemeRolePatch,
  buildThemeToneProfile,
  buildThemeTonePatch,
  DEFAULT_THEME_WORKBENCH_PALETTE,
  normalizeThemeHex,
  normalizeLegacyThemeToneState,
  normalizeThemePalette,
  normalizeThemeToneProfiles,
  type ThemeToneProfile
} from "./themeTone";
import type {
  ThemeWorkbenchColorRoleConfig,
  ThemeWorkbenchNumberFieldConfig,
  ThemeWorkbenchProps,
  ThemeWorkbenchToneMode
} from "./themeWorkbenchTypes";
import {
  normalizeLegacyThemeWorkbenchStoredFields,
  resolveThemeWorkbenchLegacyStorageKey,
  normalizeThemeWorkbenchStoredFieldMigrations,
  normalizeThemeWorkbenchStoredFields
} from "./themeWorkbenchTypes";
import "./themeWorkbench.css";

interface ResolvedChildAction {
  slot: string;
  button: ButtonRecord;
  placement: ButtonPlacement;
  skin: ButtonSkin;
}

function jsonString(value: JsonValue | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function jsonNumber(value: JsonValue | undefined, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function jsonBoolean(value: JsonValue | undefined, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function childSlot(button: ButtonRecord): string | null {
  const value = button.metadata.toolSetSlot;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function configuredActionSlots(presentation: ThemeWorkbenchProps["presentation"]): string[] {
  const { actions, environment } = presentation;
  return Array.from(new Set([
    ...Object.values(actions.theme),
    ...Object.values(actions.picture),
    ...Object.values(actions.environment),
    ...environment.valueFields.map((field) => field.actionSlot),
    presentation.theme.browseCompletion?.postActionSlot,
    presentation.theme.refill?.applyActionSlot,
    presentation.tone?.legacyProfiles?.actionSlot,
    ...presentation.theme.roles.map((role) => role.apply?.actionSlot),
    ...(presentation.theme.packageCompletion?.postActions.map((action) => action.actionSlot) ?? [])
  ].filter((slot): slot is string => typeof slot === "string" && slot.length > 0)));
}

function paletteForValues(
  presentation: ThemeWorkbenchProps["presentation"],
  values: Readonly<Record<string, JsonValue>>
): string[] {
  const configuredPalette = presentation.theme.paletteFieldId
    ? normalizeThemePalette(values[presentation.theme.paletteFieldId])
    : [];
  if (configuredPalette.length > 0) return configuredPalette;
  const rolePalette = presentation.theme.roles
    .map((role) => normalizeThemeHex(values[role.fieldId]))
    .filter((hex): hex is string => Boolean(hex));
  const uniqueRolePalette = Array.from(new Set(rolePalette));
  return uniqueRolePalette.length > 0
    ? uniqueRolePalette
    : [...DEFAULT_THEME_WORKBENCH_PALETTE];
}

interface StoredToneState {
  level: number;
  activeProfileId: string;
  profiles: ThemeToneProfile[];
  completedMigrationIds: string[];
}

function readStoredToneState(
  key: string,
  defaultLevel: number,
  roles: readonly ThemeWorkbenchColorRoleConfig[]
): StoredToneState {
  const fallback = {
    level: Math.max(0, Math.min(1, defaultLevel)),
    activeProfileId: "",
    profiles: [],
    completedMigrationIds: []
  };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Record<string, unknown>;
    const level = typeof value.level === "number" && Number.isFinite(value.level)
      ? Math.max(0, Math.min(1, value.level))
      : fallback.level;
    const profiles = normalizeThemeToneProfiles(value.profiles, roles);
    const requestedActiveProfileId = typeof value.activeProfileId === "string"
      ? value.activeProfileId
      : "";
    return {
      level,
      activeProfileId: profiles.some((profile) => profile.id === requestedActiveProfileId)
        ? requestedActiveProfileId
        : "",
      profiles,
      completedMigrationIds: Array.isArray(value.completedMigrationIds)
        ? Array.from(new Set(value.completedMigrationIds.filter((entry): entry is string =>
          typeof entry === "string" && Boolean(entry.trim()))))
        : []
    };
  } catch {
    return fallback;
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function groupColorRoles(roles: readonly ThemeWorkbenchColorRoleConfig[]) {
  const groups = new Map<string, ThemeWorkbenchColorRoleConfig[]>();
  for (const role of roles) {
    const key = role.group?.trim() || "theme";
    const group = groups.get(key) ?? [];
    group.push(role);
    groups.set(key, group);
  }
  return Array.from(groups.entries());
}

export function ThemeWorkbench({
  document,
  unit,
  presentation,
  fieldValues,
  onFieldPatch,
  onFieldActivate,
  onExecutionResult,
  onPlacementMeasurement,
  onPlacementVisualMeasurement,
  onPreparePlacementVisualStateChange,
  onPlacementVisualStateChange,
  resolveImageSource,
  className
}: ThemeWorkbenchProps) {
  const toneStorageKey = `flowcell.theme-workbench.${unit.id}.${
    presentation.tone?.storageKey?.trim() || "tone-v1"
  }`;
  const fieldPersistenceKey = presentation.fieldPersistence
    ? `flowcell.theme-workbench.${unit.id}.${presentation.fieldPersistence.storageKey.trim()}`
    : null;
  const declaredFieldIds = useMemo(
    () => unit.fields.map((field) => field.id),
    [unit.fields]
  );
  const hydratedFieldStorageKeyRef = useRef<string | null>(null);
  const completedFieldMigrationIdsRef = useRef<Set<string>>(new Set());
  const fieldDefinitionRef = useRef(unit.fields);
  const pendingFieldRestoreRef = useRef<{
    values: Record<string, JsonValue>;
    issuedFrom: Readonly<Record<string, JsonValue>>;
  } | null>(null);
  const attemptedToneMigrationIdRef = useRef<string | null>(null);
  if (fieldDefinitionRef.current !== unit.fields) {
    fieldDefinitionRef.current = unit.fields;
    hydratedFieldStorageKeyRef.current = null;
    completedFieldMigrationIdsRef.current = new Set();
    pendingFieldRestoreRef.current = null;
  }
  const [toneState, setToneState] = useState(() =>
    readStoredToneState(
      toneStorageKey,
      presentation.tone?.defaultLevel ?? 0.3,
      presentation.theme.roles
    )
  );
  const [profileName, setProfileName] = useState("");
  const [refillVariant, setRefillVariant] = useState(0);
  const [pendingAutomationSlot, setPendingAutomationSlot] = useState<string | null>(null);
  const [automationStatus, setAutomationStatus] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(toneStorageKey, JSON.stringify(toneState));
    } catch {
      // Storage can be unavailable in private or restricted webviews. The page
      // remains functional for the current session.
    }
  }, [toneState, toneStorageKey]);

  useEffect(() => {
    if (!fieldPersistenceKey || hydratedFieldStorageKeyRef.current === fieldPersistenceKey) return;
    pendingFieldRestoreRef.current = null;
    let restored: Record<string, JsonValue> = {};
    let storedDocument: unknown = null;
    try {
      const raw = window.localStorage.getItem(fieldPersistenceKey);
      storedDocument = raw ? JSON.parse(raw) : null;
    } catch {
      storedDocument = null;
    }
    restored = normalizeThemeWorkbenchStoredFields(storedDocument, declaredFieldIds);
    completedFieldMigrationIdsRef.current = new Set(
      normalizeThemeWorkbenchStoredFieldMigrations(storedDocument)
    );
    const ownerIdentity = document.buttons[unit.ownerButtonId]?.sourceIdentity ?? null;
    const storageIdentity = ownerIdentity ? {
      programName: ownerIdentity.displayProgramName,
      panelName: ownerIdentity.displayPanelName,
      fileName: ownerIdentity.displayFileName
    } : null;
    for (const legacy of presentation.fieldPersistence?.legacy ?? []) {
      if (completedFieldMigrationIdsRef.current.has(legacy.migrationId)) continue;
      for (const template of legacy.storageKeys) {
        const legacyKey = resolveThemeWorkbenchLegacyStorageKey(template, storageIdentity);
        if (!legacyKey) continue;
        try {
          const legacyRaw = window.localStorage.getItem(legacyKey);
          if (!legacyRaw) continue;
          const migrated = normalizeLegacyThemeWorkbenchStoredFields(
            JSON.parse(legacyRaw),
            declaredFieldIds,
            legacy.fieldMap,
            legacy.fieldTransforms
          );
          restored = { ...migrated, ...restored };
          completedFieldMigrationIdsRef.current.add(legacy.migrationId);
          break;
        } catch {
          // One malformed legacy entry must not discard current owner state or
          // prevent a later declared alias from being tried.
        }
      }
    }
    hydratedFieldStorageKeyRef.current = fieldPersistenceKey;
    if (Object.keys(restored).length > 0) {
      pendingFieldRestoreRef.current = { values: restored, issuedFrom: fieldValues };
      onFieldPatch(restored, { ...fieldValues, ...restored });
    }
  }, [
    declaredFieldIds,
    document.buttons,
    fieldPersistenceKey,
    fieldValues,
    onFieldPatch,
    presentation.fieldPersistence,
    unit.ownerButtonId
  ]);

  useEffect(() => {
    if (!fieldPersistenceKey || hydratedFieldStorageKeyRef.current !== fieldPersistenceKey) return;
    const pendingRestore = pendingFieldRestoreRef.current;
    if (pendingRestore) {
      if (fieldValues === pendingRestore.issuedFrom) return;
      const restoredValuesAreVisible = Object.entries(pendingRestore.values).every(([fieldId, value]) =>
        JSON.stringify(fieldValues[fieldId]) === JSON.stringify(value));
      if (!restoredValuesAreVisible) {
        pendingRestore.issuedFrom = fieldValues;
        onFieldPatch(pendingRestore.values, { ...fieldValues, ...pendingRestore.values });
        return;
      }
      pendingFieldRestoreRef.current = null;
    }
    const values: Record<string, JsonValue> = {};
    for (const fieldId of declaredFieldIds) {
      const value = fieldValues[fieldId];
      if (value !== undefined) values[fieldId] = value;
    }
    try {
      window.localStorage.setItem(fieldPersistenceKey, JSON.stringify({
        schemaVersion: 1,
        values,
        completedMigrationIds: Array.from(completedFieldMigrationIdsRef.current).sort()
      }));
    } catch {
      // Keep the page live when webview storage is unavailable.
    }
  }, [declaredFieldIds, fieldPersistenceKey, fieldValues, onFieldPatch]);

  const actionsBySlot = useMemo(() => {
    const placementsByButtonId = new Map<string, ButtonPlacement>();
    for (const placementId of unit.childPlacementIds) {
      const placement = document.placements[placementId];
      if (placement) placementsByButtonId.set(placement.buttonId, placement);
    }

    const result = new Map<string, ResolvedChildAction>();
    for (const buttonId of unit.childButtonIds) {
      const button = document.buttons[buttonId];
      if (!button) continue;
      const slot = childSlot(button);
      if (!slot || result.has(slot)) continue;
      const placement = placementsByButtonId.get(button.id) ?? Object.values(document.placements)
        .find((candidate) => candidate.buttonId === button.id);
      if (!placement) continue;
      const skin = document.skins[placement.skinOverrideId ?? button.defaultSkinId];
      if (!skin) continue;
      result.set(slot, { slot, button, placement, skin });
    }
    return result;
  }, [document, unit.childButtonIds, unit.childPlacementIds]);

  const palette = useMemo(
    () => paletteForValues(presentation, fieldValues),
    [fieldValues, presentation]
  );

  const patchFields = useCallback((
    patch: Readonly<Record<string, JsonValue>>,
    baseValues: Readonly<Record<string, JsonValue>> = fieldValues
  ) => {
    const nextValues = { ...baseValues, ...patch };
    onFieldPatch(patch, nextValues);
    return nextValues;
  }, [fieldValues, onFieldPatch]);

  const stageTone = useCallback((
    options: {
      mode?: ThemeWorkbenchToneMode;
      level?: number;
      targetLuminanceByRoleId?: Readonly<Record<string, number>>;
    },
    baseValues: Readonly<Record<string, JsonValue>> = fieldValues
  ) => {
    const patch = buildThemeTonePatch({
      palette: paletteForValues(presentation, baseValues),
      roles: presentation.theme.roles,
      visualModeFieldId: presentation.theme.visualModeFieldId,
      ...options
    });
    return patchFields(patch, baseValues);
  }, [fieldValues, patchFields, presentation]);

  const executeConfiguredAction = useCallback(async (
    slot: string,
    values: Readonly<Record<string, JsonValue>>,
    payloadOverride?: Readonly<JsonObject>
  ): Promise<ButtonExecutionResult> => {
    const action = actionsBySlot.get(slot);
    if (!action) throw new Error(`Missing configured child Button slot '${slot}'.`);
    setPendingAutomationSlot(slot);
    try {
      const result = await executeButtonRecord(action.button, "click", {
        fields: unit.fields,
        fieldValues: values,
        payloadOverride,
        onFieldActivate,
        onFieldPatch
      });
      onExecutionResult?.(action.slot, action.button, result);
      return result;
    } finally {
      setPendingAutomationSlot(null);
    }
  }, [actionsBySlot, onExecutionResult, onFieldActivate, onFieldPatch, unit.fields]);

  useEffect(() => {
    const legacy = presentation.tone?.legacyProfiles;
    if (!legacy || toneState.completedMigrationIds.includes(legacy.migrationId) ||
      attemptedToneMigrationIdRef.current === legacy.migrationId) {
      return;
    }
    attemptedToneMigrationIdRef.current = legacy.migrationId;
    let cancelled = false;
    void executeConfiguredAction(legacy.actionSlot, fieldValues)
      .then((result) => {
        if (cancelled) return;
        const response = objectRecord(result.response);
        const loadedState = response?.legacyState ?? null;
        let storedLevel = legacy.level;
        let hasLegacyLocalScalar = false;
        const local = legacy.localStorage;
        if (local?.levelKey) {
          const rawLevel = window.localStorage.getItem(local.levelKey);
          const parsed = rawLevel === null ? Number.NaN : Number(rawLevel);
          if (Number.isFinite(parsed)) {
            storedLevel = Math.max(0, Math.min(1, parsed));
            hasLegacyLocalScalar = true;
          }
        }
        const fromFile = normalizeLegacyThemeToneState({
          value: loadedState,
          format: legacy.format,
          roleMap: legacy.roleMap,
          roles: presentation.theme.roles,
          mode: legacy.mode,
          level: storedLevel
        });
        let fromLocal = { activeProfileId: "", profiles: [] as ThemeToneProfile[] };
        const activeProfileId = local?.activeProfileIdKey
          ? window.localStorage.getItem(local.activeProfileIdKey) ?? ""
          : "";
        if (activeProfileId.trim()) hasLegacyLocalScalar = true;
        if (local?.profilesKey) {
          const rawProfiles = window.localStorage.getItem(local.profilesKey);
          if (rawProfiles) {
            try {
              fromLocal = normalizeLegacyThemeToneState({
                value: {
                  format: legacy.format,
                  profiles: JSON.parse(rawProfiles),
                  activeProfileId
                },
                format: legacy.format,
                roleMap: legacy.roleMap,
                roles: presentation.theme.roles,
                mode: legacy.mode,
                level: storedLevel
              });
            } catch {
              // A malformed local fallback must not suppress a valid file import.
            }
          }
        }
        const importedProfiles = Array.from(new Map([
          ...fromLocal.profiles,
          ...fromFile.profiles
        ].map((profile) => [profile.id, profile])).values());
        if (loadedState === null && importedProfiles.length === 0 && !hasLegacyLocalScalar) return;
        setToneState((current) => {
          const profiles = Array.from(new Map([
            ...importedProfiles,
            ...current.profiles
          ].map((profile) => [profile.id, profile])).values())
            .sort((left, right) => left.name.localeCompare(right.name));
          const importedActiveId = fromFile.activeProfileId || fromLocal.activeProfileId;
          const activeProfileId = profiles.some((profile) => profile.id === current.activeProfileId)
            ? current.activeProfileId
            : profiles.some((profile) => profile.id === importedActiveId)
              ? importedActiveId
              : "";
          return {
            ...current,
            level: typeof storedLevel === "number" ? storedLevel : current.level,
            activeProfileId,
            profiles,
            completedMigrationIds: Array.from(new Set([
              ...current.completedMigrationIds,
              legacy.migrationId
            ]))
          };
        });
        setAutomationStatus(importedProfiles.length > 0
          ? `Imported ${importedProfiles.length} legacy darkness profile${importedProfiles.length === 1 ? "" : "s"}.`
          : "Legacy darkness profile migration completed.");
      })
      .catch((error) => {
        if (attemptedToneMigrationIdRef.current === legacy.migrationId) {
          attemptedToneMigrationIdRef.current = null;
        }
        if (!cancelled) setAutomationStatus(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [executeConfiguredAction, fieldValues, presentation, toneState.completedMigrationIds]);

  const handleExecutionResult = useCallback(async (
    action: ResolvedChildAction,
    result: ButtonExecutionResult
  ) => {
    onExecutionResult?.(action.slot, action.button, result);
    if (action.slot === presentation.actions.theme.darkMode) {
      stageTone({ mode: "dark" }, result.fieldValues);
      setToneState((current) => ({ ...current, level: 0, activeProfileId: "" }));
    } else if (action.slot === presentation.actions.theme.lightMode) {
      stageTone({ mode: "light" }, result.fieldValues);
      setToneState((current) => ({ ...current, level: 1, activeProfileId: "" }));
    } else if (action.slot === presentation.actions.theme.browseImage && result.executed) {
      const completion = presentation.theme.browseCompletion;
      let nextValues = result.fieldValues;
      if (completion?.toneMode) {
        nextValues = stageTone({ mode: completion.toneMode }, nextValues);
        setToneState((current) => ({
          ...current,
          level: completion.toneMode === "light" ? 1 : 0,
          activeProfileId: ""
        }));
      }
      if (completion?.postActionSlot) {
        try {
          const chainedResult = await executeConfiguredAction(completion.postActionSlot, nextValues);
          setAutomationStatus(chainedResult.executed
            ? "Sampled palette staged and configured follow-up action completed."
            : "Sampled palette staged; configured follow-up action did not run.");
        } catch (error) {
          setAutomationStatus(error instanceof Error ? error.message : String(error));
        }
      }
    } else if (
      result.executed &&
      [
        presentation.actions.theme.openPackage,
        presentation.actions.theme.previousPackage,
        presentation.actions.theme.nextPackage
      ].includes(action.slot) &&
      !(result.response && typeof result.response === "object" &&
        "cancelled" in result.response && result.response.cancelled === true)
    ) {
      try {
        let nextValues = result.fieldValues;
        for (const configured of presentation.theme.packageCompletion?.postActions ?? []) {
          if (configured.whenFieldNonEmpty &&
            !jsonString(nextValues[configured.whenFieldNonEmpty]).trim()) {
            continue;
          }
          const chainedResult = await executeConfiguredAction(configured.actionSlot, nextValues);
          nextValues = chainedResult.fieldValues;
        }
        setAutomationStatus("Package loaded and configured follow-up actions completed.");
      } catch (error) {
        setAutomationStatus(error instanceof Error ? error.message : String(error));
      }
    }
  }, [executeConfiguredAction, onExecutionResult, presentation, stageTone]);

  const renderAction = (slot: string | undefined): ReactNode => {
    if (!slot) return null;
    const action = actionsBySlot.get(slot);
    if (!action) return null;
    return (
      <span
        className="theme-workbench__canonical-action"
        data-theme-workbench-slot={slot}
        style={{ width: action.placement.width, height: action.placement.height }}
      >
        <ButtonHost
          button={action.button}
          placement={action.placement}
          skin={action.skin}
          mode="run"
          constrained
          fields={unit.fields}
          fieldValues={fieldValues}
          onFieldPatch={onFieldPatch}
          onFieldActivate={onFieldActivate}
          onExecutionResult={(result) => void handleExecutionResult(action, result)}
          onMeasurement={(measurement) => onPlacementMeasurement?.(action.placement.id, measurement)}
          onVisualMeasurement={(measurement) => onPlacementVisualMeasurement?.(action.placement.id, measurement)}
          onPrepareVisualStateChange={(state) =>
            onPreparePlacementVisualStateChange?.(action.placement.id, state)}
          onVisualStateChange={(state) => onPlacementVisualStateChange?.(action.placement.id, state)}
        />
      </span>
    );
  };

  const patchString = (fieldId: string, value: string) => patchFields({ [fieldId]: value });
  const patchRoleColor = (role: ThemeWorkbenchColorRoleConfig, value: string) => {
    const patch: Record<string, JsonValue> = { [role.fieldId]: value };
    for (const mirrorFieldId of role.mirrorFieldIds ?? []) {
      patch[mirrorFieldId] = value;
    }
    patchFields(patch);
  };
  const patchNumber = (fieldId: string, value: string) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) patchFields({ [fieldId]: parsed });
  };

  const handleRefill = async () => {
    const refill = presentation.theme.refill;
    if (!refill || pendingAutomationSlot) return;
    const nextVariant = refillVariant + 1;
    setRefillVariant(nextVariant);
    const rawMode = jsonString(fieldValues[presentation.theme.visualModeFieldId], "dark");
    const mode: ThemeWorkbenchToneMode = rawMode === "light" ? "light" : "dark";
    const patch = buildRefilledThemeRolePatch({
      palette: paletteForValues(presentation, fieldValues),
      roles: presentation.theme.roles,
      visualModeFieldId: presentation.theme.visualModeFieldId,
      mode,
      level: toneState.level,
      variant: nextVariant
    });
    const nextValues = patchFields(patch);
    setToneState((current) => ({ ...current, activeProfileId: "" }));
    try {
      const result = await executeConfiguredAction(refill.applyActionSlot, nextValues);
      setAutomationStatus(result.executed
        ? "Palette roles refilled and configured apply action completed."
        : "Palette roles refilled; configured apply action did not run.");
    } catch (error) {
      setAutomationStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveToneProfile = () => {
    const rawMode = jsonString(fieldValues[presentation.theme.visualModeFieldId], "dark");
    const profile = buildThemeToneProfile({
      name: profileName,
      level: toneState.level,
      mode: rawMode === "light" ? "light" : "dark",
      roles: presentation.theme.roles,
      fieldValues
    });
    if (!profile) {
      setAutomationStatus("Enter a darkness profile name.");
      return;
    }
    setToneState((current) => ({
      ...current,
      activeProfileId: profile.id,
      profiles: [...current.profiles.filter((candidate) => candidate.id !== profile.id), profile]
        .sort((left, right) => left.name.localeCompare(right.name))
    }));
    setProfileName("");
    setAutomationStatus(`Saved darkness profile '${profile.name}'.`);
  };

  const handleToneProfileSelect = (profileId: string) => {
    if (!profileId) {
      setToneState((current) => ({ ...current, activeProfileId: "" }));
      return;
    }
    const profile = toneState.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;
    setToneState((current) => ({
      ...current,
      level: profile.level,
      activeProfileId: profile.id
    }));
    stageTone({
      mode: profile.mode,
      level: profile.level,
      targetLuminanceByRoleId: profile.targetLuminanceByRoleId
    });
    setAutomationStatus(`Loaded darkness profile '${profile.name}'. Press Apply to send it.`);
  };

  const handleToneLevelChange = (level: number) => {
    const boundedLevel = Math.max(0, Math.min(1, level));
    setToneState((current) => ({ ...current, level: boundedLevel, activeProfileId: "" }));
  };

  const handleToneLevelCommit = (level: number) => {
    const boundedLevel = Math.max(0, Math.min(1, level));
    handleToneLevelChange(boundedLevel);
    stageTone({ level: boundedLevel });
    setAutomationStatus(null);
  };

  const renderNumberField = (
    field: ThemeWorkbenchNumberFieldConfig,
    prefix: string
  ) => (
    <div className="theme-workbench__number-pair" key={`${prefix}:${field.fieldId}`}>
      {field.actionSlot ? renderAction(field.actionSlot) : <span>{field.label}</span>}
      <label
        className="theme-workbench__field theme-workbench__field--number"
        data-button-tool-field-id={field.fieldId}
      >
        <span>{field.actionSlot ? field.label : "Value"}</span>
        <input
          type="number"
          value={jsonNumber(fieldValues[field.fieldId])}
          min={field.minimum}
          max={field.maximum}
          step={field.step ?? "any"}
          onChange={(event) => patchNumber(field.fieldId, event.target.value)}
        />
      </label>
    </div>
  );

  const themePath = jsonString(fieldValues[presentation.theme.imagePathFieldId]);
  const imageSource = themePath && resolveImageSource ? resolveImageSource(themePath) : null;
  const roleGroups = groupColorRoles(presentation.theme.roles);
  const missingSlots = configuredActionSlots(presentation)
    .filter((slot) => !actionsBySlot.has(slot));
  const visualMode = jsonString(fieldValues[presentation.theme.visualModeFieldId], "dark");
  const rootClassName = ["theme-workbench", className].filter(Boolean).join(" ");

  return (
    <div className={rootClassName} data-theme-workbench-kind={presentation.kind}>
      <header className="theme-workbench__header">
        <div>
          <span className="theme-workbench__eyebrow">Theme workbench</span>
          <h1>{presentation.title}</h1>
        </div>
        {presentation.subtitle ? <span className="theme-workbench__subtitle">{presentation.subtitle}</span> : null}
      </header>

      <section className="theme-workbench__section theme-workbench__section--theme">
        <div className="theme-workbench__section-heading">
          <h2>{presentation.theme.title ?? "Theme and palette"}</h2>
          <div className="theme-workbench__palette" aria-label="Sampled palette">
            {palette.map((hex) => (
              <span key={hex} title={hex} style={{ backgroundColor: hex }} />
            ))}
          </div>
        </div>

        <div className="theme-workbench__image-row">
          <div className="theme-workbench__image-preview" data-has-image={imageSource ? "true" : "false"}>
            {imageSource ? <img src={imageSource} alt="Theme reference" /> : <span>Palette source</span>}
          </div>
          <label
            className="theme-workbench__field theme-workbench__field--path"
            data-button-tool-field-id={presentation.theme.imagePathFieldId}
          >
            <span>{presentation.theme.imagePathLabel ?? "Reference image"}</span>
            <input
              type="text"
              value={themePath}
              placeholder={presentation.theme.imagePathPlaceholder ?? "Choose a reference image"}
              onChange={(event) => patchString(presentation.theme.imagePathFieldId, event.target.value)}
            />
          </label>
          <div className="theme-workbench__actions">
            {renderAction(presentation.actions.theme.browseImage)}
            {renderAction(presentation.actions.theme.absorb)}
            {presentation.theme.refill ? (
              <button
                className="theme-workbench__command"
                type="button"
                disabled={pendingAutomationSlot !== null}
                onClick={() => void handleRefill()}
              >
                {presentation.theme.refill.label ?? "Refill"}
              </button>
            ) : renderAction(presentation.actions.theme.refill)}
          </div>
        </div>

        <div className="theme-workbench__actions theme-workbench__actions--theme-storage">
          {renderAction(presentation.actions.theme.previousPackage)}
          {renderAction(presentation.actions.theme.openPackage)}
          {renderAction(presentation.actions.theme.nextPackage)}
          {renderAction(presentation.actions.theme.savePackage)}
          {renderAction(presentation.actions.theme.saveFields)}
          {renderAction(presentation.actions.theme.loadFields)}
        </div>

        <div className="theme-workbench__tone-row">
          <div className="theme-workbench__actions theme-workbench__actions--tone">
            <span data-active={visualMode === "dark" ? "true" : "false"}>
              {renderAction(presentation.actions.theme.darkMode)}
            </span>
            <span data-active={visualMode === "light" ? "true" : "false"}>
              {renderAction(presentation.actions.theme.lightMode)}
            </span>
          </div>
          {presentation.tone?.showSlider !== false ? (
            <label className="theme-workbench__tone-slider" data-button-tool-field-id="theme-workbench-tone">
              <span>{presentation.tone?.sliderLabel ?? "Theme darkness"}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={toneState.level}
                onChange={(event) => handleToneLevelChange(Number(event.target.value))}
                onPointerUp={(event) => handleToneLevelCommit(Number(event.currentTarget.value))}
                onKeyUp={(event) => handleToneLevelCommit(Number(event.currentTarget.value))}
              />
            </label>
          ) : null}
          <div className="theme-workbench__actions theme-workbench__actions--apply">
            {renderAction(presentation.actions.theme.apply)}
          </div>
        </div>

        {presentation.tone?.profiles?.enabled ? (
          <div className="theme-workbench__profiles">
            <label>
              <span>{presentation.tone.profiles.selectLabel ?? "Darkness profile"}</span>
              <select
                value={toneState.activeProfileId}
                onChange={(event) => handleToneProfileSelect(event.target.value)}
              >
                <option value="">Current tone</option>
                {toneState.profiles.map((profile) => (
                  <option value={profile.id} key={profile.id}>{profile.name}</option>
                ))}
              </select>
            </label>
            <label className="theme-workbench__profile-name">
              <span>Profile name</span>
              <input
                type="text"
                value={profileName}
                placeholder={presentation.tone.profiles.namePlaceholder ?? "Name current darkness"}
                onChange={(event) => setProfileName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSaveToneProfile();
                  }
                }}
              />
            </label>
            <button
              className="theme-workbench__command"
              type="button"
              disabled={!profileName.trim()}
              onClick={handleSaveToneProfile}
            >
              {presentation.tone.profiles.saveLabel ?? "Save profile"}
            </button>
          </div>
        ) : null}

        {pendingAutomationSlot || automationStatus ? (
          <p className="theme-workbench__status" role="status">
            {pendingAutomationSlot
              ? `Running configured action '${pendingAutomationSlot}'...`
              : automationStatus}
          </p>
        ) : null}

        <div className="theme-workbench__role-groups">
          {roleGroups.map(([groupId, roles]) => (
            <fieldset className="theme-workbench__role-group" key={groupId}>
              <legend>{presentation.theme.roleGroupLabels?.[groupId] ?? groupId}</legend>
              <div className="theme-workbench__role-grid">
                {roles.map((role) => {
                  const rawValue = jsonString(fieldValues[role.fieldId]);
                  const colorValue = normalizeThemeHex(rawValue) ?? "#000000";
                  const handleRoleApply = role.apply
                    ? () => {
                        const payload: JsonObject = { ...(role.apply?.payload ?? {}) };
                        if (role.apply?.valuePayloadKey) {
                          payload[role.apply.valuePayloadKey] = rawValue;
                        }
                        void executeConfiguredAction(role.apply!.actionSlot, fieldValues, payload)
                          .then(() => setAutomationStatus(`${role.label} applied.`))
                          .catch((error) => setAutomationStatus(
                            error instanceof Error ? error.message : String(error)
                          ));
                      }
                    : null;
                  return (
                    <label
                      className="theme-workbench__color-role"
                      data-button-tool-field-id={role.fieldId}
                      key={role.id}
                    >
                      <span>{role.label}</span>
                      <div>
                         <input
                          type="color"
                          value={colorValue}
                          onChange={(event) => patchRoleColor(role, event.target.value.toUpperCase())}
                        />
                        <input
                          type="text"
                          value={rawValue}
                          placeholder={role.placeholder ?? "#000000"}
                           onChange={(event) => patchRoleColor(role, event.target.value)}
                         />
                         {handleRoleApply ? (
                           <button
                             className="theme-workbench__command"
                             type="button"
                             disabled={pendingAutomationSlot !== null}
                             onClick={handleRoleApply}
                           >
                             {role.apply?.label ?? "Apply"}
                           </button>
                         ) : null}
                       </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        {presentation.theme.gradient ? (
          <div
            className="theme-workbench__gradient-row"
            data-button-tool-field-id={presentation.theme.gradient.enabledFieldId}
          >
            <label>
              <input
                type="checkbox"
                checked={jsonBoolean(fieldValues[presentation.theme.gradient.enabledFieldId], true)}
                onChange={(event) => patchFields({
                  [presentation.theme.gradient!.enabledFieldId]: event.target.checked
                })}
              />
              <span>{presentation.theme.gradient.label ?? "Use viewport gradient"}</span>
            </label>
            <button
              type="button"
              onClick={() => patchFields({
                [presentation.theme.gradient!.backgroundFieldId]: fieldValues[presentation.theme.gradient!.gradientFieldId] ?? "",
                [presentation.theme.gradient!.gradientFieldId]: fieldValues[presentation.theme.gradient!.backgroundFieldId] ?? ""
              })}
            >
              Flip colors
            </button>
          </div>
        ) : null}
      </section>

      <section className="theme-workbench__section">
        <div className="theme-workbench__section-heading">
          <h2>{presentation.picture.title ?? "Picture and grid"}</h2>
        </div>
        <div className="theme-workbench__path-action-row">
          {renderAction(presentation.actions.picture.apply)}
          <label
            className="theme-workbench__field theme-workbench__field--path"
            data-button-tool-field-id={presentation.picture.pathFieldId}
          >
            <span>{presentation.picture.pathLabel ?? "Picture"}</span>
            <input
              type="text"
              value={jsonString(fieldValues[presentation.picture.pathFieldId])}
              placeholder={presentation.picture.pathPlaceholder ?? "Choose a picture"}
              onChange={(event) => patchString(presentation.picture.pathFieldId, event.target.value)}
            />
          </label>
          <div className="theme-workbench__actions">
            {renderAction(presentation.actions.picture.browse)}
            {renderAction(presentation.actions.picture.startup)}
            {renderAction(presentation.actions.picture.clear)}
          </div>
        </div>
        <div className="theme-workbench__value-row">
          {presentation.picture.gridFields.map((field) => renderNumberField(field, "picture"))}
          {renderAction(presentation.actions.picture.applyGrid)}
        </div>
      </section>

      <section className="theme-workbench__section">
        <div className="theme-workbench__section-heading">
          <h2>{presentation.environment.title ?? "Environment"}</h2>
        </div>
        <div className="theme-workbench__path-action-row">
          {renderAction(presentation.actions.environment.apply)}
          <label
            className="theme-workbench__field theme-workbench__field--path"
            data-button-tool-field-id={presentation.environment.pathFieldId}
          >
            <span>{presentation.environment.pathLabel ?? "Environment image"}</span>
            <input
              type="text"
              value={jsonString(fieldValues[presentation.environment.pathFieldId])}
              placeholder={presentation.environment.pathPlaceholder ?? "Choose an environment image"}
              onChange={(event) => patchString(presentation.environment.pathFieldId, event.target.value)}
            />
          </label>
          <div className="theme-workbench__actions">
            {renderAction(presentation.actions.environment.clear)}
            {renderAction(presentation.actions.environment.reset)}
            {renderAction(presentation.actions.environment.browse)}
          </div>
        </div>
        <div className="theme-workbench__value-row">
          {presentation.environment.valueFields.map((field) => renderNumberField(field, "environment"))}
        </div>
      </section>

      {missingSlots.length > 0 ? (
        <p className="theme-workbench__warning" role="status">
          Missing child Button slots: {missingSlots.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

export default ThemeWorkbench;
