import type {
  Answer,
  DecisionProvider,
  Question,
  SystemOneRequest,
  SystemOneResult,
} from "./types.js";
import { assertProbability, isObject } from "./utils.js";

function assertDistribution(value: unknown, keys: string[], label: string): asserts value is Record<string, number> {
  if (!isObject(value) || Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new Error(`${label} must contain exactly: ${keys.join(", ")}`);
  }
  let total = 0;
  for (const key of keys) {
    assertProbability(value[key], `${label}.${key}`);
    total += value[key] as number;
  }
  if (Math.abs(total - 1) > 0.011) throw new Error(`${label} probabilities must sum to 1`);
}

function validateAnswer(raw: unknown, question: Question, id: string): Answer {
  if (!isObject(raw) || raw.type !== question.type) throw new Error(`answers.${id} has the wrong type`);
  if (question.type === "noul") {
    assertProbability(raw.noul, `answers.${id}.noul`);
    return raw as unknown as Answer;
  }
  if (question.type === "choice") {
    const keys = Object.keys(question.criteria);
    if (typeof raw.choice !== "string" || !keys.includes(raw.choice)) throw new Error(`answers.${id}.choice is not a criterion`);
    assertProbability(raw.confidence, `answers.${id}.confidence`);
    assertDistribution(raw.probabilities, keys, `answers.${id}.probabilities`);
    const top = Math.max(...Object.values(raw.probabilities));
    if ((raw.probabilities[raw.choice] as number) + 1e-8 < top) throw new Error(`answers.${id}.choice is not the top probability`);
    return raw as unknown as Answer;
  }
  const keys = question.criteria.map((_, index) => String(index));
  if (typeof raw.score !== "number" || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > question.criteria.length - 1) {
    throw new Error(`answers.${id}.score is outside the rubric`);
  }
  assertProbability(raw.confidence, `answers.${id}.confidence`);
  assertDistribution(raw.probabilities, keys, `answers.${id}.probabilities`);
  if (!isObject(raw.legend)) throw new Error(`answers.${id}.legend is missing`);
  return raw as unknown as Answer;
}

export function validateSystemOneResult(raw: unknown, request: SystemOneRequest): SystemOneResult {
  if (!isObject(raw) || typeof raw.model !== "string" || !isObject(raw.answers) || !isObject(raw.usage)) {
    throw new Error("invalid System One response envelope");
  }
  if (!Number.isInteger(raw.usage.input_tokens) || Number(raw.usage.input_tokens) < 0 || !Number.isInteger(raw.usage.output_tokens) || Number(raw.usage.output_tokens) < 0) {
    throw new Error("invalid System One usage");
  }
  const answers: Record<string, Answer> = {};
  for (const [id, question] of Object.entries(request.questions)) answers[id] = validateAnswer(raw.answers[id], question, id);
  return { model: raw.model, answers, usage: raw.usage as SystemOneResult["usage"] };
}

export class TypeSafeProvider implements DecisionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.typesafe.ai",
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error("TYPESAFE_API_KEY is required for live execution");
  }

  async decide(request: SystemOneRequest): Promise<SystemOneResult> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`TypeSafe API returned HTTP ${response.status}`);
    return validateSystemOneResult(await response.json(), request);
  }
}

export class FixtureProvider implements DecisionProvider {
  constructor(private readonly result: unknown) {}
  async decide(request: SystemOneRequest): Promise<SystemOneResult> {
    return validateSystemOneResult(this.result, request);
  }
}
