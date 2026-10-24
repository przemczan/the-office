import assert from "node:assert/strict";
import { test } from "node:test";
import { isWithin, rulePath } from "./paths.ts";

test("writes a Windows path as a //-rooted rule path with the drive in lower case", () => {
  assert.equal(rulePath("C:\\Users\\me\\repository"), "//c/Users/me/repository");
});

test("keeps a POSIX path and roots it with //", () => {
  assert.equal(rulePath("/home/me/repository"), "//home/me/repository");
});

test("a path is within its folder, a sibling with the same prefix is not", () => {
  assert.equal(isWithin("/sandbox/repository/notes.txt", "/sandbox/repository"), true);
  assert.equal(isWithin("/sandbox/repository", "/sandbox/repository"), true);
  assert.equal(isWithin("/sandbox/repository-other/notes.txt", "/sandbox/repository"), false);
});
