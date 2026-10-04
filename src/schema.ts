import type {
  Condition,
  JsonValue,
  QuestionSpec,
  WorkflowSpec,
} from "./types.js";
import { assertSafePath, isJsonValue, isObject } from "./utils.js";

const FIELD_TYPES = new Set(["string", "number", "boolean", "datetime", "object", "array"]);
const QUESTION_TYPES = new Set(["choice", "noul", "score"]);
const CONDITION_OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "in", "exists"]);

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function nonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) fail(path, "must be a non-empty string");
}

function dataPath(value: unknown, path: string, allowWildcard = false): asserts value is string {
  nonEmptyString(value, path);
  const normalized = allowWildcard && value.endsWith(".*") ? value.slice(0, -2) : value;
  try { assertSafePath(normalized); }
  catch (error) { fail(path, error instanceof Error ? error.message : String(error)); }
}

function identifier(value: unknown, path: string): asserts value is string {
  nonEmptyString(value, path);
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) fail(path, "must contain only letters, digits, underscore, or dash and may not start with a digit");
  try { assertSafePath(value); }
  catch (error) { fail(path, error instanceof Error ? error.message : String(error)); }
}

function stringArray(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    fail(path, "must be an array of non-empty strings");
  }
}

function probability(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(path, "must be between 0 and 1");
  }
}

function validateQuestion(value: unknown, path: string): asserts value is QuestionSpec {
  if (!isObject(value) || !QUESTION_TYPES.has(String(value.type))) fail(path, "invalid question type");
  if (value.instructions !== undefined && !isJsonValue(value.instructions)) fail(`${path}.instructions`, "must be JSON-compatible");
  if (value.type === "choice") {
    if (!isObject(value.criteria) || Object.keys(value.criteria).length < 2 || !isJsonValue(value.criteria)) {
      fail(`${path}.criteria`, "choice requires at least two JSON-compatible labeled criteria");
    }
  }
  if (value.type === "score") {
    if (!Array.isArray(value.criteria) || value.criteria.length < 2 || !value.criteria.every(isJsonValue)) {
      fail(`${path}.criteria`, "score requires an ordered list of at least two criteria");
    }
  }
  if (value.type === "noul" && value.criteria !== undefined && value.criteria !== null) {
    if (!isObject(value.criteria) || !isJsonValue(value.criteria)) fail(`${path}.criteria`, "must be true/false criteria");
    const unknown = Object.keys(value.criteria).filter((key) => key !== "true" && key !== "false");
    if (unknown.length > 0) fail(`${path}.criteria`, `unknown keys: ${unknown.join(", ")}`);
  }
  if (value.guard !== undefined) {
    if (!isObject(value.guard)) fail(`${path}.guard`, "must be an object");
    if (value.guard.minConfidence !== undefined) probability(value.guard.minConfidence, `${path}.guard.minConfidence`);
    if (value.guard.minMargin !== undefined) probability(value.guard.minMargin, `${path}.guard.minMargin`);
    if (value.guard.requiredForAuto !== undefined && typeof value.guard.requiredForAuto !== "boolean") {
      fail(`${path}.guard.requiredForAuto`, "must be a boolean");
    }
  }
}

function validateCondition(value: unknown, path: string): asserts value is Condition {
  if (!isObject(value)) fail(path, "must be a condition object");
  const groupKeys = ["all", "any", "not"].filter((key) => key in value);
  if (groupKeys.length > 0) {
    if (groupKeys.length !== 1 || Object.keys(value).length !== 1) fail(path, "condition groups must have exactly one of all, any, or not");
    const key = groupKeys[0]!;
    if (key === "not") return validateCondition(value.not, `${path}.not`);
    const children = value[key];
    if (!Array.isArray(children) || children.length === 0) fail(`${path}.${key}`, "must be a non-empty array");
    children.forEach((child, index) => validateCondition(child, `${path}.${key}[${index}]`));
    return;
  }
  dataPath(value.path, `${path}.path`);
  if (typeof value.op !== "string" || !CONDITION_OPERATORS.has(value.op)) fail(`${path}.op`, "invalid operator");
  if (value.op !== "exists" && !("value" in value)) fail(`${path}.value`, "is required");
  if ("value" in value && !isJsonValue(value.value)) fail(`${path}.value`, "must be JSON-compatible");
}

