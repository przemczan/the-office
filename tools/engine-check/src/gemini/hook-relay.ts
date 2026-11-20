/**
 * The `BeforeTool` command hook a Gemini session runs for every tool call: it hands the CLI's input to
 * the session's Office channel and prints the answer. The CLI lets a call run when a hook exits 1,
 * times out or fails to start, and refuses it on any other non-zero exit, so every failure this relay
 * can see ends in exit 2 with the reason on stderr: the Office rules refuse when they can't be asked.
 */
import { askChannel, type BeforeToolInput } from "./office-channel.ts";
import { OFFICE_CHANNEL_VARIABLE, OFFICE_SESSION_TOKEN_VARIABLE } from "./options.ts";

const REFUSE = 2;

try {
  const address = process.env[OFFICE_CHANNEL_VARIABLE];
  const token = process.env[OFFICE_SESSION_TOKEN_VARIABLE];
  if (address === undefined || token === undefined) {
    throw new Error("The Office channel is not set for this session");
  }
  const input = JSON.parse(await readStdin()) as BeforeToolInput;
  const answer = await askChannel(address, { token, kind: "hook", input });
  process.stdout.write(JSON.stringify(answer));
} catch (error) {
  process.stderr.write(
    `The Office could not judge this call, so it is refused: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = REFUSE;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
