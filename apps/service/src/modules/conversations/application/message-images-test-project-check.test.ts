import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { INestApplication } from "@nestjs/common";
import {
  messageImageSchema,
  messageListSchema,
  taskSchema,
  threadListSchema,
  threadSchema,
  type Message,
} from "@the-office/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  addTestProject,
  checkApi,
  cleanUpTestProject,
  hireOnHaiku,
  messageLine,
  tokensOf,
  untilThreadWaits,
  type Api,
} from "../../../../test/live-check.js";
import { startTestApplication } from "../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../test/test-database.js";
import { AppModule } from "../../../app.module.js";
import { GITHUB_SITE } from "../../../platform/git-identity/github-site.js";
import { EngineSessions } from "../../engine/index.js";
import { aPlainPng } from "../../engine/index.fixtures.js";

/**
 * The check of the Task "Paste images into a Thread's message box" (7828b36f) on the Test Project:
 * through the API, as the web sends a pasted screenshot, a plain red PNG goes to a Task's planning
 * Thread with the user's first message. The Planner, on Haiku, sees it as a picture and names its
 * colour; then the Thread starts fresh, and the new session, whose Brief lists the image by its
 * Attachment id, reads it again with read_attachment and names the colour once more. Nothing is
 * published and the Task is dropped. Live, so it runs only with OFFICE_ENGINE_TESTS=live and
 * OFFICE_TEST_PROJECT=<the Test Project's folder>, with OFFICE_CHECK_REPORT=<a file> to keep what it
 * saw. It hires the Planner from its preset, so it runs alone:
 * `npx vitest run conversations/application/message-images-test-project-check`.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"] ?? "";
const REPORT = process.env["OFFICE_CHECK_REPORT"];
const WEB_APP = fileURLToPath(new URL("../../../../../web", import.meta.url));
const ANSWER_MS = 240_000;

const SCREENSHOT_NAME = "Pasted image 2026-11-16 09.30.00.png";
const FIRST_MESSAGE =
  "Before we plan anything: I pasted a screenshot. Look at it and tell me in one short sentence " +
  "what it shows, naming its colour. Write nothing onto the Task yet.";
const FRESH_MESSAGE =
  "Your earlier session is gone. Read the image from my first message again with the " +
  "read_attachment tool, by the Attachment id your Brief lists, and tell me its colour in one word.";

describe.runIf(MODE === "live" && TEST_PROJECT !== "")(
  "The check of pasted images on the Test Project",
  () => {
    it(
      "the Planner sees a pasted screenshot, and a fresh session reads it again with read_attachment",
      async () => {
        const scratch = await mkdtemp(join(tmpdir(), "office-message-images-check-"));
        const officeData = join(scratch, "office-data");
        const report: string[] = [];
        const begun = Date.now();
        const note = async (...lines: string[]): Promise<void> => {
          const seconds = Math.round((Date.now() - begun) / 1000);
          report.push(...lines.map((line, i) => (i === 0 ? `[${seconds} s] ${line}` : line)));
          // For the task's Progress log: vitest keeps a passing test's console to itself.
          if (REPORT) await writeFile(REPORT, `${report.join("\n")}\n`);
        };
        let app: INestApplication | undefined;
        let taskId: string | undefined;
        try {
          let url: string;
          ({ app, url } = await startTestApplication({
            imports: [
              AppModule.register(
                {
                  host: "127.0.0.1",
                  port: 0,
                  databaseUrl: testDatabaseUrl(),
                  officeDataDirectory: officeData,
                  gitHub: GITHUB_SITE,
                },
                { directory: WEB_APP, source: "built" },
              ),
            ],
          }));
          const { api } = checkApi(url);
          const sessionStarts = vi.spyOn(app.get(EngineSessions, { strict: false }), "start");
          await hireOnHaiku(api, [["planner", "Jan"]]);
          const project = await addTestProject(api, TEST_PROJECT);

          const created = taskSchema.parse(
            await api("POST", "/tasks", {
              title: "The settings page is cut off on the right",
              projectId: project.id,
              priority: "normal",
            }),
          );
          taskId = created.id;
          await api("POST", `/tasks/${taskId}/planning`);
          const thread = threadListSchema.parse(await api("GET", `/tasks/${taskId}/threads`))[0];
          if (!thread) throw new Error("Planning opened no Thread.");

          // The screenshot as the web uploads it, then the message naming it.
          const screenshot = aPlainPng(96, 64, [220, 30, 30]);
          const image = await uploadImage(url, thread.id, screenshot);
          await api("POST", `/threads/${thread.id}/messages`, {
            text: FIRST_MESSAGE,
            images: [image.attachmentId],
          });
          await untilThreadWaits(api, thread.id, ANSWER_MS);
          const attachments = (await api("GET", `/tasks/${taskId}/attachments`)) as {
            id: string;
            kind: string;
            name: string;
          }[];
          await note(
            `Task ${taskId}, Thread ${thread.id}; the image is Attachment ${image.attachmentId}`,
            `  The Task's Attachments: ${attachments.map(({ kind, name }) => `${kind} ${name}`).join(", ")}`,
          );
          expect(attachments).toEqual([
            expect.objectContaining({
              id: image.attachmentId,
              kind: "image",
              name: SCREENSHOT_NAME,
            }),
          ]);
          const first = await messagesOf(api, thread.id);
          await note(
            "## The first session",
            ...first.map((message) => `  ${messageLine(message)}`),
          );
          expect(first.find((message) => message.kind === "user")).toMatchObject({
            images: [{ attachmentId: image.attachmentId, name: SCREENSHOT_NAME }],
          });
          expect(lastReply(first)).toMatch(/red/i);

          // Start fresh: the Brief lists the image, and the session reads it with the Office tool.
          await api("PUT", `/threads/${thread.id}/context-override`, { override: "start-fresh" });
          await api("POST", `/threads/${thread.id}/messages`, { text: FRESH_MESSAGE });
          await untilThreadWaits(api, thread.id, ANSWER_MS);
          const all = await messagesOf(api, thread.id);
          const fresh = all.slice(first.length);
          const contexts = all.flatMap((message) => (message.kind === "context" ? [message] : []));
          const freshContext = contexts.at(-1);
          const { tokens } = threadSchema.parse(await api("GET", `/threads/${thread.id}`));
          await note(
            "## The fresh session",
            ...fresh.map((message) => `  ${messageLine(message)}`),
            `The fresh session's Brief:`,
            freshContext?.brief ?? "none",
            `Sessions started: ${sessionStarts.mock.calls.length}; Thread tokens ${tokensOf(tokens)} ${JSON.stringify(tokens)}`,
          );
          expect(sessionStarts).toHaveBeenCalledTimes(2);
          expect(freshContext?.move).toBe("fresh");
          expect(freshContext?.brief).toContain(
            `image ${SCREENSHOT_NAME} · Attachment ${image.attachmentId}`,
          );
          expect(
            fresh.some(
              (message) =>
                message.kind === "tool-activity" && message.tool.endsWith("read_attachment"),
            ),
          ).toBe(true);
          expect(lastReply(fresh)).toMatch(/red/i);
          expect(all.filter(({ kind }) => kind === "failure")).toEqual([]);

          await api("POST", `/tasks/${taskId}/drop`);
          await note(`Task ${taskId} dropped`);
        } finally {
          await app?.close();
          await cleanUpTestProject(TEST_PROJECT, { taskIds: [taskId], officeData });
          await note("Cleaned up the Task's worktree and branch");
          await rm(scratch, { recursive: true, force: true });
        }
      },
      ANSWER_MS * 2 + 120_000,
    );
  },
);

/** POST /threads/:id/images, as the message box sends a pasted image: its bytes as the body. */
async function uploadImage(url: string, threadId: string, bytes: Uint8Array) {
  const query = new URLSearchParams({ fileName: SCREENSHOT_NAME });
  const response = await fetch(`${url}/api/threads/${threadId}/images?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST /threads/${threadId}/images: ${response.status} ${text}`);
  return messageImageSchema.parse(JSON.parse(text));
}

async function messagesOf(api: Api, threadId: string): Promise<Message[]> {
  return messageListSchema.parse(await api("GET", `/threads/${threadId}/messages`));
}

/** The person's last reply among `messages`, or "" when they replied nothing. */
function lastReply(messages: readonly Message[]): string {
  const reply = messages.findLast((message) => message.kind === "person");
  return reply?.kind === "person" ? reply.text : "";
}
