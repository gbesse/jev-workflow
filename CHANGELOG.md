# Changelog

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
