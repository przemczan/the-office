import assert from "node:assert/strict";
import { test } from "node:test";
import { skillListings, type TranscriptEntry } from "./transcripts.ts";

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
