// The fake GitHub server as a program of its own, for the end-to-end service: apps/web/e2e starts
// it on the port it gives, with tsx, since fixtures are left out of the build, and stops it with a
// signal. It prints one line once it listens.
import { FakeGitHub } from "./fake-github.fixtures.js";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) throw new Error("The fake GitHub server needs a port.");
const fake = await FakeGitHub.start(port);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void fake.close().finally(() => process.exit(0)));
}
console.log(`The fake GitHub server is on ${fake.urls.web}, its API on ${fake.urls.api}.`);
