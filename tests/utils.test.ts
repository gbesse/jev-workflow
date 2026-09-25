import test from "node:test";
import assert from "node:assert/strict";
import { getPath, setPath } from "../src/utils.js";
import type { JsonObject } from "../src/types.js";

test("path assignment creates own nested properties", () => {
  const target: JsonObject = {};
  setPath(target, "customer.profile.name", "Ada");
  assert.deepEqual(target, { customer: { profile: { name: "Ada" } } });
  assert.equal(getPath(target, "customer.profile.name"), "Ada");
});

test("path access rejects prototype-polluting and empty segments", () => {
  const target: JsonObject = {};
  for (const path of ["__proto__.polluted", "constructor.prototype.polluted", "safe..polluted"]) {
    assert.throws(() => setPath(target, path, "yes"), /path (?:must contain non-empty|segment)/);
    assert.throws(() => getPath(target, path), /path (?:must contain non-empty|segment)/);
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
