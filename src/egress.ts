import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import type {
  CompiledWorkflow,
  DataClassification,
  EgressField,
  EgressPlan,
  JsonObject,
  JsonValue,
  SignedEgressManifest,
} from "./types.js";
import { canonicalJson, sha256 } from "./utils.js";

function leafPaths(value: JsonValue, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => leafPaths(item, prefix ? `${prefix}.${index}` : String(index)));
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return prefix ? [prefix] : [];
    return entries.flatMap(([key, item]) => leafPaths(item, prefix ? `${prefix}.${key}` : key));
  }
  return prefix ? [prefix] : [];
}

function matches(path: string, rule: string): boolean {
  const normalized = rule.endsWith(".*") ? rule.slice(0, -2) : rule;
  return path === normalized || path.startsWith(`${normalized}.`);
}

function classificationFor(path: string, classifications: Record<string, DataClassification>): DataClassification | "unclassified" {
  const candidate = Object.entries(classifications)
    .filter(([rule]) => matches(path, rule))
    .sort(([a], [b]) => b.length - a.length)[0];
  return candidate?.[1] ?? (path === "_derived" || path.startsWith("_derived.") ? "internal" : "unclassified");
}

export function createEgressPlan(artifact: CompiledWorkflow, state: JsonObject, createdAt = new Date().toISOString()): EgressPlan {
  const policy = artifact.egress;
  const violations: string[] = [];
  if (policy?.requiredRegion && policy.destination?.region !== policy.requiredRegion) {
    violations.push(`destination region ${policy.destination?.region ?? "unspecified"} does not satisfy required region ${policy.requiredRegion}`);
  }
  const fields: EgressField[] = leafPaths(state).sort().map((path) => {
    const reasons: string[] = [];
    const classification = classificationFor(path, policy?.classifications ?? {});
    if ((policy?.deny ?? []).some((rule) => matches(path, rule))) reasons.push("path is denied");
    if (policy?.allow?.length && !policy.allow.some((rule) => matches(path, rule))) reasons.push("path is outside the allow list");
    if (policy?.requireExplicitClassification && classification === "unclassified") reasons.push("path has no explicit classification");
    if (policy?.allowClassifications?.length && !policy.allowClassifications.includes(classification as DataClassification)) {
      reasons.push(`classification ${classification} is not allowed`);
    }
    if (reasons.length) violations.push(`${path}: ${reasons.join("; ")}`);
    return { path, classification, status: reasons.length ? "denied" : "allowed", reasons };
  });
  const unsigned = {
    version: 1 as const,
    workflowFingerprint: artifact.fingerprint,
    destination: policy?.destination ?? null,
    createdAt,
    stateHash: sha256(state),
    fields,
    violations,
    permitted: violations.length === 0,
  };
  return { ...unsigned, manifestHash: sha256(unsigned as unknown as JsonValue) };
}

export function enforceEgress(plan: EgressPlan, artifact: CompiledWorkflow): void {
  if (!plan.permitted && (artifact.egress?.onViolation ?? "reject") === "reject") {
    throw new Error(`egress policy rejected the request: ${plan.violations.join(" | ")}`);
  }
}

export function generateEgressKeyPair(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export function signEgressPlan(plan: EgressPlan, privateKey: string): SignedEgressManifest {
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const body = canonicalJson(plan as unknown as JsonValue);
  return {
    plan,
    signature: {
      algorithm: "Ed25519",
      value: sign(null, Buffer.from(body), privateKey).toString("base64"),
      publicKeyFingerprint: sha256(publicKey),
    },
  };
}

export function verifyEgressManifest(manifest: SignedEgressManifest, publicKey: string): boolean {
  const expectedHash = sha256((({ manifestHash: _ignored, ...rest }) => rest)(manifest.plan) as unknown as JsonValue);
  if (expectedHash !== manifest.plan.manifestHash || sha256(publicKey) !== manifest.signature.publicKeyFingerprint) return false;
  return verify(null, Buffer.from(canonicalJson(manifest.plan as unknown as JsonValue)), publicKey, Buffer.from(manifest.signature.value, "base64"));
}
