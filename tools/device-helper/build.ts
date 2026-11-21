// `node build.ts` builds the device helper (Go) for Linux, static, for both CPUs a Connected device
// may have, into dist/ with a `version` file; `node build.ts test` runs its Go tests.
//
// Without Go on the PATH the step is skipped with a warning, so a checkout without Go still builds
// the rest of The Office; under CI, or when releasing (OFFICE_RELEASE_VERSION set), it fails.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const folder = import.meta.dirname;
const dist = join(folder, "dist");
const BINARIES = [
  { goarch: "amd64", suffix: "x86_64" },
  { goarch: "arm64", suffix: "aarch64" },
] as const;

const releaseVersion = process.env["OFFICE_RELEASE_VERSION"]?.trim();
const version = releaseVersion || "checkout";
const command = process.argv[2] ?? "build";

if (command !== "build" && command !== "test") {
  console.error(`Unknown command '${command}': give build or test.`);
  process.exit(1);
}
if (spawnSync("go", ["version"], { stdio: "ignore" }).status !== 0) {
  const required = Boolean(process.env["CI"]) || Boolean(releaseVersion);
  console.error(
    `Go isn't on the PATH, so the device helper is not ${command === "build" ? "built" : "tested"}` +
      " (the version go.mod's toolchain line names, see tools/device-helper/go.mod).",
  );
  process.exit(required ? 1 : 0);
}

if (command === "test") {
  run(["test", "./..."], {});
} else {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  for (const { goarch, suffix } of BINARIES) {
    const output = join("dist", `office-device-helper-${suffix}`);
    console.log(`Building ${output} (${version})`);
    run(["build", "-trimpath", `-ldflags=-s -w -X main.version=${version}`, "-o", output, "."], {
      CGO_ENABLED: "0",
      GOOS: "linux",
      GOARCH: goarch,
    });
  }
  writeFileSync(join(dist, "version"), version);
}

function run(args: string[], env: Record<string, string>): void {
  const result = spawnSync("go", args, {
    cwd: folder,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
