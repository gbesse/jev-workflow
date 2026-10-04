export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
export type Entry = string | JsonObject | JsonValue[] | null;

export interface ChoiceQuestion {
  type: "choice";
  instructions?: Entry;
  criteria: Record<string, Entry>;
}

export interface NoulQuestion {
  type: "noul";
  instructions?: Entry;
  criteria?: { true?: Entry; false?: Entry } | null;
}

export interface ScoreQuestion {
  type: "score";
  instructions?: Entry;
  criteria: Entry[];
}

export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export interface QuestionGuard {
  minConfidence?: number;
  minMargin?: number;
  requiredForAuto?: boolean;
}

export type QuestionSpec = Question & { guard?: QuestionGuard };

export interface InputFieldSpec {
  type: "string" | "number" | "boolean" | "datetime" | "object" | "array";
  required?: boolean;
}

export interface TextPreflightRule {
  path: string;
  maxCharacters?: number;
  normalizeWhitespace?: boolean;
  overflow?: "reject" | "truncate";
}

export interface DateDiffRule {
  id: string;
  from: string;
  to: string;
  unit?: "hours" | "days";
  rounding?: "floor" | "ceil" | "round";
}

export interface ComparisonRule {
  id: string;
  path: string;
  op: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
  value: number | string | boolean;
}

export interface PreflightSpec {
  text?: TextPreflightRule[];
  dates?: DateDiffRule[];
  comparisons?: ComparisonRule[];
  security?: {
    scanPaths?: string[];
    detectPii?: boolean;
    detectInstructionInjection?: boolean;
    piiAction?: "warn" | "redact" | "reject";
    injectionAction?: "warn" | "reject";
  };
}

export type ConditionOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "exists";

export interface LeafCondition {
  path: string;
  op: ConditionOperator;
  value?: JsonValue;
}

export type Condition = LeafCondition | { all: Condition[] } | { any: Condition[] } | { not: Condition };

export interface RoutingRule {
  id: string;
  when: Condition;
  outcome: JsonObject;
  reason: string;
}

export interface WorkflowSpec {
  version: 1;
  name: string;
  policyVersion: string;
  locale?: string;
  model?: string;
  input: Record<string, InputFieldSpec>;
  state: { include: string[] };
  preflight?: PreflightSpec;
  questions: Record<string, QuestionSpec>;
  routing: {
    onUncertain?: JsonObject;
    rules: RoutingRule[];
    default: JsonObject;
  };
  audit?: {
    path?: string;
    includeInput?: boolean;
    redact?: string[];
  };
  stability?: StabilitySpec;
  egress?: EgressSpec;
}

export type DataClassification = "public" | "internal" | "personal" | "sensitive" | "secret";

export interface EgressSpec {
  allow?: string[];
  deny?: string[];
  classifications?: Record<string, DataClassification>;
  allowClassifications?: DataClassification[];
  requireExplicitClassification?: boolean;
  destination?: { service: string; region?: string };
  requiredRegion?: string;
  onViolation?: "reject" | "warn";
}

export interface StabilitySpec {
  minConsecutive?: number;
  minDwellMs?: number;
  cooldownMs?: number;
}

export interface CompiledWorkflow {
  artifactVersion: 1;
  compiler: "jev-workflow@0.2.0";
  name: string;
  policyVersion: string;
  locale: string;
  model: string;
  input: Record<string, InputFieldSpec>;
  state: { include: string[] };
  preflight: PreflightSpec;
  questions: Record<string, Question>;
  guards: Record<string, QuestionGuard>;
  routing: WorkflowSpec["routing"];
  audit: NonNullable<WorkflowSpec["audit"]>;
  stability?: StabilitySpec;
  egress?: EgressSpec;
  fingerprint: string;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, Entry>;
  probabilities: Record<string, number>;
}

export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface SystemOneRequest {
  model: string;
  state: JsonValue;
  questions: Record<string, Question>;
}

