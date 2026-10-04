import test from "node:test";
import assert from "node:assert/strict";
import { compileWorkflow } from "../src/compiler.js";
import { generateEgressKeyPair } from "../src/egress.js";
import {
  certifyDecisionSlo,
  compareDecisionCertificates,
  exactBinomialUpperBound,
  gateDecision,
  monitorDecisionSlo,
  signDecisionCertificate,
  validateDecisionCertificate,
  verifyDecisionCertificateSignature,
} from "../src/slo.js";
import type { DecisionSloRow, WorkflowSpec } from "../src/types.js";

const artifact = compileWorkflow({
  version: 1,
  name: "decision-slo-test",
  policyVersion: "2026-10-04",
  model: "jev-model",
  input: { message: { type: "string", required: true } },
  state: { include: ["message"] },
  questions: { approve: { type: "noul", instructions: "Approve?" } },
  routing: { rules: [], default: { action: "human_review" } },
} satisfies WorkflowSpec);

function rows(selectedPerHalf = 80): DecisionSloRow[] {
  return Array.from({ length: 200 }, (_, index) => {
    const position = index % 100;
    const selected = position < selectedPerHalf;
    return {
      id: `decision-${index}`,
      action: selected ? "auto_approve" : "human_review",
      score: selected ? 0.95 : 0.4,
      correct: true,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      slices: { region: position % 2 ? "west" : "east" },
    };
  });
}

function certificate(selectedPerHalf = 80) {
  return certifyDecisionSlo(artifact, rows(selectedPerHalf), {
    action: "auto_approve",
    maxRisk: 0.05,
    confidence: 0.95,
    minimumCoverage: 0.5,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

test("exact one-sided Clopper-Pearson bound matches the zero-error closed form", () => {
  const expected = 1 - 0.05 ** (1 / 100);
  assert.ok(Math.abs(exactBinomialUpperBound(0, 100, 0.95) - expected) < 1e-12);
  assert.equal(exactBinomialUpperBound(10, 10, 0.95), 1);
});

test("certification calibrates on one split and certifies on the fixed holdout", () => {
  const result = certificate();
  assert.equal(result.status, "certified");
  assert.equal(result.slo.threshold, 0.95);
  assert.equal(result.evidence.calibration?.selected, 80);
  assert.equal(result.evidence.validation?.selected, 80);
  assert.equal(result.evidence.validation?.errors, 0);
  assert.equal(result.evidence.familyWiseConfidence, 0.95);
  assert.equal(validateDecisionCertificate(structuredClone(result)).certificateId, result.certificateId);
});

test("slice claims use a family-wise correction and require enough evidence", () => {
  const result = certifyDecisionSlo(artifact, rows(), {
    action: "auto_approve",
    maxRisk: 0.12,
    confidence: 0.95,
    minimumCoverage: 0.5,
    slices: ["region"],
    minSliceSize: 30,
  });
  assert.equal(result.status, "certified");
  assert.equal(result.evidence.slices.length, 2);
  assert.ok(result.evidence.slices.every((slice) => slice.confidence > 0.95 && slice.eligible));
});

test("certificates sign, verify, gate matching decisions, and fail closed", () => {
  const result = certificate();
  const keys = generateEgressKeyPair();
  const signed = signDecisionCertificate(result, keys.privateKey);
  assert.equal(verifyDecisionCertificateSignature(signed, keys.publicKey), true);
  assert.equal(verifyDecisionCertificateSignature(signed, `${keys.publicKey.trim()}\n\n`), true);

  const permit = gateDecision(result, { workflowFingerprint: artifact.fingerprint, action: "auto_approve", score: 0.96 }, { now: "2026-01-02T00:00:00Z", requireSignature: true, signatureValid: true });
  assert.equal(permit.decision, "permit");
  const review = gateDecision(result, { workflowFingerprint: "wrong", action: "auto_approve", score: 0.96 }, { now: "2027-01-01T00:00:00Z", requireSignature: true, signatureValid: false });
  assert.equal(review.decision, "review");
  assert.match(review.reasons.join(" "), /expired/);
  assert.match(review.reasons.join(" "), /fingerprint/);
  assert.match(review.reasons.join(" "), /signature/);
  const early = gateDecision(result, { workflowFingerprint: artifact.fingerprint, action: "auto_approve", score: 0.96 }, { now: "2025-12-31T00:00:00Z" });
  assert.equal(early.decision, "review");
  assert.match(early.reasons.join(" "), /not yet valid/);

  const tampered = structuredClone(signed);
  tampered.signature.value = `${tampered.signature.value.slice(0, -2)}AA`;
  assert.equal(verifyDecisionCertificateSignature(tampered, keys.publicKey), false);
});

test("certification rejects duplicate evidence and reports insufficient samples", () => {
  assert.throws(() => certifyDecisionSlo(artifact, [rows()[0]!, rows()[0]!], {
    action: "auto_approve",
    maxRisk: 0.1,
  }), /duplicated/);
  const result = certifyDecisionSlo(artifact, rows(2), {
    action: "auto_approve",
    maxRisk: 0.05,
    minimumCoverage: 0,
  });
  assert.equal(result.status, "insufficient");
});

test("monitor revokes only after sequential evidence of a breach", () => {
  const result = certificate();
  const healthy = rows().slice(0, 40).map((row) => ({ ...row, action: "auto_approve", score: 0.95, correct: true }));
  assert.equal(monitorDecisionSlo(result, healthy).status, "healthy");

  const harmful = Array.from({ length: 200 }, (_, index): DecisionSloRow => ({
    id: `harmful-${index}`,
    action: "auto_approve",
    score: 0.99,
    correct: index % 2 === 0,
  }));
  const report = monitorDecisionSlo(result, harmful);
  assert.equal(report.status, "revoke");
  assert.ok(report.firstBreachAt !== null);
});

test("certificate comparison flags lost certified coverage", () => {
  const comparison = compareDecisionCertificates(certificate(80), certificate(60));
  assert.equal(comparison.regression, true);
  assert.ok((comparison.coverage as { delta: number }).delta < 0);
});
