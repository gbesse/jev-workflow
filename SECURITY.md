# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use GitHub's private
vulnerability reporting for this repository. Include a minimal reproduction,
the affected version, and the impact you observed.

## Threat model

`jev-workflow` treats model output, user text, trace files, fixture responses,
compiled artifacts, labeled datasets, and decision certificates as untrusted
data. It validates typed provider answers and fingerprints compiled policies.
Egress checks run before provider calls. Certificate checksums provide
integrity, not provenance; require Ed25519 verification when a certificate
crosses a trust boundary.

The following are explicitly outside the security boundary:

- authorization of irreversible business actions;
- completeness of regex-based PII or injection detection;
- secrecy of trace files created with `--trace-input`;
- distributed locking for stability state;
- the correctness of a model judgment.
- the representativeness, independence, or correctness of certification labels;
- authorization based solely on an unsigned decision certificate.

Keep authorization, rate limits, payment limits, and destructive actions in
deterministic application code.