export interface SystemOneResult {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

export interface DecisionProvider {
  decide(request: SystemOneRequest): Promise<SystemOneResult>;
}

export interface PreflightFinding {
  code: "PII_SIGNAL" | "INSTRUCTION_INJECTION_SIGNAL" | "TEXT_TRUNCATED";
  path: string;
  message: string;
}

export interface PreflightResult {
  input: JsonObject;
  state: JsonObject;
  derived: JsonObject;
  findings: PreflightFinding[];
  signals: {
    hasPii: boolean;
    hasInstructionInjection: boolean;
    wasTruncated: boolean;
  };
}

export interface LintFinding {
  code: string;
  severity: "error" | "warning" | "info";
  location: string;
  message: string;
}

export interface ExecutionResult {
  workflow: { name: string; policyVersion: string; fingerprint: string };
  providerModel: string;
  outcome: JsonObject;
  decision: {
    ruleId: string | null;
    reason: string;
    uncertainQuestions: string[];
    proposed?: { ruleId: string | null; reason: string; outcome: JsonObject };
  };
  answers: Record<string, Answer>;
  preflight: Pick<PreflightResult, "derived" | "findings" | "signals">;
  receipt: {
    id: string;
    timestamp: string;
    inputHash: string;
    requestHash: string;
    usage: SystemOneResult["usage"];
  };
  egress?: EgressPlan;
  stability?: StabilityResult;
}

export interface EvaluationRow {
  id: string;
  input: JsonObject;
  labels: Record<string, string | number | boolean>;
}

export interface EgressField {
  path: string;
  classification: DataClassification | "unclassified";
  status: "allowed" | "denied";
  reasons: string[];
}

export interface EgressPlan {
  version: 1;
  workflowFingerprint: string;
  destination: EgressSpec["destination"] | null;
  createdAt: string;
  stateHash: string;
  fields: EgressField[];
  violations: string[];
  permitted: boolean;
  manifestHash: string;
}

export interface SignedEgressManifest {
  plan: EgressPlan;
  signature: { algorithm: "Ed25519"; value: string; publicKeyFingerprint: string };
}

export interface StabilityState {
  stableOutcome: JsonObject;
  stableSince: string;
  lastChangedAt: string;
  candidateOutcome?: JsonObject;
  candidateCount: number;
}

export interface StabilityResult {
  status: "initialized" | "stable" | "held" | "switched";
  reason: string;
  proposedOutcome: JsonObject;
  emittedOutcome: JsonObject;
  state: StabilityState;
}

export type FuzzMutationName = "option-order" | "state-key-order" | "normalized-whitespace" | "irrelevant-context";

export interface FuzzViolation {
  caseId: string;
  mutation: FuzzMutationName;
  seed: number;
  path?: string;
  baselineOutcome: JsonObject;
  mutatedOutcome: JsonObject;
  baselineAnswers: Record<string, Answer>;
  mutatedAnswers: Record<string, Answer>;
  minimizedInput?: JsonObject;
}

export interface FuzzReport {
  version: 1;
  workflowFingerprint: string;
  generatedAt: string;
  seed: number;
  cases: number;
  calls: number;
  mutationsRun: number;
  violations: FuzzViolation[];
  passed: boolean;
}

export interface DecisionTrace {
  version: 1;
  traceId: string;
  spanId: string;
  name: "jev.workflow.decision";
  startTime: string;
  endTime: string;
  status: "OK" | "ERROR";
  attributes: Record<string, JsonValue>;
  events: Array<{ name: string; timestamp: string; attributes: Record<string, JsonValue> }>;
  input?: JsonObject;
  result: ExecutionResult;
}

export interface DecisionSloRow {
  id: string;
  action: string;
  score: number;
  correct: boolean;
  timestamp?: string;
  slices?: Record<string, string>;
}

export interface RiskEvidence {
  rows: number;
  selected: number;
  errors: number;
  coverage: number;
  empiricalRisk: number | null;
  upperRiskBound: number | null;
  confidence: number;
}

export interface SliceRiskEvidence extends RiskEvidence {
  field: string;
  value: string;
  eligible: boolean;
}

export interface DecisionCertificate {
  version: 1;
  certificateId: string;
  createdAt: string;
  expiresAt: string;
  status: "certified" | "rejected" | "insufficient";
  workflow: { name: string; policyVersion: string; fingerprint: string; model: string };
  slo: {
    action: string;
    maxRisk: number;
    confidence: number;
    minimumCoverage: number;
    threshold: number | null;
    slices: string[];
    minSliceSize: number;
  };
  dataset: {
    sha256: string;
    rows: number;
    calibrationRows: number;
    validationRows: number;
    split: "ordered" | "time";
  };
  evidence: {
    calibration: RiskEvidence | null;
    validation: RiskEvidence | null;
    slices: SliceRiskEvidence[];
    familyWiseConfidence: number;
  };
  reasons: string[];
}

export interface SignedDecisionCertificate {
  certificate: DecisionCertificate;
  signature: { algorithm: "Ed25519"; value: string; publicKeyFingerprint: string };
}

export interface DecisionGateInput {
  workflowFingerprint: string;
  action: string;
  score: number;
}

export interface DecisionGateResult {
  decision: "permit" | "review";
  certificateId: string;
  reasons: string[];
  threshold: number | null;
  score: number;
}

export interface DecisionMonitorReport {
  version: 1;
  certificateId: string;
  status: "healthy" | "warning" | "revoke";
  observed: number;
  errors: number;
  empiricalRisk: number | null;
  anytimeLowerBound: number | null;
  maxRisk: number;
  confidence: number;
  firstBreachAt: number | null;
  reasons: string[];
}
