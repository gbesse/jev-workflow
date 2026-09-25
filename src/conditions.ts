import { isDeepStrictEqual } from "node:util";
import type { Condition, JsonValue } from "./types.js";
import { getPath } from "./utils.js";

export function evaluateCondition(condition: Condition, environment: unknown): boolean {
  if ("all" in condition) return condition.all.every((child) => evaluateCondition(child, environment));
  if ("any" in condition) return condition.any.some((child) => evaluateCondition(child, environment));
  if ("not" in condition) return !evaluateCondition(condition.not, environment);
  const actual = getPath(environment, condition.path);
  switch (condition.op) {
    case "exists": return actual !== undefined && actual !== null;
    case "eq": return isDeepStrictEqual(actual, condition.value);
    case "neq": return !isDeepStrictEqual(actual, condition.value);
    case "gt": return typeof actual === "number" && typeof condition.value === "number" && actual > condition.value;
    case "gte": return typeof actual === "number" && typeof condition.value === "number" && actual >= condition.value;
    case "lt": return typeof actual === "number" && typeof condition.value === "number" && actual < condition.value;
    case "lte": return typeof actual === "number" && typeof condition.value === "number" && actual <= condition.value;
    case "in": return Array.isArray(condition.value) && condition.value.some((item) => isDeepStrictEqual(item, actual as JsonValue));
  }
}
