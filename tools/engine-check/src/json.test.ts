import assert from "node:assert/strict";
import { test } from "node:test";
import { diffJson } from "./json.ts";

test("equal values have no differences", () => {
  assert.deepEqual(diffJson({ a: [1, "x"], b: { c: true } }, { b: { c: true }, a: [1, "x"] }), []);
});

test("a changed leaf is reported at its path", () => {
  assert.deepEqual(diffJson({ a: { b: 1 } }, { a: { b: 2 } }), [{ path: "$.a.b", expected: 1, observed: 2 }]);
});

test("missing and extra keys are reported", () => {
  assert.deepEqual(diffJson({ a: 1 }, { b: 2 }), [
    { path: "$.a", expected: 1, observed: undefined },
    { path: "$.b", expected: undefined, observed: 2 },
  ]);
});

test("arrays of different length are reported whole", () => {
  assert.deepEqual(diffJson({ names: ["a"] }, { names: ["a", "b"] }), [
    { path: "$.names", expected: ["a"], observed: ["a", "b"] },
  ]);
});

test("a missing expectation differs from any observation", () => {
  assert.deepEqual(diffJson(undefined, { a: 1 }), [{ path: "$", expected: undefined, observed: { a: 1 } }]);
});
