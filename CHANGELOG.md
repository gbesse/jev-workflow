# Changelog

## 0.3.0

- Add Decision SLO calibration and fixed-holdout certification with exact
  one-sided binomial risk bounds and minimum coverage requirements.
- Add family-wise corrected per-slice evidence with explicit minimum sample
  sizes and insufficient-evidence handling.
- Add checksummed, expiring, optionally Ed25519-signed decision certificates.
- Add a fail-closed runtime gate bound to workflow fingerprint, action, score,
  certificate status, expiry, and signature policy.
- Add conservative certificate comparison for CI and an anytime-valid
  sequential breach monitor for newly labeled production decisions.
- Add a synthetic offline Decision SLO example to the French SAV pack.

## 0.2.2

- Prevent parent state selectors from transmitting undeclared sibling fields.
- Revalidate the complete semantics of checksummed compiled artifacts.
- Reject unsafe paths and ambiguous dotted question or derived identifiers at
  compile time.
- Validate persisted stability state and preserve proposed routing metadata
  when the stability gate holds an earlier outcome.
- Make Ed25519 public-key fingerprints independent of PEM whitespace and reject
  malformed signed manifests without throwing.
- Report evaluation coverage and reject duplicate rows, unknown labels,
  unknown answers, and malformed predictions.
- Make egress key generation clean up a newly-created private key when public
  key creation fails.

## 0.2.1

- Harden dynamic path access against prototype pollution.
- Add weekly grouped dependency updates while keeping major toolchain upgrades
  explicit.

## 0.2.0

- Initial public release with DecisionFuzz, JevTrace, JevStable, Jev Egress,
  the policy compiler, evaluation tooling, and the synthetic French SAV pack.
