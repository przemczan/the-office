// What the Office updater container runs (docs/running-the-office.md): The Office starts it from
// its own image, as root, with Docker's socket, the compose folder and the Office data folder
// mounted, OFFICE_UPDATE_FOLDER naming the update folder and OFFICE_CONTAINER the Office container.
// Never built: Node runs it with its types stripped.
import { spawn } from "node:child_process";
import { runContainerUpdate, type CommandOutput } from "./container-update.ts";
import type { Command } from "./office-update.ts";
import { failure } from "./update-folder.ts";

function run([program, ...args]: Command): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolve({ exitCode: code ?? (signal ? 128 : 1), stdout, stderr }),
    );
  });
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} isn't set: the Office updater is started by The Office.`);
  return value;
}

const log = (line: string) => console.log(`[office-updater] ${line}`);
try {
  const result = await runContainerUpdate({
    updateFolder: required("OFFICE_UPDATE_FOLDER"),
    container: required("OFFICE_CONTAINER"),
    run,
  });
  if (!result) log("No update was asked for.");
  else if (result.outcome === "updated")
    log(`Updated The Office from ${result.from} to ${result.to}.`);
  else log(`The update to ${result.to} failed at ${result.failedStep}; back at ${result.from}.`);
  process.exitCode = result?.outcome === "updated" ? 0 : 1;
} catch (error) {
  log(`The update failed: ${failure(error)}`);
  process.exitCode = 1;
}
