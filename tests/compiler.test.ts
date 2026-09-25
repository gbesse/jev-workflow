import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileWorkflow, lintWorkflow, loadWorkflowSpec, validateCompiledWorkflow } from "../src/compiler.js";

const policy = new URL("../packs/sav-fr/policy.yaml", import.meta.url).pathname;

test("compile produces a deterministic, tamper-evident artifact", async () => {
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

test("SAV dataset is explicitly synthetic-sized and parseable JSONL", async () => {
  const lines = (await readFile(new URL("../packs/sav-fr/dataset.jsonl", import.meta.url), "utf8")).trim().split("\n");
  assert.equal(lines.length, 18);
  assert.ok(lines.every((line) => JSON.parse(line).labels.service));
});
