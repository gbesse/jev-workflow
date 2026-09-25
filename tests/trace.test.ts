import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileWorkflow } from "../src/compiler.js";
import { executeWorkflow } from "../src/runtime.js";
import { readDecisionTrace, traceToRegressionCase } from "../src/trace.js";
import type { DecisionProvider, WorkflowSpec } from "../src/types.js";

const spec: WorkflowSpec = {
  version: 1,
  name: "trace-test",
  policyVersion: "1",
  input: { message: { type: "string", required: true } },
  state: { include: ["message"] },
  questions: { relevant: { type: "noul", instructions: "Is it relevant?" } },
  routing: { rules: [], default: { action: "review" } },
};
const provider: DecisionProvider = { async decide(request) { return { model: request.model, answers: { relevant: { type: "noul", noul: 0.8 } }, usage: { input_tokens: 2, output_tokens: 1 } }; } };

test("flight recorder writes a replayable decision trace", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "jev-trace-")), "trace.jsonl");
  const artifact = compileWorkflow(spec);
  await executeWorkflow(artifact, { message: "hello" }, provider, { audit: false, tracePath: path, traceInput: true, id: "incident-1", timestamp: "2026-09-25T10:00:00Z" });
  const trace = await readDecisionTrace(path, "incident-1");
  assert.equal(trace.attributes["jev.workflow.name"], "trace-test");
  const regression = traceToRegressionCase(trace);
  assert.deepEqual(regression.input, { message: "hello" });
});
