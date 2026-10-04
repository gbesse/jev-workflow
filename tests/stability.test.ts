import test from "node:test";
import assert from "node:assert/strict";
import { stabilizeDecision, validateStabilityState } from "../src/stability.js";

test("stability holds jitter until consecutive evidence and dwell time are satisfied", () => {
  const spec = { minConsecutive: 2, minDwellMs: 1_000, cooldownMs: 1_000 };
  const first = stabilizeDecision({ action: "allow" }, undefined, spec, "2026-09-25T10:00:00.000Z");
  const held = stabilizeDecision({ action: "block" }, first.state, spec, "2026-09-25T10:00:00.500Z");
  assert.equal(held.status, "held");
  assert.equal(held.emittedOutcome.action, "allow");
  const switched = stabilizeDecision({ action: "block" }, held.state, spec, "2026-09-25T10:00:01.500Z");
  assert.equal(switched.status, "switched");
  assert.equal(switched.emittedOutcome.action, "block");
});

test("stability rejects corrupt or self-inconsistent persisted state", () => {
  assert.throws(() => validateStabilityState({ stableOutcome: {}, stableSince: "bad", lastChangedAt: "bad", candidateCount: 0 }), /stableSince/);
  assert.throws(() => validateStabilityState({ stableOutcome: {}, stableSince: "2026-09-25T10:00:00Z", lastChangedAt: "2026-09-25T10:00:00Z", candidateCount: 2 }), /inconsistent/);
});

test("stability resets a pending candidate when the stable outcome returns", () => {
  const first = stabilizeDecision({ value: 1 }, undefined, { minConsecutive: 3 }, "2026-09-25T10:00:00Z");
  const held = stabilizeDecision({ value: 2 }, first.state, { minConsecutive: 3 }, "2026-09-25T10:00:01Z");
  const stable = stabilizeDecision({ value: 1 }, held.state, { minConsecutive: 3 }, "2026-09-25T10:00:02Z");
  assert.equal(stable.status, "stable");
  assert.equal(stable.state.candidateCount, 0);
});
