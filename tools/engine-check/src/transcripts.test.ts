import assert from "node:assert/strict";
import { test } from "node:test";
import { deferredAtStart, skillListings, type TranscriptEntry } from "./transcripts.ts";

test("reads the tools of the first deferred tools announcement", () => {
  const entries: TranscriptEntry[] = [
    { type: "user" },
    {
      type: "attachment",
      attachment: { type: "deferred_tools_delta", addedNames: ["Monitor", "mcp__office__b"] },
    },
    {
      type: "attachment",
      attachment: { type: "deferred_tools_delta", addedNames: ["mcp__office__c"] },
    },
  ];
  assert.deepEqual(deferredAtStart(entries), ["Monitor", "mcp__office__b"]);
});

test("reads no deferred tools when the engine announced none", () => {
  assert.deepEqual(
    deferredAtStart([{ type: "attachment", attachment: { type: "environment" } }]),
    [],
  );
});

test("reads the skill names of each skill listing attachment, in order", () => {
  const entries: TranscriptEntry[] = [
    {
      type: "attachment",
      attachment: {
        type: "skill_listing",
        content: "- office:alpha: First.\n- review: Reviews: the code.",
      },
    },
    { type: "user" },
    { type: "attachment", attachment: { type: "environment" } },
    {
      type: "attachment",
      attachment: { type: "skill_listing", content: "- office:beta: Second." },
    },
  ];
  assert.deepEqual(skillListings(entries), [["office:alpha", "review"], ["office:beta"]]);
});
