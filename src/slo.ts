import { createHash, createPublicKey, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  CompiledWorkflow,
  DecisionCertificate,
  DecisionGateInput,
  DecisionGateResult,
  DecisionMonitorReport,
  DecisionSloRow,
  JsonObject,
  JsonValue,
  RiskEvidence,
  SignedDecisionCertificate,
  SliceRiskEvidence,
} from "./types.js";
import { canonicalJson, isJsonValue, isObject, sha256 } from "./utils.js";

export interface CertificationOptions {
  action: string;
  maxRisk: number;
  confidence?: number;
  minimumCoverage?: number;
  calibrationFraction?: number;
  split?: "ordered" | "time";
  slices?: string[];
  minSliceSize?: number;
  validityDays?: number;
  createdAt?: string;
}

function assertProbability(value: number, name: string, exclusive = false): void {
  if (!Number.isFinite(value) || value < 0 || value > 1 || (exclusive && (value === 0 || value === 1))) {
    throw new Error(`${name} must be ${exclusive ? "strictly " : ""}between 0 and 1`);
  }
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 300;
  const epsilon = 3e-14;
  const floor = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < floor) d = floor;
  d = 1 / d;
  let h = d;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const twice = 2 * iteration;
    let aa = (iteration * (b - iteration) * x) / ((qam + twice) * (a + twice));
    d = 1 + aa * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + aa / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    h *= d * c;
    aa = -((a + iteration) * (qab + iteration) * x) / ((a + twice) * (qap + twice));
    d = 1 + aa * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + aa / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) return h;
  }
  throw new Error("incomplete beta calculation did not converge");
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019571e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let x = 0.9999999999998099;
  const shifted = value - 1;
  coefficients.forEach((coefficient, index) => { x += coefficient / (shifted + index + 1); });
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2)
    ? (factor * betaContinuedFraction(a, b, x)) / a
    : 1 - (factor * betaContinuedFraction(b, a, 1 - x)) / b;
}

export function exactBinomialUpperBound(errors: number, trials: number, confidence: number): number {
  if (!Number.isInteger(errors) || !Number.isInteger(trials) || errors < 0 || trials < 1 || errors > trials) throw new Error("errors and trials must be valid non-negative counts");
  assertProbability(confidence, "confidence", true);
  if (errors === trials) return 1;
  const alpha = 1 - confidence;
  let low = errors / trials;
  let high = 1;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midpoint = (low + high) / 2;
    const cdf = regularizedIncompleteBeta(1 - midpoint, trials - errors, errors + 1);
    if (cdf > alpha) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}

function evidence(rows: DecisionSloRow[], action: string, threshold: number, confidence: number): RiskEvidence {
  const selectedRows = rows.filter((row) => row.action === action && row.score >= threshold);
  const errors = selectedRows.filter((row) => !row.correct).length;
  return {
    rows: rows.length,
    selected: selectedRows.length,
    errors,
    coverage: rows.length ? selectedRows.length / rows.length : 0,
    empiricalRisk: selectedRows.length ? errors / selectedRows.length : null,
    upperRiskBound: selectedRows.length ? exactBinomialUpperBound(errors, selectedRows.length, confidence) : null,
    confidence,
  };
}

function validateRow(raw: unknown, index: number): DecisionSloRow {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id.length === 0) throw new Error(`decision row ${index}.id must be a non-empty string`);
  if (typeof raw.action !== "string" || raw.action.length === 0) throw new Error(`decision row ${index}.action must be a non-empty string`);
  if (typeof raw.score !== "number" || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > 1) throw new Error(`decision row ${index}.score must be between 0 and 1`);
  if (typeof raw.correct !== "boolean") throw new Error(`decision row ${index}.correct must be boolean`);
  if (raw.timestamp !== undefined && (typeof raw.timestamp !== "string" || !Number.isFinite(Date.parse(raw.timestamp)))) throw new Error(`decision row ${index}.timestamp must be an ISO datetime`);
  let slices: Record<string, string> | undefined;
  if (raw.slices !== undefined) {
    if (!isObject(raw.slices) || !Object.values(raw.slices).every((value) => typeof value === "string")) throw new Error(`decision row ${index}.slices must contain string values`);
    slices = raw.slices as Record<string, string>;
  }
  return { id: raw.id, action: raw.action, score: raw.score, correct: raw.correct, ...(raw.timestamp ? { timestamp: raw.timestamp } : {}), ...(slices ? { slices } : {}) };
}

