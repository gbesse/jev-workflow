import type { JsonObject, StabilityResult, StabilitySpec, StabilityState } from "./types.js";
import { canonicalJson, cloneJson } from "./utils.js";

function sameOutcome(left: JsonObject | undefined, right: JsonObject): boolean {
  return left !== undefined && canonicalJson(left) === canonicalJson(right);
}

export function stabilizeDecision(
  proposedOutcome: JsonObject,
  previous: StabilityState | undefined,
  spec: StabilitySpec,
  now = new Date().toISOString(),
): StabilityResult {
  const instant = Date.parse(now);
  if (!Number.isFinite(instant)) throw new Error("stability timestamp must be an ISO datetime");
  if (!previous) {
    const state: StabilityState = { stableOutcome: cloneJson(proposedOutcome), stableSince: now, lastChangedAt: now, candidateCount: 0 };
    return { status: "initialized", reason: "first observed decision", proposedOutcome, emittedOutcome: cloneJson(proposedOutcome), state };
  }
  if (sameOutcome(previous.stableOutcome, proposedOutcome)) {
    const state = { ...previous, candidateOutcome: undefined, candidateCount: 0 };
    return { status: "stable", reason: "proposal matches the stable outcome", proposedOutcome, emittedOutcome: cloneJson(previous.stableOutcome), state };
  }

  const candidateCount = sameOutcome(previous.candidateOutcome, proposedOutcome) ? previous.candidateCount + 1 : 1;
  const elapsedSinceStable = instant - Date.parse(previous.stableSince);
  const elapsedSinceChange = instant - Date.parse(previous.lastChangedAt);
  const dwellSatisfied = elapsedSinceStable >= (spec.minDwellMs ?? 0);
  const cooldownSatisfied = elapsedSinceChange >= (spec.cooldownMs ?? 0);
  const consecutiveSatisfied = candidateCount >= (spec.minConsecutive ?? 1);

  if (dwellSatisfied && cooldownSatisfied && consecutiveSatisfied) {
    const state: StabilityState = { stableOutcome: cloneJson(proposedOutcome), stableSince: now, lastChangedAt: now, candidateCount: 0 };
    return { status: "switched", reason: `candidate confirmed ${candidateCount} time(s); dwell and cooldown satisfied`, proposedOutcome, emittedOutcome: cloneJson(proposedOutcome), state };
  }
  const blockers = [
    !consecutiveSatisfied ? `${candidateCount}/${spec.minConsecutive ?? 1} confirmations` : null,
    !dwellSatisfied ? "minimum dwell time" : null,
    !cooldownSatisfied ? "cooldown" : null,
  ].filter(Boolean).join(", ");
  const state: StabilityState = { ...previous, candidateOutcome: cloneJson(proposedOutcome), candidateCount };
  return { status: "held", reason: `held stable outcome pending ${blockers}`, proposedOutcome, emittedOutcome: cloneJson(previous.stableOutcome), state };
}
