import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { runPreflight } from "./preflight.js";
import type {
  Answer,
  CompiledWorkflow,
  EvaluationRow,
  JsonObject,
  Question,
  SystemOneResult,
} from "./types.js";
import { assertJsonObject, isObject, sha256 } from "./utils.js";

export async function loadDataset(path: string): Promise<EvaluationRow[]> {
  const text = await readFile(path, "utf8");
  const values: unknown[] = path.endsWith(".jsonl")
    ? text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown)
    : JSON.parse(text) as unknown[];
  if (!Array.isArray(values)) throw new Error("dataset must be a JSON array or JSONL rows");
  return values.map((raw, index) => {
    if (!isObject(raw) || typeof raw.id !== "string" || !isObject(raw.labels)) throw new Error(`dataset row ${index} is invalid`);
    assertJsonObject(raw.input, `dataset row ${index}.input`);
    const labels: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(raw.labels)) {
      if (!["string", "number", "boolean"].includes(typeof value)) throw new Error(`dataset row ${index}.labels.${key} is invalid`);
      labels[key] = value as string | number | boolean;
    }
    return { id: raw.id, input: raw.input, labels };
  });
}

interface ScoredPrediction {
  id: string;
  correct: boolean;
  confidence: number;
  brier: number;
}

function scoreAnswer(id: string, question: Question, answer: Answer, label: string | number | boolean): ScoredPrediction {
  if (question.type === "choice" && answer.type === "choice") {
    const expected = String(label);
    const brier = Object.keys(question.criteria).reduce((sum, key) => sum + ((answer.probabilities[key] ?? 0) - (key === expected ? 1 : 0)) ** 2, 0);
    return { id, correct: answer.choice === expected, confidence: Math.max(...Object.values(answer.probabilities)), brier };
  }
  if (question.type === "noul" && answer.type === "noul") {
    const expected = Boolean(label);
    const prediction = answer.noul >= 0.5;
    return { id, correct: prediction === expected, confidence: Math.max(answer.noul, 1 - answer.noul), brier: (answer.noul - (expected ? 1 : 0)) ** 2 };
  }
  if (question.type === "score" && answer.type === "score") {
    const expected = Number(label);
    const predicted = Number(Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1])[0]?.[0]);
    const brier = question.criteria.reduce((sum, _, index) => sum + ((answer.probabilities[String(index)] ?? 0) - (index === expected ? 1 : 0)) ** 2, 0);
    return { id, correct: predicted === expected, confidence: Math.max(...Object.values(answer.probabilities)), brier };
  }
  throw new Error(`answer type mismatch for ${id}`);
}

function ece(records: ScoredPrediction[], bins = 10): number {
  if (records.length === 0) return 0;
  let total = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    const low = bin / bins;
    const high = (bin + 1) / bins;
    const rows = records.filter((row) => row.confidence >= low && (bin === bins - 1 ? row.confidence <= high : row.confidence < high));
    if (rows.length === 0) continue;
    const accuracy = rows.filter((row) => row.correct).length / rows.length;
    const confidence = rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length;
    total += (rows.length / records.length) * Math.abs(accuracy - confidence);
  }
  return total;
}

function thresholdReport(records: ScoredPrediction[], targetAccuracy: number) {
  const thresholds = [...new Set(records.map((row) => row.confidence))].sort((a, b) => a - b);
  const candidates = thresholds.map((threshold) => {
    const selected = records.filter((row) => row.confidence >= threshold);
    const accuracy = selected.length ? selected.filter((row) => row.correct).length / selected.length : 0;
    return { threshold, coverage: selected.length / records.length, accuracy, selected: selected.length };
  });
  return candidates.filter((candidate) => candidate.accuracy >= targetAccuracy).sort((a, b) => b.coverage - a.coverage || a.threshold - b.threshold)[0] ?? null;
}

export function evaluatePredictions(
  artifact: CompiledWorkflow,
  rows: EvaluationRow[],
  predictions: Record<string, SystemOneResult>,
  targetAccuracy = 0.95,
): JsonObject {
  const byQuestion: JsonObject = {};
  const all: ScoredPrediction[] = [];
  for (const [questionId, question] of Object.entries(artifact.questions)) {
    const records: ScoredPrediction[] = [];
    for (const row of rows) {
      const label = row.labels[questionId];
      const answer = predictions[row.id]?.answers[questionId];
      if (label === undefined || !answer) continue;
      records.push(scoreAnswer(row.id, question, answer, label));
    }
    all.push(...records);
    const selected = thresholdReport(records, targetAccuracy);
    byQuestion[questionId] = {
      labeled: records.length,
      accuracy: records.length ? records.filter((row) => row.correct).length / records.length : null,
      brier: records.length ? records.reduce((sum, row) => sum + row.brier, 0) / records.length : null,
      ece: ece(records),
      targetAccuracy,
      suggestedThreshold: selected,
      confidentErrors: records.filter((row) => !row.correct && row.confidence >= 0.9).map((row) => row.id),
    };
  }
  return {
    workflow: { name: artifact.name, policyVersion: artifact.policyVersion, fingerprint: artifact.fingerprint },
    dataset: { rows: rows.length, sha256: sha256(rows as unknown as JsonObject) },
    predictions: Object.keys(predictions).length,
    overallAccuracy: all.length ? all.filter((row) => row.correct).length / all.length : null,
    byQuestion,
    warning: rows.length < 100 ? "Small sample: thresholds are exploratory and must not be treated as calibrated production guarantees." : null,
  };
}

export async function exportJevcal(artifact: CompiledWorkflow, rows: EvaluationRow[], outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "questions.yaml"), stringify({ questions: artifact.questions }), "utf8");
  const lines = rows.map((row) => {
    const preflight = runPreflight(artifact, row.input);
    return JSON.stringify({ id: row.id, state: preflight.state, labels: row.labels });
  });
  await writeFile(join(outputDir, "data.jsonl"), `${lines.join("\n")}\n`, "utf8");
  await writeFile(join(outputDir, "README.txt"), [
    "Generated by jev-workflow for jevcal.",
    `Workflow: ${artifact.name}@${artifact.policyVersion}`,
    `Fingerprint: ${artifact.fingerprint}`,
    "Run: jevcal lint --questions questions.yaml --data data.jsonl",
    "Then: jevcal run --questions questions.yaml --data data.jsonl --target 0.95",
    "Labels in this export are not sent as part of state.",
    "",
  ].join("\n"), "utf8");
}

export function parsePredictions(raw: unknown): Record<string, SystemOneResult> {
  if (!isObject(raw)) throw new Error("predictions must be an object keyed by dataset id");
  return raw as unknown as Record<string, SystemOneResult>;
}