export async function loadDecisionSloDataset(path: string): Promise<DecisionSloRow[]> {
  const text = await readFile(path, "utf8");
  const raw: unknown = path.endsWith(".jsonl")
    ? text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as unknown)
    : JSON.parse(text);
  if (!Array.isArray(raw) || raw.length < 2) throw new Error("decision dataset must contain at least two rows");
  const ids = new Set<string>();
  return raw.map((item, index) => {
    const row = validateRow(item, index);
    if (ids.has(row.id)) throw new Error(`decision row ${index}.id is duplicated: ${row.id}`);
    ids.add(row.id);
    return row;
  });
}

function certificateHash(value: Omit<DecisionCertificate, "certificateId">): string {
  return sha256(value as unknown as JsonValue);
}

export function validateDecisionCertificate(value: unknown): DecisionCertificate {
  if (!isObject(value) || value.version !== 1 || typeof value.certificateId !== "string") throw new Error("invalid decision certificate envelope");
  const certificate = value as unknown as DecisionCertificate;
  const { certificateId, ...unsigned } = certificate;
  if (!isJsonValue(unsigned) || certificateHash(unsigned) !== certificateId) throw new Error("decision certificate checksum mismatch");
  if (!certificate.workflow?.name || !certificate.workflow.policyVersion || !certificate.workflow.fingerprint || !certificate.workflow.model) throw new Error("decision certificate workflow is incomplete");
  if (!certificate.slo || !certificate.dataset || !certificate.evidence) throw new Error("decision certificate is incomplete");
  if (!["certified", "rejected", "insufficient"].includes(certificate.status)) throw new Error("decision certificate status is invalid");
  if (!certificate.slo.action) throw new Error("decision certificate action is missing");
  assertProbability(certificate.slo.maxRisk, "certificate maxRisk");
  assertProbability(certificate.slo.confidence, "certificate confidence", true);
  assertProbability(certificate.slo.minimumCoverage, "certificate minimumCoverage");
  if (certificate.slo.threshold !== null) assertProbability(certificate.slo.threshold, "certificate threshold");
  if (!Array.isArray(certificate.slo.slices) || !certificate.slo.slices.every((item) => typeof item === "string")) throw new Error("decision certificate slices are invalid");
  if (!Number.isInteger(certificate.slo.minSliceSize) || certificate.slo.minSliceSize < 1) throw new Error("decision certificate minSliceSize is invalid");
  if (![certificate.dataset.rows, certificate.dataset.calibrationRows, certificate.dataset.validationRows].every((count) => Number.isInteger(count) && count > 0)) throw new Error("decision certificate dataset counts are invalid");
  if (certificate.dataset.calibrationRows + certificate.dataset.validationRows !== certificate.dataset.rows) throw new Error("decision certificate dataset counts do not add up");
  if (!["ordered", "time"].includes(certificate.dataset.split)) throw new Error("decision certificate split is invalid");
  if (!Array.isArray(certificate.evidence.slices) || !Array.isArray(certificate.reasons)) throw new Error("decision certificate evidence is invalid");
  if (!Number.isFinite(Date.parse(certificate.createdAt)) || !Number.isFinite(Date.parse(certificate.expiresAt))) throw new Error("decision certificate timestamps are invalid");
  if (Date.parse(certificate.expiresAt) <= Date.parse(certificate.createdAt)) throw new Error("decision certificate expiry must follow creation");
  return certificate;
}

function splitRows(rows: DecisionSloRow[], fraction: number, mode: "ordered" | "time"): [DecisionSloRow[], DecisionSloRow[]] {
  const ordered = [...rows];
  if (mode === "time") {
    if (ordered.some((row) => !row.timestamp)) throw new Error("time split requires a timestamp on every row");
    ordered.sort((left, right) => Date.parse(left.timestamp!) - Date.parse(right.timestamp!) || left.id.localeCompare(right.id));
  }
  const boundary = Math.max(1, Math.min(ordered.length - 1, Math.floor(ordered.length * fraction)));
  return [ordered.slice(0, boundary), ordered.slice(boundary)];
}

