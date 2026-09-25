import test from "node:test";
import assert from "node:assert/strict";
import { compileWorkflow } from "../src/compiler.js";
import { fuzzWorkflow } from "../src/fuzz.js";
import type { DecisionProvider, WorkflowSpec } from "../src/types.js";

const spec: WorkflowSpec = {
  version: 1,
  name: "fuzz-test",
  policyVersion: "1",
  input: { message: { type: "string", required: true } },
  state: { include: ["message"] },
  questions: {
    route: {
      type: "choice",
      instructions: "Choose a route from the content, independent of option order.",
      criteria: { alpha: "Alpha", beta: "Beta", other: "Other" },
    },
  },
  routing: {
    rules: [{ id: "alpha", when: { path: "answers.route.choice", op: "eq", value: "alpha" }, outcome: { queue: "alpha" }, reason: "alpha selected" }],
    default: { queue: "other" },
  },
};

const orderBiasedProvider: DecisionProvider = {
  async decide(request) {
    const labels = Object.keys(request.questions.route!.type === "choice" ? request.questions.route!.criteria : {});
    const choice = labels[0]!;
    return {
      model: request.model,
      answers: { route: { type: "choice", choice, confidence: 0.9, probabilities: Object.fromEntries(labels.map((label, index) => [label, index === 0 ? 0.8 : 0.1])) } },
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  },
};

test("fuzzer detects an option-order invariant violation", async () => {
  const report = await fuzzWorkflow(compileWorkflow(spec), [{ id: "one", input: { message: "alpha" }, labels: {} }], orderBiasedProvider, { mutations: ["option-order"], seed: 7, maxCalls: 2 });
  assert.equal(report.passed, false);
  assert.equal(report.violations[0]?.mutation, "option-order");
  assert.notDeepEqual(report.violations[0]?.baselineOutcome, report.violations[0]?.mutatedOutcome);
});
