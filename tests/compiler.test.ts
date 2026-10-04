import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileWorkflow, lintWorkflow, loadWorkflowSpec, validateCompiledWorkflow } from "../src/compiler.js";
import { sha256 } from "../src/utils.js";
import type { WorkflowSpec } from "../src/types.js";

const policy = new URL("../packs/sav-fr/policy.yaml", import.meta.url).pathname;

test("compile produces a deterministic, checksummed artifact", async () => {
  const spec = await loadWorkflowSpec(policy);
  const first = compileWorkflow(spec);
  const second = compileWorkflow(spec);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.questions.service!.type, "choice");
  assert.equal((first.questions.service! as { guard?: unknown }).guard, undefined);
  assert.equal(first.guards.service?.minConfidence, 0.72);
  assert.equal(lintWorkflow(spec).filter((finding) => finding.severity === "error").length, 0);
  assert.equal(validateCompiledWorkflow(structuredClone(first)).fingerprint, first.fingerprint);
  const changed = structuredClone(first);
  changed.model = "jev-latest";
  assert.throws(() => validateCompiledWorkflow(changed), /fingerprint mismatch/);
});

test("compiled artifacts are structurally revalidated even with a recomputed checksum", async () => {
  const malformed = structuredClone(compileWorkflow(await loadWorkflowSpec(policy))) as unknown as Record<string, unknown>;
  malformed.routing = { rules: "not-an-array", default: {} };
  const { fingerprint: _old, ...unsigned } = malformed;
  malformed.fingerprint = sha256(unsigned as never);
  assert.throws(() => validateCompiledWorkflow(malformed), /requires rules/);
});

test("state selection cannot include an undeclared parent and leak sibling fields", async () => {
  const spec = structuredClone(await loadWorkflowSpec(policy));
  spec.state.include = ["ticket"];
  assert.throws(() => compileWorkflow(spec), /P004.*exact input field/);

  const objectSpec: WorkflowSpec = {
    version: 1,
    name: "object-subset",
    policyVersion: "1",
    input: { ticket: { type: "object", required: true } },
    state: { include: ["ticket.message"] },
    questions: { route: { type: "noul", instructions: "Relevant?" } },
    routing: { rules: [], default: { action: "review" } },
  };
  assert.doesNotThrow(() => compileWorkflow(objectSpec));
});

test("policy identifiers cannot alias object prototype properties", async () => {
  const spec = structuredClone(await loadWorkflowSpec(policy));
  spec.questions = JSON.parse('{"constructor":{"type":"noul","instructions":"Unsafe"}}');
  assert.throws(() => compileWorkflow(spec), /unsafe path segment/);
});

test("SAV dataset is explicitly synthetic-sized and parseable JSONL", async () => {
  const lines = (await readFile(new URL("../packs/sav-fr/dataset.jsonl", import.meta.url), "utf8")).trim().split("\n");
  assert.equal(lines.length, 18);
  assert.ok(lines.every((line) => JSON.parse(line).labels.service));
});