export function validateWorkflowSpec(value: unknown): asserts value is WorkflowSpec {
  if (!isObject(value)) fail("workflow", "must be an object");
  if (value.version !== 1) fail("version", "must be 1");
  nonEmptyString(value.name, "name");
  nonEmptyString(value.policyVersion, "policyVersion");
  if (value.locale !== undefined) nonEmptyString(value.locale, "locale");
  if (value.model !== undefined) nonEmptyString(value.model, "model");

  if (!isObject(value.input) || Object.keys(value.input).length === 0) fail("input", "must define at least one field");
  for (const [path, raw] of Object.entries(value.input)) {
    dataPath(path, "input field path");
    if (!isObject(raw) || typeof raw.type !== "string" || !FIELD_TYPES.has(raw.type)) fail(`input.${path}`, "invalid field type");
    if (raw.required !== undefined && typeof raw.required !== "boolean") fail(`input.${path}.required`, "must be boolean");
  }

  if (!isObject(value.state)) fail("state", "must be an object");
  stringArray(value.state.include, "state.include");
  value.state.include.forEach((path, index) => dataPath(path, `state.include[${index}]`));

  if (!isObject(value.questions) || Object.keys(value.questions).length === 0) fail("questions", "must not be empty");
  for (const [id, question] of Object.entries(value.questions)) {
    identifier(id, `questions.${id}`);
    if (!/^[A-Za-z]/.test(id)) fail(`questions.${id}`, "id must start with a letter");
    validateQuestion(question, `questions.${id}`);
  }

  if (!isObject(value.routing) || !Array.isArray(value.routing.rules) || !isObject(value.routing.default) || !isJsonValue(value.routing.default)) {
    fail("routing", "requires rules and a JSON-object default outcome");
  }
  if (value.routing.onUncertain !== undefined && (!isObject(value.routing.onUncertain) || !isJsonValue(value.routing.onUncertain))) {
    fail("routing.onUncertain", "must be a JSON object");
  }
  const ruleIds = new Set<string>();
  value.routing.rules.forEach((raw, index) => {
    if (!isObject(raw)) fail(`routing.rules[${index}]`, "must be an object");
    nonEmptyString(raw.id, `routing.rules[${index}].id`);
    if (ruleIds.has(raw.id)) fail(`routing.rules[${index}].id`, "must be unique");
    ruleIds.add(raw.id);
    nonEmptyString(raw.reason, `routing.rules[${index}].reason`);
    validateCondition(raw.when, `routing.rules[${index}].when`);
    if (!isObject(raw.outcome) || !isJsonValue(raw.outcome)) fail(`routing.rules[${index}].outcome`, "must be a JSON object");
  });

  validatePreflight(value.preflight);
  if (value.audit !== undefined) {
    if (!isObject(value.audit)) fail("audit", "must be an object");
    if (value.audit.path !== undefined) nonEmptyString(value.audit.path, "audit.path");
    if (value.audit.includeInput !== undefined && typeof value.audit.includeInput !== "boolean") fail("audit.includeInput", "must be boolean");
    if (value.audit.redact !== undefined) {
      stringArray(value.audit.redact, "audit.redact");
      value.audit.redact.forEach((path, index) => dataPath(path, `audit.redact[${index}]`));
    }
  }
  validateStability(value.stability);
  validateEgress(value.egress);
}

function validateStability(value: unknown): void {
  if (value === undefined) return;
  if (!isObject(value)) fail("stability", "must be an object");
  if (value.minConsecutive !== undefined && (!Number.isInteger(value.minConsecutive) || Number(value.minConsecutive) < 1)) fail("stability.minConsecutive", "must be a positive integer");
  for (const key of ["minDwellMs", "cooldownMs"] as const) {
    if (value[key] !== undefined && (!Number.isFinite(value[key]) || Number(value[key]) < 0)) fail(`stability.${key}`, "must be a non-negative number");
  }
}

