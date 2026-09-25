import { createHash } from "node:crypto";
import type { JsonObject, JsonValue } from "./types.js";

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ["string", "boolean"].includes(typeof value)) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isObject(value) && Object.values(value).every(isJsonValue);
}

export function getPath(root: unknown, path: string): unknown {
  let current = root;
  for (const part of path.split(".")) {
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setPath(root: JsonObject, path: string, value: JsonValue): void {
  const parts = path.split(".");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[part] = {};
    current = current[part] as JsonObject;
  }
  current[parts.at(-1)!] = value;
}

function stable(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key]!)]));
  }
  return value;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(stable(value));
}

export function sha256(value: JsonValue | string): string {
  const body = typeof value === "string" ? value : canonicalJson(value);
  return createHash("sha256").update(body).digest("hex");
}

export function assertJsonObject(value: unknown, label: string): asserts value is JsonObject {
  if (!isObject(value) || !isJsonValue(value)) throw new Error(`${label} must be a JSON object`);
}

export function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

export function assertProbability(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite probability between 0 and 1`);
  }
}
