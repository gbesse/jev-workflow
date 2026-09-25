import test from "node:test";
import assert from "node:assert/strict";
import { compileWorkflow } from "../src/compiler.js";
import { createEgressPlan, generateEgressKeyPair, signEgressPlan, verifyEgressManifest } from "../src/egress.js";
import type { WorkflowSpec } from "../src/types.js";

const base: WorkflowSpec = {
  version: 1,
  name: "egress-test",
  policyVersion: "1",
  input: { "customer.email": { type: "string", required: true }, message: { type: "string", required: true } },
  state: { include: ["customer.email", "message"] },
  questions: { safe: { type: "noul", instructions: "Is this safe?" } },
  routing: { rules: [], default: { action: "review" } },
};

test("egress rejects denied or unclassified fields and signs an immutable manifest", () => {
  const artifact = compileWorkflow({
    ...base,
    egress: {
      allow: ["message"],
      deny: ["customer"],
      classifications: { message: "internal", "customer.email": "personal" },
      allowClassifications: ["internal"],
      requireExplicitClassification: true,
      destination: { service: "typesafe", region: "eu" },
      requiredRegion: "eu",
    },
  });
  const plan = createEgressPlan(artifact, { customer: { email: "person@example.com" }, message: "hello" }, "2026-09-25T10:00:00Z");
  assert.equal(plan.permitted, false);
  assert.match(plan.violations.join(" "), /customer.email/);
  const keys = generateEgressKeyPair();
  const signed = signEgressPlan(plan, keys.privateKey);
  assert.equal(verifyEgressManifest(signed, keys.publicKey), true);
  signed.plan.fields[0]!.path = "tampered";
  assert.equal(verifyEgressManifest(signed, keys.publicKey), false);
});