function validateEgress(value: unknown): void {
  if (value === undefined) return;
  if (!isObject(value)) fail("egress", "must be an object");
  if (value.allow !== undefined) {
    stringArray(value.allow, "egress.allow");
    value.allow.forEach((path, index) => dataPath(path, `egress.allow[${index}]`, true));
  }
  if (value.deny !== undefined) {
    stringArray(value.deny, "egress.deny");
    value.deny.forEach((path, index) => dataPath(path, `egress.deny[${index}]`, true));
  }
  if (value.allowClassifications !== undefined) {
    stringArray(value.allowClassifications, "egress.allowClassifications");
    const valid = new Set(["public", "internal", "personal", "sensitive", "secret"]);
    if (!value.allowClassifications.every((item) => valid.has(item))) fail("egress.allowClassifications", "contains an invalid classification");
  }
  if (value.classifications !== undefined) {
    if (!isObject(value.classifications)) fail("egress.classifications", "must be an object");
    for (const [path, classification] of Object.entries(value.classifications)) {
      dataPath(path, "egress.classifications path", true);
      if (!["public", "internal", "personal", "sensitive", "secret"].includes(String(classification))) fail(`egress.classifications.${path}`, "invalid classification");
    }
  }
  if (value.requireExplicitClassification !== undefined && typeof value.requireExplicitClassification !== "boolean") fail("egress.requireExplicitClassification", "must be boolean");
  if (value.destination !== undefined) {
    if (!isObject(value.destination)) fail("egress.destination", "must be an object");
    nonEmptyString(value.destination.service, "egress.destination.service");
    if (value.destination.region !== undefined) nonEmptyString(value.destination.region, "egress.destination.region");
  }
  if (value.requiredRegion !== undefined) nonEmptyString(value.requiredRegion, "egress.requiredRegion");
  if (value.onViolation !== undefined && !["reject", "warn"].includes(String(value.onViolation))) fail("egress.onViolation", "must be reject or warn");
}

function validatePreflight(value: unknown): void {
  if (value === undefined) return;
  if (!isObject(value)) fail("preflight", "must be an object");
  if (value.text !== undefined) {
    if (!Array.isArray(value.text)) fail("preflight.text", "must be an array");
    value.text.forEach((raw, index) => {
      if (!isObject(raw)) fail(`preflight.text[${index}]`, "must be an object");
      dataPath(raw.path, `preflight.text[${index}].path`);
      if (raw.maxCharacters !== undefined && (!Number.isInteger(raw.maxCharacters) || Number(raw.maxCharacters) < 1)) fail(`preflight.text[${index}].maxCharacters`, "must be a positive integer");
      if (raw.normalizeWhitespace !== undefined && typeof raw.normalizeWhitespace !== "boolean") fail(`preflight.text[${index}].normalizeWhitespace`, "must be boolean");
      if (raw.overflow !== undefined && raw.overflow !== "reject" && raw.overflow !== "truncate") fail(`preflight.text[${index}].overflow`, "must be reject or truncate");
    });
  }
  if (value.dates !== undefined) {
    if (!Array.isArray(value.dates)) fail("preflight.dates", "must be an array");
    value.dates.forEach((raw, index) => {
      if (!isObject(raw)) fail(`preflight.dates[${index}]`, "must be an object");
      identifier(raw.id, `preflight.dates[${index}].id`);
      dataPath(raw.from, `preflight.dates[${index}].from`);
      dataPath(raw.to, `preflight.dates[${index}].to`);
    });
  }
  if (value.comparisons !== undefined) {
    if (!Array.isArray(value.comparisons)) fail("preflight.comparisons", "must be an array");
    value.comparisons.forEach((raw, index) => {
      if (!isObject(raw)) fail(`preflight.comparisons[${index}]`, "must be an object");
      identifier(raw.id, `preflight.comparisons[${index}].id`);
      dataPath(raw.path, `preflight.comparisons[${index}].path`);
      nonEmptyString(raw.op, `preflight.comparisons[${index}].op`);
      if (!["gt", "gte", "lt", "lte", "eq", "neq"].includes(String(raw.op))) fail(`preflight.comparisons[${index}].op`, "invalid comparison");
      if (!["string", "number", "boolean"].includes(typeof raw.value)) fail(`preflight.comparisons[${index}].value`, "must be scalar");
    });
  }
  if (value.security !== undefined) {
    if (!isObject(value.security)) fail("preflight.security", "must be an object");
    if (value.security.scanPaths !== undefined) {
      stringArray(value.security.scanPaths, "preflight.security.scanPaths");
      value.security.scanPaths.forEach((path, index) => dataPath(path, `preflight.security.scanPaths[${index}]`));
    }
    for (const key of ["detectPii", "detectInstructionInjection"]) {
      if (value.security[key] !== undefined && typeof value.security[key] !== "boolean") fail(`preflight.security.${key}`, "must be boolean");
    }
    if (value.security.piiAction !== undefined && !["warn", "redact", "reject"].includes(String(value.security.piiAction))) fail("preflight.security.piiAction", "must be warn, redact, or reject");
    if (value.security.injectionAction !== undefined && !["warn", "reject"].includes(String(value.security.injectionAction))) fail("preflight.security.injectionAction", "must be warn or reject");
  }
}