export function certifyDecisionSlo(artifact: CompiledWorkflow, inputRows: DecisionSloRow[], options: CertificationOptions): DecisionCertificate {
  if (!options.action) throw new Error("action is required");
  assertProbability(options.maxRisk, "maxRisk");
  const confidence = options.confidence ?? 0.95;
  const minimumCoverage = options.minimumCoverage ?? 0;
  const calibrationFraction = options.calibrationFraction ?? 0.5;
  assertProbability(confidence, "confidence", true);
  assertProbability(minimumCoverage, "minimumCoverage");
  assertProbability(calibrationFraction, "calibrationFraction", true);
  const split = options.split ?? "ordered";
  if (split !== "ordered" && split !== "time") throw new Error("split must be ordered or time");
  const slices = [...new Set(options.slices ?? [])].sort();
  const minSliceSize = options.minSliceSize ?? 20;
  if (!Number.isInteger(minSliceSize) || minSliceSize < 1) throw new Error("minSliceSize must be a positive integer");
  const rows = inputRows.map((row, index) => validateRow(row, index));
  if (rows.length < 2) throw new Error("decision dataset must contain at least two rows");
  const ids = new Set<string>();
  rows.forEach((row, index) => {
    if (ids.has(row.id)) throw new Error(`decision row ${index}.id is duplicated: ${row.id}`);
    ids.add(row.id);
  });
  const [calibrationRows, validationRows] = splitRows(rows, calibrationFraction, split);
  const thresholds = [...new Set(calibrationRows.filter((row) => row.action === options.action).map((row) => row.score))].sort((a, b) => a - b);
  let threshold: number | null = null;
  let calibrationEvidence: RiskEvidence | null = null;
  for (const candidate of thresholds) {
    const candidateEvidence = evidence(calibrationRows, options.action, candidate, confidence);
    if ((candidateEvidence.upperRiskBound ?? 1) <= options.maxRisk && candidateEvidence.coverage >= minimumCoverage) {
      threshold = candidate;
      calibrationEvidence = candidateEvidence;
      break;
    }
  }

  const createdAt = options.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("createdAt must be an ISO datetime");
  const validityDays = options.validityDays ?? 30;
  if (!Number.isFinite(validityDays) || validityDays <= 0) throw new Error("validityDays must be positive");
  const expiresAt = new Date(Date.parse(createdAt) + validityDays * 86_400_000).toISOString();
  const reasons: string[] = [];
  let validationEvidence: RiskEvidence | null = null;
  const sliceEvidence: SliceRiskEvidence[] = [];
  let status: DecisionCertificate["status"] = "certified";

  if (threshold === null) {
    status = "insufficient";
    reasons.push("no threshold satisfied the risk and coverage requirements on the calibration split");
  } else {
    const groups = slices.flatMap((field) => [...new Set(validationRows.map((row) => row.slices?.[field]).filter((value): value is string => value !== undefined))].map((value) => ({ field, value })));
    const adjustedConfidence = 1 - (1 - confidence) / (groups.length + 1);
    validationEvidence = evidence(validationRows, options.action, threshold, adjustedConfidence);
    for (const group of groups) {
      const groupRows = validationRows.filter((row) => row.slices?.[group.field] === group.value);
      const result = evidence(groupRows, options.action, threshold, adjustedConfidence);
      sliceEvidence.push({ ...result, field: group.field, value: group.value, eligible: result.selected >= minSliceSize });
    }
    if (validationEvidence.selected === 0) {
      status = "insufficient";
      reasons.push("the validation split contains no selected decisions at the calibrated threshold");
    } else if ((validationEvidence.upperRiskBound ?? 1) > options.maxRisk) {
      status = "rejected";
      reasons.push("the validation risk bound exceeds the SLO");
    }
    if (validationEvidence.coverage < minimumCoverage) {
      status = "rejected";
      reasons.push("validation coverage is below the required minimum");
    }
    for (const result of sliceEvidence) {
      if (!result.eligible) {
        if (status === "certified") status = "insufficient";
        reasons.push(`slice ${result.field}=${result.value} has fewer than ${minSliceSize} selected decisions`);
      } else if ((result.upperRiskBound ?? 1) > options.maxRisk) {
        status = "rejected";
        reasons.push(`slice ${result.field}=${result.value} exceeds the risk SLO`);
      }
    }
    if (status === "certified") reasons.push("fixed holdout evidence satisfies the configured risk and coverage requirements");
  }

  const unsigned: Omit<DecisionCertificate, "certificateId"> = {
    version: 1,
    createdAt,
    expiresAt,
    status,
    workflow: { name: artifact.name, policyVersion: artifact.policyVersion, fingerprint: artifact.fingerprint, model: artifact.model },
    slo: { action: options.action, maxRisk: options.maxRisk, confidence, minimumCoverage, threshold, slices, minSliceSize },
    dataset: { sha256: sha256(rows as unknown as JsonValue), rows: rows.length, calibrationRows: calibrationRows.length, validationRows: validationRows.length, split },
    evidence: {
      calibration: calibrationEvidence,
      validation: validationEvidence,
      slices: sliceEvidence,
      familyWiseConfidence: confidence,
    },
    reasons,
  };
  return { ...unsigned, certificateId: certificateHash(unsigned) };
}

