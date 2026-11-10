import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PRINT_ENVIRONMENT = `
const { delimiter } = require("node:path");
for (const name of ["GREETING", "LEFT_OVER", "NODE_ENV", "DATABASE_URL"]) {
  console.log(name + "=" + (process.env[name] ?? ""));
}
const path = Object.entries(process.env).find(([name]) => name.toUpperCase() === "PATH")[1];
console.log("PATH starts with " + path.split(delimiter)[0]);
`;

/**
 * Starts a process that holds its output open and writes its id to the file named first. Then
 * either sleeps, or with "and-exit" leaves the process running on its own and exits.
 */
const LEAVE_A_PROCESS = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const exits = process.argv[3] === "and-exit";
// Detached, so Node on Windows doesn't end it with its parent.
const left = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
  stdio: "inherit",
  detached: exits,
});
writeFileSync(process.argv[2], String(left.pid));
console.log("started " + left.pid);
if (exits) left.unref();
`;

/** A temporary folder for the commands to run in, holding the scripts they run. */
export async function aCommandsFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "office-commands-"));
  await writeFile(join(folder, "print-environment.cjs"), PRINT_ENVIRONMENT);
  await writeFile(join(folder, "leave-a-process.cjs"), LEAVE_A_PROCESS);
  return folder;
}
