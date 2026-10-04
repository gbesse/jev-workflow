import { randomUUID } from "node:crypto";
import { appendAudit } from "./audit.js";
import { evaluateCondition } from "./conditions.js";
import { createEgressPlan, enforceEgress } from "./egress.js";
import { runPreflight } from "./preflight.js";
import { stabilizeDecision } from "./stability.js";
import { appendDecisionTrace, createDecisionTrace } from "./trace.js";
import type {
  Answer,
  CompiledWorkflow,
  DecisionProvider,
  ExecutionResult,
  JsonObject,
  SystemOneRequest,
  StabilityState,
} from "./types.js";
import { sha256 } from "./utils.js";

function isUncertain(answer: Answer, guard: CompiledWorkflow["guards"][string]): boolean {
  if (guard.requiredForAuto === false) return false;
  if (answer.type === "noul") {
    return guard.minMargin !== undefined && Math.abs(answer.noul - 0.5) * 2 < guard.minMargin;
  }
  if (guard.minConfidence !== undefined && answer.confidence < guard.minConfidence) return true;
  const probabilities = Object.values(answer.probabilities).sort((a, b) => b - a);
  return guard.minMargin !== undefined && ((probabilities[0] ?? 0) - (probabilities[1] ?? 0)) < guard.minMargin;
}

export interface ExecuteOptions {
  audit?: boolean;
  auditPath?: string;
  timestamp?: string;
  id?: string;
  tracePath?: string;
  traceInput?: boolean;
  stabilityState?: StabilityState;
}

export async function executeWorkflow(
  artifact: CompiledWorkflow,
  rawInput: unknown,
  provider: DecisionProvider,
  options: ExecuteOptions = {},
): Promise<ExecutionResult> {
  const startedAt = options.timestamp ?? new Date().toISOString();
  const preflight = runPreflight(artifact, rawInput);
  const request: SystemOneRequest = { model: artifact.model, state: preflight.state, questions: artifact.questions };
  const egress = artifact.egress ? createEgressPlan(artifact, preflight.state, startedAt) : undefined;
  if (egress) enforceEgress(egress, artifact);
  const providerResult = await provider.decide(request);
  const uncertainQuestions = Object.entries(artifact.guards)
    .filter(([id, guard]) => providerResult.answers[id] && isUncertain(providerResult.answers[id]!, guard))
    .map(([id]) => id);

  let outcome: JsonObject;
  let ruleId: string | null = null;
  let reason: string;
  if (uncertainQuestions.length > 0 && artifact.routing.onUncertain) {
    outcome = artifact.routing.onUncertain;
    reason = `uncertainty guard failed for: ${uncertainQuestions.join(", ")}`;
  } else {
    const environment = {
      input: preflight.input,
      derived: preflight.derived,
      answers: providerResult.answers,
      preflight: preflight.signals,
    };
    const matched = artifact.routing.rules.find((rule) => evaluateCondition(rule.when, environment));
    outcome = matched?.outcome ?? artifact.routing.default;
    ruleId = matched?.id ?? null;
    reason = matched?.reason ?? "no routing rule matched; used default outcome";
  }

  const proposed = { outcome, ruleId, reason };
  const stability = artifact.stability ? stabilizeDecision(outcome, options.stabilityState, artifact.stability, startedAt) : undefined;
  if (stability) {
    outcome = stability.emittedOutcome;
    if (stability.status === "held") {
      ruleId = null;
      reason = stability.reason;
    }
  }
  const result: ExecutionResult = {
    workflow: { name: artifact.name, policyVersion: artifact.policyVersion, fingerprint: artifact.fingerprint },
    providerModel: providerResult.model,
    outcome,
    decision: {
      ruleId,
      reason,
      uncertainQuestions,
      ...(stability?.status === "held" ? { proposed } : {}),
    },
    answers: providerResult.answers,
    preflight: { derived: preflight.derived, findings: preflight.findings, signals: preflight.signals },
    receipt: {
      id: options.id ?? randomUUID(),
      timestamp: startedAt,
      inputHash: sha256(preflight.input),
      requestHash: sha256(request as unknown as JsonObject),
      usage: providerResult.usage,
    },
    ...(egress ? { egress } : {}),
    ...(stability ? { stability } : {}),
  };
  if (options.audit !== false) await appendAudit(artifact, preflight.input, result, options.auditPath);
  if (options.tracePath) {
    const trace = createDecisionTrace(artifact, result, {
      startedAt,
      endedAt: new Date().toISOString(),
      ...(options.traceInput ? { input: preflight.input } : {}),
    });
    await appendDecisionTrace(options.tracePath, trace);
  }
  return result;
}
