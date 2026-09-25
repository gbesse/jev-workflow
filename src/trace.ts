import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CompiledWorkflow, DecisionTrace, ExecutionResult, JsonObject } from "./types.js";

export function createDecisionTrace(
  artifact: CompiledWorkflow,
  result: ExecutionResult,
  options: { startedAt?: string; endedAt?: string; input?: JsonObject } = {},
): DecisionTrace {
  const startedAt = options.startedAt ?? result.receipt.timestamp;
  const endedAt = options.endedAt ?? new Date().toISOString();
  const trace: DecisionTrace = {
    version: 1,
    traceId: randomBytes(16).toString("hex"),
    spanId: randomBytes(8).toString("hex"),
    name: "jev.workflow.decision",
    startTime: startedAt,
    endTime: endedAt,
    status: "OK",
    attributes: {
      "jev.workflow.name": artifact.name,
      "jev.workflow.version": artifact.policyVersion,
      "jev.workflow.fingerprint": artifact.fingerprint,
      "jev.provider.model": result.providerModel,
      "jev.decision.rule_id": result.decision.ruleId,
      "jev.decision.uncertain": result.decision.uncertainQuestions.length > 0,
      "jev.input.hash": result.receipt.inputHash,
      "jev.request.hash": result.receipt.requestHash,
      "gen_ai.usage.input_tokens": result.receipt.usage.input_tokens,
      "gen_ai.usage.output_tokens": result.receipt.usage.output_tokens,
    },
    events: [
      { name: "preflight.completed", timestamp: startedAt, attributes: { ...result.preflight.signals, findings: result.preflight.findings.length } },
      { name: "decision.routed", timestamp: endedAt, attributes: { reason: result.decision.reason, outcome: result.outcome } },
    ],
    result,
  };
  if (options.input) trace.input = structuredClone(options.input);
  return trace;
}

export async function appendDecisionTrace(path: string, trace: DecisionTrace): Promise<string> {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await appendFile(destination, `${JSON.stringify(trace)}\n`, { encoding: "utf8", mode: 0o600 });
  return destination;
}

export async function readDecisionTrace(path: string, id?: string): Promise<DecisionTrace> {
  const rows = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as DecisionTrace);
  const trace = id ? rows.find((item) => item.result.receipt.id === id || item.traceId === id) : rows.at(-1);
  if (!trace) throw new Error(id ? `trace not found: ${id}` : "trace file is empty");
  if (trace.version !== 1 || trace.name !== "jev.workflow.decision") throw new Error("unsupported trace format");
  return trace;
}

export function traceToRegressionCase(trace: DecisionTrace): JsonObject {
  if (!trace.input) throw new Error("trace does not contain input; record with --trace-input to enable replay");
  return {
    id: trace.result.receipt.id,
    input: structuredClone(trace.input),
    expected: {
      outcome: structuredClone(trace.result.outcome),
      ruleId: trace.result.decision.ruleId,
      answers: structuredClone(trace.result.answers),
    } as unknown as JsonObject,
    provenance: { traceId: trace.traceId, workflowFingerprint: trace.result.workflow.fingerprint },
  };
}
