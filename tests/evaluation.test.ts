import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileWorkflow, loadWorkflowSpec } from "../src/compiler.js";
import { evaluatePredictions, exportJevcal, loadDataset } from "../src/evaluation.js";
import type { JsonObject, SystemOneResult } from "../src/types.js";

const root = new URL("../packs/sav-fr/", import.meta.url);
const artifact = compileWorkflow(await loadWorkflowSpec(new URL("policy.yaml", root).pathname));

test("evaluation reports calibration-facing metrics and confident errors", () => {
  const rows = [
    { id: "a", input: {} as JsonObject, labels: { urgent: true } },
    { id: "b", input: {} as JsonObject, labels: { urgent: false } },
  ];
  const result = (id: string, noul: number): SystemOneResult => ({ model: "fixture", answers: { urgent: { type: "noul", noul } }, usage: { input_tokens: 1, output_tokens: 1 } });
  const report = evaluatePredictions(artifact, rows, { a: result("a", 0.95), b: result("b", 0.92) }, 0.9);
  assert.equal(report.overallAccuracy, 0.5);
  const urgent = (report.byQuestion as JsonObject).urgent as JsonObject;
  assert.deepEqual(urgent.confidentErrors, ["b"]);
  assert.match(String(report.warning), /Small sample/);
});

test("evaluation exposes missing prediction coverage and rejects unknown answers", () => {
  const rows = [
    { id: "a", input: {} as JsonObject, labels: { urgent: true } },
    { id: "b", input: {} as JsonObject, labels: { urgent: false } },
  ];
  const partial: SystemOneResult = { model: "fixture", answers: { urgent: { type: "noul", noul: 0.8 } }, usage: { input_tokens: 1, output_tokens: 1 } };
  const report = evaluatePredictions(artifact, rows, { a: partial });
  assert.equal(report.predictionCoverage, 0.5);
  assert.equal(report.labelCoverage, 0.5);
  assert.deepEqual(report.missingPredictions, ["b"]);
  assert.match(String(report.warning), /Missing predictions/);

  const unknown: SystemOneResult = { model: "fixture", answers: { invented: { type: "noul", noul: 0.8 } }, usage: { input_tokens: 1, output_tokens: 1 } };
  assert.throws(() => evaluatePredictions(artifact, rows, { a: unknown }), /unknown question/);
});

test("dataset loading rejects duplicate identifiers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-dataset-"));
  const path = join(directory, "duplicate.jsonl");
  await writeFile(path, '{"id":"same","input":{},"labels":{}}\n{"id":"same","input":{},"labels":{}}\n');
  await assert.rejects(loadDataset(path), /duplicated/);
});

test("export emits jevcal-native questions and state/labels JSONL", async () => {
  const rows = (await loadDataset(new URL("dataset.jsonl", root).pathname)).slice(0, 2);
  const directory = await mkdtemp(join(tmpdir(), "jevcal-export-"));
  await exportJevcal(artifact, rows, directory);
  const questions = await readFile(join(directory, "questions.yaml"), "utf8");
  const data = await readFile(join(directory, "data.jsonl"), "utf8");
  assert.match(questions, /^questions:/);
  assert.match(data, /"state"/);
  assert.match(data, /"labels"/);
  assert.doesNotMatch(data, /"input"/);
});
