import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { validateWorkflowSpec } from "./schema.js";
import type { CompiledWorkflow, JsonObject, LintFinding, Question, WorkflowSpec } from "./types.js";
import { sha256 } from "./utils.js";

const COMPILER = "jev-workflow@0.2.0" as const;

export async function loadWorkflowSpec(path: string): Promise<WorkflowSpec> {
  const text = await readFile(path, "utf8");
  const raw: unknown = path.endsWith(".json") ? JSON.parse(text) : parse(text);
  validateWorkflowSpec(raw);
  return raw;
}

function instructionText(question: WorkflowSpec["questions"][string]): string {
  return typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions ?? "");
}

export function lintWorkflow(spec: WorkflowSpec): LintFinding[] {
  const findings: LintFinding[] = [];
  const derived = new Set([
    ...(spec.preflight?.dates ?? []).map((rule) => rule.id),
    ...(spec.preflight?.comparisons ?? []).map((rule) => rule.id),
  ]);
  const inputPaths = new Set(Object.keys(spec.input));
  for (const path of spec.state.include) {
    if (!inputPaths.has(path) && ![...inputPaths].some((candidate) => candidate.startsWith(`${path}.`))) {
      findings.push({ code: "W001", severity: "warning", location: "state.include", message: `${path} is not declared in input` });
    }
  }
  for (const [id, question] of Object.entries(spec.questions)) {
    const text = instructionText(question).toLowerCase();
    if (/\b(ne\s+\w+\s+pas|n['’]est\s+pas|double négation|not\s+.*\bnot\b|unless)\b/i.test(text)) {
      findings.push({ code: "J001", severity: "warning", location: `questions.${id}`, message: "negative or indirect wording can be read literally; prefer a positive atomic condition" });
    }
    if (/\b(calcul|addition|somme|compter|combien|durée|jours? écoulés?|date|sum|count|earlier|later|date window)\b/i.test(text) && !text.includes("_derived")) {
      findings.push({ code: "J002", severity: "warning", location: `questions.${id}`, message: "arithmetic, counts, and date comparisons belong in preflight code" });
    }
    if ((text.match(/\b(et|ou|and|or)\b/g) ?? []).length >= 2) {
      findings.push({ code: "J003", severity: "info", location: `questions.${id}`, message: "the instruction may combine several judgments; consider splitting it" });
    }
    if (question.type === "choice") {
      const labels = Object.keys(question.criteria).map((label) => label.toLowerCase());
      if (!labels.some((label) => ["other", "unknown", "autre", "inconnu", "not_applicable"].includes(label))) {
        findings.push({ code: "J004", severity: "info", location: `questions.${id}.criteria`, message: "closed choices often need an explicit other or unknown outcome" });
      }
    }
    if (!question.guard) {
      findings.push({ code: "J005", severity: "info", location: `questions.${id}.guard`, message: "no workflow-specific uncertainty guard is configured" });
    }
  }
  for (const rule of spec.preflight?.dates ?? []) {
    if (!inputPaths.has(rule.from) || !inputPaths.has(rule.to)) findings.push({ code: "P001", severity: "error", location: `preflight.dates.${rule.id}`, message: "date operands must be declared input fields" });
  }
  for (const rule of spec.preflight?.comparisons ?? []) {
    if (!inputPaths.has(rule.path)) findings.push({ code: "P002", severity: "error", location: `preflight.comparisons.${rule.id}`, message: `${rule.path} is not a declared input field` });
  }
  const duplicateDerived = [...derived].filter((id, index, all) => all.indexOf(id) !== index);
  duplicateDerived.forEach((id) => findings.push({ code: "P003", severity: "error", location: "preflight", message: `duplicate derived field: ${id}` }));
  return findings;
}

export function compileWorkflow(spec: WorkflowSpec): CompiledWorkflow {
  const errors = lintWorkflow(spec).filter((finding) => finding.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((finding) => `${finding.code} ${finding.location}: ${finding.message}`).join("\n"));
  const questions: Record<string, Question> = {};
  const guards: CompiledWorkflow["guards"] = {};
  for (const [id, raw] of Object.entries(spec.questions)) {
    const { guard, ...question } = raw;
    questions[id] = question as Question;
    if (guard) guards[id] = guard;
  }
  const unsigned: Omit<CompiledWorkflow, "fingerprint"> = {
    artifactVersion: 1,
    compiler: COMPILER,
    name: spec.name,
    policyVersion: spec.policyVersion,
    locale: spec.locale ?? "en",
    model: spec.model ?? "jev-latest",
    input: spec.input,
    state: spec.state,
    preflight: spec.preflight ?? {},
    questions,
    guards,
    routing: spec.routing,
    audit: spec.audit ?? { path: ".jev/audit.jsonl", includeInput: false, redact: [] },
    stability: spec.stability,
    egress: spec.egress,
  };
  const fingerprint = sha256(unsigned as unknown as JsonObject);
  return { ...unsigned, fingerprint };
}

export function validateCompiledWorkflow(raw: unknown): CompiledWorkflow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("compiled workflow must be an object");
  const artifact = raw as CompiledWorkflow;
  if (artifact.artifactVersion !== 1 || artifact.compiler !== COMPILER || typeof artifact.fingerprint !== "string") {
    throw new Error("unsupported compiled workflow");
  }
  const { fingerprint, ...unsigned } = artifact;
  const expected = sha256(unsigned as unknown as JsonObject);
  if (fingerprint !== expected) throw new Error("compiled workflow fingerprint mismatch; recompile the policy");
  return artifact;
}

export async function readCompiledWorkflow(path: string): Promise<CompiledWorkflow> {
  return validateCompiledWorkflow(JSON.parse(await readFile(path, "utf8")) as unknown);
}

export async function writeCompiledWorkflow(path: string, artifact: CompiledWorkflow): Promise<void> {
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o644 });
}
