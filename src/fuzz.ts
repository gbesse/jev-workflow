import type {
  CompiledWorkflow,
  DecisionProvider,
  EvaluationRow,
  FuzzMutationName,
  FuzzReport,
  FuzzViolation,
  JsonObject,
} from "./types.js";
import { executeWorkflow } from "./runtime.js";
import { canonicalJson, cloneJson, getPath, setPath } from "./utils.js";

export interface FuzzOptions {
  seed?: number;
  mutations?: FuzzMutationName[];
  irrelevantPaths?: string[];
  irrelevantText?: string;
  maxCalls?: number;
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const next = Math.floor(random() * (index + 1));
    [result[index], result[next]] = [result[next]!, result[index]!];
  }
  if (result.length > 1 && result.every((value, index) => value === values[index])) {
    result.push(result.shift()!);
  }
  return result;
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mutateArtifact(artifact: CompiledWorkflow, mutation: FuzzMutationName, random: () => number): CompiledWorkflow {
  const copy = structuredClone(artifact);
  if (mutation === "option-order") {
    for (const question of Object.values(copy.questions)) {
      if (question.type === "choice") question.criteria = Object.fromEntries(shuffled(Object.entries(question.criteria), random));
    }
  }
  if (mutation === "state-key-order") copy.state.include = shuffled(copy.state.include, random);
  return copy;
}

function mutateInput(artifact: CompiledWorkflow, input: JsonObject, mutation: FuzzMutationName, paths: string[], text: string): JsonObject[] {
  if (mutation === "normalized-whitespace") {
    return (artifact.preflight.text ?? []).filter((rule) => rule.normalizeWhitespace).flatMap((rule) => {
      const value = getPath(input, rule.path);
      if (typeof value !== "string") return [];
      const copy = cloneJson(input);
      setPath(copy, rule.path, `   ${value.replace(/ /g, "   ")}   `);
      return [copy];
    });
  }
  if (mutation === "irrelevant-context") {
    return paths.flatMap((path) => {
      const value = getPath(input, path);
      if (typeof value !== "string") return [];
      const copy = cloneJson(input);
      setPath(copy, path, `${value}\n\n${text}`);
      return [copy];
    });
  }
  return [cloneJson(input)];
}

export async function fuzzWorkflow(
  artifact: CompiledWorkflow,
  rows: EvaluationRow[],
  provider: DecisionProvider,
  options: FuzzOptions = {},
): Promise<FuzzReport> {
  const seed = options.seed ?? 42;
  const random = rng(seed);
  const mutations = options.mutations ?? ["option-order", "state-key-order", "normalized-whitespace"];
  const maxCalls = options.maxCalls ?? 100;
  const violations: FuzzViolation[] = [];
  let calls = 0;
  let mutationsRun = 0;
  for (const row of rows) {
    if (++calls > maxCalls) throw new Error(`fuzz call budget exceeded (${maxCalls}); increase maxCalls explicitly`);
    const baseline = await executeWorkflow(artifact, row.input, provider, { audit: false, id: row.id });
    for (const mutation of mutations) {
      const mutatedArtifact = mutateArtifact(artifact, mutation, random);
      const inputs = mutateInput(artifact, row.input, mutation, options.irrelevantPaths ?? [], options.irrelevantText ?? "Unrelated note: the dashboard theme is blue.");
      for (const input of inputs) {
        if (++calls > maxCalls) throw new Error(`fuzz call budget exceeded (${maxCalls}); increase maxCalls explicitly`);
        const result = await executeWorkflow(mutatedArtifact, input, provider, { audit: false, id: `${row.id}:${mutation}` });
        mutationsRun += 1;
        if (canonicalJson(result.outcome) !== canonicalJson(baseline.outcome)) {
          const path = mutation === "irrelevant-context"
            ? (options.irrelevantPaths ?? []).find((candidate) => getPath(input, candidate) !== getPath(row.input, candidate))
            : undefined;
          const violation: FuzzViolation = {
            caseId: row.id,
            mutation,
            seed,
            baselineOutcome: baseline.outcome,
            mutatedOutcome: result.outcome,
            baselineAnswers: baseline.answers,
            mutatedAnswers: result.answers,
            minimizedInput: input,
          };
          if (path) violation.path = path;
          violations.push(violation);
        }
      }
    }
  }
  return {
    version: 1,
    workflowFingerprint: artifact.fingerprint,
    generatedAt: new Date().toISOString(),
    seed,
    cases: rows.length,
    calls,
    mutationsRun,
    violations,
    passed: violations.length === 0,
  };
}
