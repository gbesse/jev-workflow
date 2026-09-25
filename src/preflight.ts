import type {
  CompiledWorkflow,
  JsonObject,
  JsonValue,
  PreflightFinding,
  PreflightResult,
} from "./types.js";
import { assertJsonObject, cloneJson, getPath, isJsonValue, setPath } from "./utils.js";

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior|above) instructions/i,
  /disregard (?:the )?(?:system|developer|policy)/i,
  /(?:system|developer) message\s*:/i,
  /do not (?:classify|follow|obey) (?:this|the)/i,
  /oublie (?:toutes? )?(?:les )?instructions? (?:précédentes?|ci-dessus)/i,
  /ignore (?:les )?(?:consignes|instructions)/i,
];
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:\+\d{1,3}[ .-]?)?(?:\d[ .-]?){9,14}/;
const CARDISH = /\b(?:\d[ -]*?){13,19}\b/;

function redactPii(value: string): string {
  return value
    .replace(new RegExp(EMAIL.source, "gi"), "[EMAIL_REDACTED]")
    .replace(new RegExp(CARDISH.source, "g"), "[NUMBER_REDACTED]")
    .replace(new RegExp(PHONE.source, "g"), "[PHONE_REDACTED]");
}

function validateInputField(value: unknown, type: string, path: string): void {
  if (type === "datetime") {
    if (typeof value !== "string" || !ISO_DATETIME.test(value) || !Number.isFinite(Date.parse(value))) {
      throw new Error(`${path} must be an ISO 8601 datetime with timezone`);
    }
    return;
  }
  if (type === "array") {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    return;
  }
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
    return;
  }
  if (typeof value !== type) throw new Error(`${path} must be a ${type}`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${path} must be finite`);
}

function compare(actual: unknown, op: string, expected: string | number | boolean): boolean {
  switch (op) {
    case "gt": return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt": return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "eq": return actual === expected;
    case "neq": return actual !== expected;
    default: throw new Error(`unsupported preflight comparison: ${op}`);
  }
}

function rounded(value: number, mode: "floor" | "ceil" | "round" | undefined): number {
  return Math[mode ?? "floor"](value);
}

export function runPreflight(artifact: CompiledWorkflow, rawInput: unknown): PreflightResult {
  assertJsonObject(rawInput, "input");
  const input = cloneJson(rawInput);
  const findings: PreflightFinding[] = [];
  for (const [path, field] of Object.entries(artifact.input)) {
    const value = getPath(input, path);
    if (value === undefined || value === null) {
      if (field.required) throw new Error(`${path} is required`);
      continue;
    }
    validateInputField(value, field.type, path);
  }

  for (const rule of artifact.preflight.text ?? []) {
    const value = getPath(input, rule.path);
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") throw new Error(`${rule.path} must be a string for text preflight`);
    let normalized = rule.normalizeWhitespace ? value.trim().replace(/\s+/g, " ") : value;
    if (rule.maxCharacters && normalized.length > rule.maxCharacters) {
      if ((rule.overflow ?? "reject") === "reject") throw new Error(`${rule.path} exceeds ${rule.maxCharacters} characters`);
      normalized = normalized.slice(0, rule.maxCharacters);
      findings.push({ code: "TEXT_TRUNCATED", path: rule.path, message: `truncated to ${rule.maxCharacters} characters before inference` });
    }
    setPath(input, rule.path, normalized);
  }

  const derived: JsonObject = {};
  for (const rule of artifact.preflight.dates ?? []) {
    const from = getPath(input, rule.from);
    const to = getPath(input, rule.to);
    if (typeof from !== "string" || typeof to !== "string") throw new Error(`date rule ${rule.id} requires ${rule.from} and ${rule.to}`);
    const delta = Date.parse(to) - Date.parse(from);
    if (!Number.isFinite(delta)) throw new Error(`date rule ${rule.id} has an invalid datetime`);
    const divisor = rule.unit === "hours" ? 3_600_000 : 86_400_000;
    derived[rule.id] = rounded(delta / divisor, rule.rounding);
  }
  for (const rule of artifact.preflight.comparisons ?? []) {
    const value = getPath(input, rule.path);
    if (value === undefined || value === null) {
      derived[rule.id] = null;
      continue;
    }
    derived[rule.id] = compare(value, rule.op, rule.value);
  }

  const scanPaths = artifact.preflight.security?.scanPaths ?? [];
  for (const path of scanPaths) {
    const value = getPath(input, path);
    if (typeof value !== "string") continue;
    if (artifact.preflight.security?.detectPii && (EMAIL.test(value) || PHONE.test(value) || CARDISH.test(value))) {
      findings.push({ code: "PII_SIGNAL", path, message: "text resembles personal or payment data; review external transmission policy" });
      const action = artifact.preflight.security.piiAction ?? "warn";
      if (action === "reject") throw new Error(`${path} contains a PII signal and policy requires rejection before inference`);
      if (action === "redact") setPath(input, path, redactPii(value));
    }
    if (artifact.preflight.security?.detectInstructionInjection && INJECTION_PATTERNS.some((pattern) => pattern.test(value))) {
      findings.push({ code: "INSTRUCTION_INJECTION_SIGNAL", path, message: "text contains instruction-like content; this advisory signal is not a security boundary" });
      if (artifact.preflight.security.injectionAction === "reject") throw new Error(`${path} contains an instruction-injection signal and policy requires rejection before inference`);
    }
  }

  const state: JsonObject = {};
  for (const path of artifact.state.include) {
    const value = getPath(input, path);
    if (value !== undefined) {
      if (!isJsonValue(value)) throw new Error(`${path} is not JSON-compatible`);
      setPath(state, path, value);
    }
  }
  state._derived = derived;
  return {
    input,
    state,
    derived,
    findings,
    signals: {
      hasPii: findings.some((finding) => finding.code === "PII_SIGNAL"),
      hasInstructionInjection: findings.some((finding) => finding.code === "INSTRUCTION_INJECTION_SIGNAL"),
      wasTruncated: findings.some((finding) => finding.code === "TEXT_TRUNCATED"),
    },
  };
}
