type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string, message: string): never {
  throw new Error(`Installed tool-set layout '${path}' ${message}`);
}

function rejectUnknownKeys(
  record: UnknownRecord,
  allowedKeys: readonly string[],
  path: string
): void {
  const allowed = new Set(allowedKeys);
  const unsupported = Object.keys(record).find((key) => !allowed.has(key));
  if (unsupported) invalid(`${path}.${unsupported}`, "is not supported.");
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(path, "must be a finite number.");
  }
  return value;
}

function requireNonemptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    invalid(path, "must be a nonempty string.");
  }
  return value;
}

function validateJsonValue(value: unknown, path: string, ancestors = new Set<object>()): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== "object" || value === null) {
    invalid(path, "must contain only JSON values.");
  }
  if (ancestors.has(value)) invalid(path, "must not contain a circular value.");
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${path}.${index}`, ancestors));
  } else {
    Object.entries(value).forEach(([key, item]) =>
      validateJsonValue(item, `${path}.${key}`, ancestors)
    );
  }
  ancestors.delete(value);
}

function validateRect(value: unknown, path: string): void {
  if (!isRecord(value)) invalid(path, "must be an object.");
  requireFiniteNumber(value.x, `${path}.x`);
  requireFiniteNumber(value.y, `${path}.y`);
  const width = requireFiniteNumber(value.width, `${path}.width`);
  const height = requireFiniteNumber(value.height, `${path}.height`);
  if (width <= 0 || height <= 0) invalid(path, "must have positive width and height.");
}

function validateOptionalBoolean(record: UnknownRecord, key: string, path: string): void {
  if (record[key] !== undefined && typeof record[key] !== "boolean") {
    invalid(`${path}.${key}`, "must be boolean.");
  }
}

function validateOptionalFiniteNumber(record: UnknownRecord, key: string, path: string): void {
  if (record[key] !== undefined) requireFiniteNumber(record[key], `${path}.${key}`);
}

function validateServiceTarget(value: unknown, path: string): void {
  if (!isRecord(value)) invalid(path, "must be an object.");
  if (value.kind === "core-action") {
    rejectUnknownKeys(value, ["kind", "actionId", "payload", "events"], path);
    requireNonemptyString(value.actionId, `${path}.actionId`);
  } else if (value.kind === "tool-set-action") {
    rejectUnknownKeys(
      value,
      ["kind", "programName", "panelName", "ownerFileName", "command", "payload", "events"],
      path
    );
    requireNonemptyString(value.programName, `${path}.programName`);
    requireNonemptyString(value.panelName, `${path}.panelName`);
    requireNonemptyString(value.ownerFileName, `${path}.ownerFileName`);
    requireNonemptyString(value.command, `${path}.command`);
  } else {
    invalid(`${path}.kind`, "must be 'core-action' or 'tool-set-action'.");
  }
  if (value.payload !== undefined) {
    if (!isRecord(value.payload)) invalid(`${path}.payload`, "must be an object.");
    validateJsonValue(value.payload, `${path}.payload`);
  }
  if (value.events !== undefined) {
    if (!isRecord(value.events)) invalid(`${path}.events`, "must be an object.");
    validateJsonValue(value.events, `${path}.events`);
  }
}

function validateToolField(value: unknown, path: string): { id: string; kind: string } {
  if (!isRecord(value)) invalid(path, "must be an object.");
  const id = requireNonemptyString(value.id, `${path}.id`);
  requireNonemptyString(value.kind, `${path}.kind`);
  const baseKeys = [
    "id",
    "kind",
    "label",
    "payloadKey",
    "defaultValue",
    "x",
    "y",
    "width",
    "height",
    "zIndex",
    "hidden",
    "disabled",
    "serviceTrigger",
    "serviceTarget"
  ];
  const kindKeys: Record<string, readonly string[]> = {
    text: ["placeholder"],
    number: ["minimum", "maximum", "step"],
    select: ["options"],
    toggle: [],
    path: ["pathKind", "filter"],
    color: [],
    display: ["format"]
  };
  const allowedKindKeys = kindKeys[String(value.kind)];
  if (!allowedKindKeys) invalid(`${path}.kind`, "is not supported.");
  rejectUnknownKeys(value, [...baseKeys, ...allowedKindKeys], path);
  if (typeof value.label !== "string") invalid(`${path}.label`, "must be a string.");
  if (typeof value.payloadKey !== "string") invalid(`${path}.payloadKey`, "must be a string.");
  validateRect(value, path);
  requireFiniteNumber(value.zIndex, `${path}.zIndex`);
  validateOptionalBoolean(value, "hidden", path);
  validateOptionalBoolean(value, "disabled", path);
  if (
    value.serviceTrigger !== undefined &&
    value.serviceTrigger !== "change" &&
    value.serviceTrigger !== "activate"
  ) {
    invalid(`${path}.serviceTrigger`, "must be 'change' or 'activate'.");
  }
  if (value.serviceTarget !== undefined) {
    validateServiceTarget(value.serviceTarget, `${path}.serviceTarget`);
  }

  switch (value.kind) {
    case "text":
      if (typeof value.defaultValue !== "string") invalid(`${path}.defaultValue`, "must be a string.");
      if (value.placeholder !== undefined && typeof value.placeholder !== "string") {
        invalid(`${path}.placeholder`, "must be a string.");
      }
      break;
    case "number":
      requireFiniteNumber(value.defaultValue, `${path}.defaultValue`);
      validateOptionalFiniteNumber(value, "minimum", path);
      validateOptionalFiniteNumber(value, "maximum", path);
      validateOptionalFiniteNumber(value, "step", path);
      break;
    case "select": {
      const primitiveDefault = value.defaultValue === null ||
        typeof value.defaultValue === "string" ||
        typeof value.defaultValue === "boolean" ||
        (typeof value.defaultValue === "number" && Number.isFinite(value.defaultValue));
      if (!primitiveDefault) invalid(`${path}.defaultValue`, "must be a JSON primitive.");
      if (!Array.isArray(value.options) || value.options.length === 0) {
        invalid(`${path}.options`, "must be a nonempty array.");
      }
      const optionIds = new Set<string>();
      const optionValues: unknown[] = [];
      value.options.forEach((option, index) => {
        const optionPath = `${path}.options.${index}`;
        if (!isRecord(option)) invalid(optionPath, "must be an object.");
        rejectUnknownKeys(option, ["id", "label", "value"], optionPath);
        const optionId = requireNonemptyString(option.id, `${optionPath}.id`).toLocaleLowerCase("en-US");
        if (optionIds.has(optionId)) invalid(`${optionPath}.id`, "must be unique.");
        optionIds.add(optionId);
        requireNonemptyString(option.label, `${optionPath}.label`);
        validateJsonValue(option.value, `${optionPath}.value`);
        const primitive = option.value === null ||
          typeof option.value === "string" ||
          typeof option.value === "boolean" ||
          (typeof option.value === "number" && Number.isFinite(option.value));
        if (!primitive) invalid(`${optionPath}.value`, "must be a JSON primitive.");
        if (optionValues.some((candidate) => Object.is(candidate, option.value))) {
          invalid(`${optionPath}.value`, "must be unique.");
        }
        optionValues.push(option.value);
      });
      if (!optionValues.some((candidate) => Object.is(candidate, value.defaultValue))) {
        invalid(`${path}.defaultValue`, "must match one option value.");
      }
      break;
    }
    case "toggle":
      if (typeof value.defaultValue !== "boolean") invalid(`${path}.defaultValue`, "must be boolean.");
      break;
    case "path":
      if (typeof value.defaultValue !== "string") invalid(`${path}.defaultValue`, "must be a string.");
      if (value.pathKind !== "file" && value.pathKind !== "folder") {
        invalid(`${path}.pathKind`, "must be 'file' or 'folder'.");
      }
      if (value.filter !== undefined && typeof value.filter !== "string") {
        invalid(`${path}.filter`, "must be a string.");
      }
      break;
    case "color":
      if (typeof value.defaultValue !== "string") invalid(`${path}.defaultValue`, "must be a string.");
      break;
    case "display":
      validateJsonValue(value.defaultValue, `${path}.defaultValue`);
      if (
        value.defaultValue !== null &&
        !["string", "number", "boolean"].includes(typeof value.defaultValue)
      ) {
        invalid(`${path}.defaultValue`, "must be a JSON primitive.");
      }
      if (value.format !== undefined && typeof value.format !== "string") {
        invalid(`${path}.format`, "must be a string.");
      }
      break;
    default:
      invalid(`${path}.kind`, "is not supported.");
  }
  return { id, kind: value.kind };
}

function collectFieldReferences(value: unknown, references: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectFieldReferences(item, references));
    return;
  }
  if (!isRecord(value)) return;
  if (Object.keys(value).length === 1 && typeof value.$field === "string") {
    references.add(value.$field);
    return;
  }
  Object.values(value).forEach((item) => collectFieldReferences(item, references));
}

function validateBehavior(
  value: unknown,
  path: string,
  fieldKinds: ReadonlyMap<string, string>
): void {
  if (!isRecord(value)) invalid(path, "must be an object.");
  rejectUnknownKeys(
    value,
    [
      "toggleFields",
      "fieldPatch",
      "activationPatch",
      "activateField",
      "inlineEditField",
      "selectField",
      "execute",
      "payloadTemplate"
    ],
    path
  );
  if (value.toggleFields !== undefined) {
    if (!Array.isArray(value.toggleFields) || value.toggleFields.some((item) => typeof item !== "string")) {
      invalid(`${path}.toggleFields`, "must be an array of strings.");
    }
  }
  const references = new Set<string>(value.toggleFields as string[] | undefined ?? []);
  for (const key of ["fieldPatch", "activationPatch", "payloadTemplate"] as const) {
    if (value[key] === undefined) continue;
    if (!isRecord(value[key])) invalid(`${path}.${key}`, "must be an object.");
    validateJsonValue(value[key], `${path}.${key}`);
    if (key === "payloadTemplate") {
      collectFieldReferences(value[key], references);
    } else {
      Object.keys(value[key]).forEach((fieldId) => references.add(fieldId));
    }
  }
  for (const key of ["activateField", "inlineEditField", "selectField"] as const) {
    if (value[key] !== undefined) {
      references.add(requireNonemptyString(value[key], `${path}.${key}`));
    }
  }
  validateOptionalBoolean(value, "execute", path);
  for (const reference of references) {
    if (!fieldKinds.has(reference.toLocaleLowerCase("en-US"))) {
      invalid(path, `references unknown field '${reference}'.`);
    }
  }
  if (value.inlineEditField !== undefined && value.selectField !== undefined) {
    invalid(path, "cannot combine inlineEditField with selectField.");
  }
  if (typeof value.selectField === "string") {
    const kind = fieldKinds.get(value.selectField.toLocaleLowerCase("en-US"));
    if (kind !== "select" || value.execute !== false) {
      invalid(`${path}.selectField`, "requires a select field and execute false.");
    }
  }
  if (typeof value.inlineEditField === "string") {
    const kind = fieldKinds.get(value.inlineEditField.toLocaleLowerCase("en-US"));
    if ((kind !== "text" && kind !== "number") || value.execute !== false) {
      invalid(`${path}.inlineEditField`, "requires a text or number field and execute false.");
    }
  }
}

export function validateInstalledButtonLayout<T>(layout: T): T {
  if (layout === undefined || layout === null) return layout;
  if (!isRecord(layout)) invalid("layout", "must be an object.");
  rejectUnknownKeys(
    layout,
    [
      "mode",
      "columns",
      "gap",
      "padding",
      "width",
      "height",
      "placements",
      "fields",
      "childBehaviors",
      "updatePolicy"
    ],
    "layout"
  );

  if (layout.mode !== undefined && layout.mode !== "grid") {
    invalid("mode", "must be 'grid'.");
  }
  if (layout.columns !== undefined) {
    const columns = requireFiniteNumber(layout.columns, "columns");
    if (!Number.isInteger(columns) || columns <= 0) invalid("columns", "must be a positive integer.");
  }
  for (const key of ["gap", "padding"] as const) {
    if (layout[key] === undefined) continue;
    const value = requireFiniteNumber(layout[key], key);
    if (value < 0) invalid(key, "must be nonnegative.");
  }

  for (const key of ["width", "height"] as const) {
    if (layout[key] === undefined) continue;
    const value = requireFiniteNumber(layout[key], key);
    if (value <= 0) invalid(key, "must be positive.");
  }

  if (layout.placements !== undefined) {
    if (!isRecord(layout.placements)) invalid("placements", "must be an object.");
    Object.entries(layout.placements).forEach(([slot, rect]) => {
      if (!slot.trim()) invalid("placements", "cannot contain an empty slot.");
      validateRect(rect, `placements.${slot}`);
      rejectUnknownKeys(rect as UnknownRecord, ["x", "y", "width", "height"], `placements.${slot}`);
    });
  }

  const fieldKinds = new Map<string, string>();
  if (layout.fields !== undefined) {
    if (!Array.isArray(layout.fields)) invalid("fields", "must be an array.");
    layout.fields.forEach((field, index) => {
      const { id, kind } = validateToolField(field, `fields.${index}`);
      const normalizedId = id.toLocaleLowerCase("en-US");
      if (fieldKinds.has(normalizedId)) invalid(`fields.${index}.id`, "must be unique.");
      fieldKinds.set(normalizedId, kind);
    });
  }

  if (layout.childBehaviors !== undefined) {
    if (!isRecord(layout.childBehaviors)) invalid("childBehaviors", "must be an object.");
    Object.entries(layout.childBehaviors).forEach(([slot, behavior]) => {
      if (!slot.trim()) invalid("childBehaviors", "cannot contain an empty slot.");
      validateBehavior(behavior, `childBehaviors.${slot}`, fieldKinds);
    });
  }

  if (layout.updatePolicy !== undefined) {
    if (!isRecord(layout.updatePolicy)) invalid("updatePolicy", "must be an object.");
    rejectUnknownKeys(layout.updatePolicy, ["appendMissingChildSlots"], "updatePolicy");
    validateOptionalBoolean(layout.updatePolicy, "appendMissingChildSlots", "updatePolicy");
  }

  return layout;
}