function publicKeyFingerprint(key: string): string {
  return createHash("sha256").update(createPublicKey(key).export({ type: "spki", format: "der" })).digest("hex");
}

export function signDecisionCertificate(certificate: DecisionCertificate, privateKey: string): SignedDecisionCertificate {
  validateDecisionCertificate(certificate);
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  return {
    certificate,
    signature: {
      algorithm: "Ed25519",
      value: sign(null, Buffer.from(canonicalJson(certificate as unknown as JsonValue)), privateKey).toString("base64"),
      publicKeyFingerprint: publicKeyFingerprint(publicKey),
    },
  };
}

export function verifyDecisionCertificateSignature(value: SignedDecisionCertificate, publicKey: string): boolean {
  try {
    const certificate = validateDecisionCertificate(value.certificate);
    if (value.signature.algorithm !== "Ed25519" || value.signature.publicKeyFingerprint !== publicKeyFingerprint(publicKey)) return false;
    return verify(null, Buffer.from(canonicalJson(certificate as unknown as JsonValue)), publicKey, Buffer.from(value.signature.value, "base64"));
  } catch {
    return false;
  }
}

export function unwrapDecisionCertificate(value: unknown): { certificate: DecisionCertificate; signed: SignedDecisionCertificate | null } {
  if (isObject(value) && "certificate" in value && "signature" in value) {
    const signed = value as unknown as SignedDecisionCertificate;
    return { certificate: validateDecisionCertificate(signed.certificate), signed };
  }
  return { certificate: validateDecisionCertificate(value), signed: null };
}

export function gateDecision(
  certificate: DecisionCertificate,
  input: DecisionGateInput,
  options: { now?: string; signatureValid?: boolean; requireSignature?: boolean } = {},
): DecisionGateResult {
  validateDecisionCertificate(certificate);
  if (!isObject(input as unknown) || typeof input.workflowFingerprint !== "string" || typeof input.action !== "string" || typeof input.score !== "number") {
    throw new Error("decision must contain workflowFingerprint, action, and numeric score");
  }
  const reasons: string[] = [];
  const now = Date.parse(options.now ?? new Date().toISOString());
  if (!Number.isFinite(now)) reasons.push("current time is invalid");
  if (certificate.status !== "certified") reasons.push(`certificate status is ${certificate.status}`);
  if (now < Date.parse(certificate.createdAt)) reasons.push("certificate is not yet valid");
  if (now >= Date.parse(certificate.expiresAt)) reasons.push("certificate has expired");
  if (input.workflowFingerprint !== certificate.workflow.fingerprint) reasons.push("workflow fingerprint does not match the certificate");
  if (input.action !== certificate.slo.action) reasons.push("action does not match the certified action");
  if (!Number.isFinite(input.score) || input.score < 0 || input.score > 1) reasons.push("score must be between 0 and 1");
  if (certificate.slo.threshold === null || input.score < certificate.slo.threshold) reasons.push("score is below the certified threshold");
  if (options.requireSignature && options.signatureValid !== true) reasons.push("a valid certificate signature is required");
  return {
    decision: reasons.length ? "review" : "permit",
    certificateId: certificate.certificateId,
    reasons: reasons.length ? reasons : ["decision satisfies the active certificate"],
    threshold: certificate.slo.threshold,
    score: input.score,
  };
}

