import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CompiledWorkflow, ExecutionResult, JsonObject, JsonValue } from "./types.js";
import { cloneJson, getPath, setPath } from "./utils.js";

const SECRET_NAMES = /(?:authorization|cookie|token|secret|password|api[_-]?key)/i;

function redactObject(value: JsonValue, path = ""): JsonValue {
  if (Array.isArray(value)) return value.map((item, index) => redactObject(item, `${path}.${index}`));
  if (!value || typeof value !== "object") return value;
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) result[key] = SECRET_NAMES.test(key) ? "[REDACTED]" : redactObject(item, `${path}.${key}`);
  return result;
}

export async function appendAudit(
  artifact: CompiledWorkflow,
  input: JsonObject,
  result: ExecutionResult,
  overridePath?: string,
): Promise<string> {
  const path = resolve(overridePath ?? artifact.audit.path ?? ".jev/audit.jsonl");
  const record: Record<string, unknown> = {
    type: "jev_workflow_decision",
    ...result.receipt,
    workflow: result.workflow,
    providerModel: result.providerModel,
    outcome: result.outcome,
    decision: result.decision,
    answers: result.answers,
    preflight: result.preflight,
    egress: result.egress,
    stability: result.stability,
    inputFields: Object.keys(input).sort(),
  };
  if (artifact.audit.includeInput) {
    const included = redactObject(cloneJson(input));
    for (const pathToRedact of artifact.audit.redact ?? []) {
      if (getPath(included, pathToRedact) !== undefined) setPath(included as JsonObject, pathToRedact, "[REDACTED]");
    }
    record.input = included;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}
