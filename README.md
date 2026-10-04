# jev-workflow

Evidence-bound decision SLOs, contracts, adversarial testing, flight recording,
temporal stability, and privacy controls for
[TypeSafe Jev](https://typesafe.ai/).

> Early public release. The APIs are usable and tested, but the project has not
> yet been independently security-audited. Jev decisions remain probabilistic;
> permissions and irreversible actions must stay in deterministic code.

```text
historical labeled decisions ──> calibrate ──> fixed holdout
                                             │
                                             └── signed risk certificate
                                                        │
input ──> preflight ──> egress policy ──> Jev ──> bounded routing
                                                        │
                                    fingerprint + score + action
                                                        ▼
                                             certificate gate
                                              │           │
                                           permit       review
```

## Why

The useful contract is not “the model usually answers correctly.” It is:

- exact operations happen in code;
- the data leaving the process is declared and inspectable;
- semantically irrelevant changes do not silently alter an action;
- every decision can be traced and replayed;
- noisy repeated decisions cannot make an actuator flap;
- uncertain results lead to a bounded fallback.
- automated actions consume a finite error budget backed by held-out evidence.

`jev-workflow` compiles that contract from YAML into a fingerprinted artifact.
Compiled artifacts are fully revalidated when loaded; the fingerprint is an
integrity checksum, not a cryptographic signature or authorization mechanism.

## Decision SLO: certify before automating

`certify` learns an action threshold on a calibration split, then evaluates it
once on a fixed holdout. It issues a checksummed certificate only when the
one-sided exact binomial risk bound (Clopper–Pearson), coverage target, and all
requested slice checks pass. Slice claims receive a Bonferroni family-wise
correction.

Each input row is a labeled historical decision. `score` is the application's
declared scalar for this action; `correct` means that the action was correct
after review or known outcome. Deriving that score and label is intentionally
application-specific and must remain stable across certification and runtime.

```json
{"id":"case-42","action":"auto_approve","score":0.97,"correct":true,"timestamp":"2026-09-03T08:00:00Z","slices":{"region":"eu"}}
```

```bash
jev-workflow compile packs/sav-fr/policy.yaml --out output/sav-fr.lock.json

jev-workflow certify output/sav-fr.lock.json \
  --dataset packs/sav-fr/slo-decisions.jsonl \
  --action approval_required --max-risk 0.20 --min-coverage 0.80 \
  --confidence 0.95 --out output/decision-certificate.json
```

For a chronological holdout, add `--split time`; every row must then have a
timestamp. For production slice claims, use for example
`--slices region,channel --min-slice-size 100`. A slice without enough selected
decisions makes the certificate insufficient rather than silently dropping the
claim.

Certificates can be signed with an existing Ed25519 key pair:

```bash
jev-workflow egress-keygen --private .jev/certificate-private.pem \
  --public .jev/certificate-public.pem

jev-workflow certify output/sav-fr.lock.json \
  --dataset packs/sav-fr/slo-decisions.jsonl \
  --action approval_required --max-risk 0.20 --min-coverage 0.80 \
  --out output/signed-certificate.json \
  --sign-private .jev/certificate-private.pem
```

The runtime gate fails closed on status, expiry, workflow fingerprint, action,
threshold, and—when a signed certificate is supplied—signature verification:

```json
{"workflowFingerprint":"<compiled fingerprint>","action":"approval_required","score":0.96}
```

```bash
jev-workflow gate output/signed-certificate.json \
  --decision decision.json --public .jev/certificate-public.pem
```

Exit code `0` means `permit`; exit code `2` means `review`. Require a signature
even for an unsigned input with `--require-signature`.

Use a conservative CI comparison and an ongoing breach monitor:

```bash
jev-workflow compare-certificates baseline.json --candidate candidate.json
jev-workflow monitor output/decision-certificate.json \
  --dataset newly-labeled-decisions.jsonl --out output/monitor.json
```

Comparison exits `2` for a non-certified candidate, weakened SLO, lower
validated coverage, or higher validated upper risk bound. Monitoring consumes
newly labeled decisions in file order and exits `2` only when an anytime-valid
Hoeffding lower bound establishes that risk exceeded the certificate budget;
warnings remain exit `0`. Pass `--public` to either command to verify signed
certificate inputs.

The certificate is evidence about the supplied workload under binomial
sampling and representative-holdout assumptions—not a universal safety,
security, legal, or causal guarantee. Distribution shift, label leakage,
dependent observations, delayed labels, or a changed score definition can
invalidate the claim. Monitoring detects some breaches; it does not recertify
the system.

The bundled 40-row SLO dataset is synthetic and intentionally permissive so the
offline workflow is reproducible. It is not evidence for production use.

## Operational modules

### DecisionFuzz

`fuzz` checks invariants across option-order, state-order, normalized-whitespace,
and explicitly declared irrelevant-context mutations. A changed routed outcome
is emitted as a reproducible violation and causes exit code `2`, making it
usable in CI.

```bash
jev-workflow fuzz workflow.lock.json \
  --dataset cases.jsonl \
  --live \
  --mutations option-order,state-key-order,normalized-whitespace \
  --max-calls 80 \
  --out fuzz-report.json
```

`--max-calls` is a hard provider-cost guard. For `irrelevant-context`, the
caller must explicitly assert which text paths may receive irrelevant content:

```bash
jev-workflow fuzz workflow.lock.json --dataset cases.jsonl --live \
  --mutations irrelevant-context --paths ticket.message --max-calls 40
```

### JevTrace

The flight recorder writes one JSON trace per decision with stable semantic
attributes, hashes, routing events, model version, policy fingerprint, usage,
and the complete typed result. Input is excluded unless `--trace-input` is
explicitly supplied; when included, it is the post-preflight value, after any
configured redaction.

```bash
jev-workflow run workflow.lock.json --input input.json --live \
  --trace .jev/traces.jsonl --trace-input

jev-workflow replay workflow.lock.json --trace .jev/traces.jsonl --live
jev-workflow trace-to-case .jev/traces.jsonl --out regression-case.json
```

Replay refuses a different workflow fingerprint unless
`--allow-workflow-change` is set, in which case it becomes an explicit old/new
comparison.

### JevStable

Temporal policies prevent an oscillating decision from immediately changing
the emitted outcome:

```yaml
stability:
  minConsecutive: 2
  minDwellMs: 30000
  cooldownMs: 30000
```

Persist the state atomically between CLI invocations:

```bash
jev-workflow run workflow.lock.json --input input.json --live \
  --stability-state .jev/stability.json
```

For multiple entities, applications should keep one `StabilityState` per
entity key through the TypeScript API. The CLI state file is intentionally a
single-process reference implementation, not a distributed lock.
When a proposal is held, `decision.ruleId` is cleared and the rejected proposal
is preserved under `decision.proposed`, so audit consumers cannot attribute the
stable emitted outcome to the wrong routing rule.

### Jev Egress

The egress compiler enumerates the actual leaf fields that would be sent,
resolves their classifications, checks allow/deny rules and region constraints,
then hashes the state. Runtime uses the same planner before the network call.

```yaml
egress:
  allow: [ticket.message, ticket.channel, _derived]
  deny: [ticket.payment_card]
  classifications:
    ticket.message: personal
    ticket.channel: public
    _derived: internal
  allowClassifications: [public, internal, personal]
  requireExplicitClassification: true
  destination: { service: typesafe-systemone, region: eu }
  requiredRegion: eu
  onViolation: reject
```

Plans can be signed with Ed25519 and independently verified:

```bash
jev-workflow egress-keygen --private .jev/egress-private.pem \
  --public .jev/egress-public.pem

jev-workflow egress-plan workflow.lock.json --input input.json \
  --sign-private .jev/egress-private.pem --out egress-manifest.json

jev-workflow egress-verify egress-manifest.json \
  --public .jev/egress-public.pem
```

Key generation refuses to overwrite existing files. Private keys are created
with mode `0600`.

## Install and try it offline

Requires Node.js 22 or newer.

```bash
git clone https://github.com/gbesse/jev-workflow.git
cd jev-workflow
npm install
npm run release:check

node dist/cli.js compile packs/sav-fr/policy.yaml \
  --out output/sav-fr.lock.json

node dist/cli.js run output/sav-fr.lock.json \
  --input packs/sav-fr/demo-input.json \
  --response packs/sav-fr/demo-response.json \
  --audit output/audit.jsonl \
  --trace output/trace.jsonl --trace-input \
  --stability-state output/stability.json
```

The fixture routes a French support ticket without making a network request.
Dates and monetary thresholds are calculated in code, the email is redacted
before state assembly, the egress plan is enforced, and raw input is absent
from the normal audit receipt.

## Use TypeSafe

Create an ignored `.env` containing `TYPESAFE_API_KEY`, then use Node's native
environment-file support:

```bash
node --env-file=.env dist/cli.js run output/sav-fr.lock.json \
  --input packs/sav-fr/demo-input.json --live
```

The CLI never opens or prints `.env`; it only reads the environment variable.
A live command transmits the permitted compiled state and may incur provider
charges.

## Policy model

Policies contain an input contract, deterministic preflight, bounded Jev
questions (`Choice`, `Noul`, `Score`), per-question uncertainty guards, ordered
routing, and optional audit, egress, and stability policies. See
[`packs/sav-fr/policy.yaml`](packs/sav-fr/policy.yaml) for the complete example.

Conditions support `all`, `any`, `not`, and leaf operators `eq`, `neq`, `gt`,
`gte`, `lt`, `lte`, `in`, and `exists`. Rules are evaluated in order and the
first match wins.

Every `state.include` entry must be an exact declared input field, or a child
of a field explicitly declared as an object. Selecting an undeclared parent is
rejected at compile time so sibling fields cannot hitchhike into model state.

## Evaluation

Evaluate held-out, human-reviewed rows rather than guessing thresholds:

```bash
jev-workflow eval workflow.lock.json --dataset cases.jsonl --live \
  --max-calls 200 --target 0.95 --out evaluation.json
```

Reports include accuracy, Brier score, ECE, high-confidence errors, prediction
coverage, label coverage, and missing row identifiers. Unknown labels, unknown
answers, malformed predictions, and duplicate dataset identifiers are rejected
instead of being silently ignored. Export to
[jevcal](https://github.com/abhixhek/jevcal) with:

```bash
jev-workflow export-jevcal workflow.lock.json \
  --dataset cases.jsonl --out output/jevcal
```

The bundled 18-row French dataset is synthetic and exists to exercise wiring
and edge cases. It is not a production benchmark.

## Security boundaries

- Egress rules are local enforcement, not a substitute for provider contracts,
  network controls, or an approved DLP system.
- Regex PII detection is deliberately conservative and incomplete.
- `--trace-input` creates sensitive replay material; protect its directory and
  retention policy.
- A valid typed answer can still be wrong. Test confident errors on the exact
  workload and retain human review for consequential decisions.
- Stability delays change; it does not prove that the stable decision is safe.
- A certificate checksum detects accidental modification; it does not establish
  provenance. Require and verify an Ed25519 signature across trust boundaries.
- Certification depends on representative, independently labeled holdout data.
  Reusing the holdout for repeated tuning invalidates its stated confidence.

See [SECURITY.md](SECURITY.md) for reporting instructions and the threat model.

## Development

```bash
npm ci
npm run release:check
```

The suite runs type checking, unit and integration tests, a production build,
and an npm package dry run on Node 22 and 24. Contributions are welcome under
the [MIT license](LICENSE).