export function monitorDecisionSlo(certificate: DecisionCertificate, rows: DecisionSloRow[]): DecisionMonitorReport {
  validateDecisionCertificate(certificate);
  const validatedRows = rows.map((row, index) => validateRow(row, index));
  const selected = validatedRows.filter((row) => row.action === certificate.slo.action && certificate.slo.threshold !== null && row.score >= certificate.slo.threshold);
  const delta = 1 - certificate.slo.confidence;
  let errors = 0;
  let maximumLower = 0;
  let firstBreachAt: number | null = null;
  selected.forEach((row, index) => {
    if (!row.correct) errors += 1;
    const time = index + 1;
    const deltaAtTime = (6 * delta) / (Math.PI ** 2 * time ** 2);
    const radius = Math.sqrt(Math.log(1 / deltaAtTime) / (2 * time));
    const lower = Math.max(0, errors / time - radius);
    maximumLower = Math.max(maximumLower, lower);
    if (firstBreachAt === null && lower > certificate.slo.maxRisk) firstBreachAt = time;
  });
  const reasons: string[] = [];
  let status: DecisionMonitorReport["status"] = "healthy";
  if (firstBreachAt !== null) {
    status = "revoke";
    reasons.push(`the anytime-valid lower risk bound crossed the SLO after ${firstBreachAt} observed decisions`);
  } else if (selected.length < 30) {
    status = "warning";
    reasons.push("fewer than 30 newly labeled selected decisions are available; no breach is established");
  } else if (errors / selected.length > certificate.slo.maxRisk) {
    status = "warning";
    reasons.push("empirical risk exceeds the SLO but the sequential breach boundary has not been crossed");
  } else {
    reasons.push("no sequential evidence of an SLO breach was found");
  }
  return {
    version: 1,
    certificateId: certificate.certificateId,
    status,
    observed: selected.length,
    errors,
    empiricalRisk: selected.length ? errors / selected.length : null,
    anytimeLowerBound: selected.length ? maximumLower : null,
    maxRisk: certificate.slo.maxRisk,
    confidence: certificate.slo.confidence,
    firstBreachAt,
    reasons,
  };
}

export function compareDecisionCertificates(baseline: DecisionCertificate, candidate: DecisionCertificate): JsonObject {
  validateDecisionCertificate(baseline);
  validateDecisionCertificate(candidate);
  const baselineCoverage = baseline.evidence.validation?.coverage ?? 0;
  const candidateCoverage = candidate.evidence.validation?.coverage ?? 0;
  const baselineRisk = baseline.evidence.validation?.upperRiskBound ?? 1;
  const candidateRisk = candidate.evidence.validation?.upperRiskBound ?? 1;
  const regressions: string[] = [];
  if (candidate.status !== "certified") regressions.push(`candidate status is ${candidate.status}`);
  if (candidate.slo.maxRisk > baseline.slo.maxRisk) regressions.push("maximum allowed risk was relaxed");
  if (candidate.slo.confidence < baseline.slo.confidence) regressions.push("confidence requirement was reduced");
  if (candidate.slo.minimumCoverage < baseline.slo.minimumCoverage) regressions.push("minimum coverage requirement was reduced");
  if (baseline.status === "certified" && candidateCoverage < baselineCoverage) regressions.push("validated coverage decreased");
  if (baseline.status === "certified" && candidateRisk > baselineRisk) regressions.push("validated upper risk bound increased");
  return {
    baseline: baseline.certificateId,
    candidate: candidate.certificateId,
    sameWorkflow: baseline.workflow.fingerprint === candidate.workflow.fingerprint,
    status: { before: baseline.status, after: candidate.status },
    threshold: { before: baseline.slo.threshold, after: candidate.slo.threshold },
    coverage: { before: baselineCoverage, after: candidateCoverage, delta: candidateCoverage - baselineCoverage },
    upperRiskBound: { before: baselineRisk, after: candidateRisk, delta: candidateRisk - baselineRisk },
    regression: regressions.length > 0,
    regressions,
  };
}
