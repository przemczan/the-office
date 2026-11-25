import type { ScriptedContainerRuntime } from "../../../run-environments/index.js";

type ScriptedAttachedProcess = ScriptedContainerRuntime["attached"][number];

/**
 * adb in the scripted run environment, for tests and the end-to-end service (`src/e2e.ts`, which
 * hooks it into its scripted runtime's `onAttach`, so it is built, not a fixture): whether it is
 * there, what the helper's `adb-key` mode answers, what `adb pair` and `getprop` answer, which
 * serials `adb connect` reaches, what `adb install` answers, and every adb step the service ran, in
 * order ("command -v adb", "adb-key", "adb kill-server", "adb connect 127.0.0.1:41234", "adb pair
 * 192.168.1.20:37000").
 */
export class ScriptedAdb {
  present = true;
  /** What `adb pair` prints and exits with; "Successfully paired …" and 0 unless set. */
  pairAnswer: { readonly output: string; readonly exitCode: number } | undefined;
  /** Whether `adb pair` never ends, as with a phone that doesn't answer. */
  pairHangs = false;
  /** What each `adb pair` read on its standard input. */
  readonly pairingInputs: Buffer[] = [];
  /** The model `getprop ro.product.model` answers. */
  model = "Pixel 9";
  /** What `adb install -r` and `install-multiple -r` print and exit with; "Success" and 0 unless set. */
  installAnswer: { readonly output: string; readonly exitCode: number } | undefined;
  /** The serials `adb connect` can't reach, as a phone that left the network. */
  readonly unreachable = new Set<string>();
  /** Whether `command -v adb` is cut off with no exit code, as when its run environment stops. */
  checkStopped = false;
  /** What `adb-key` answers: `written` the first time, `same` after, unless set. */
  keyAnswer: "written" | "same" | undefined;
  readonly steps: string[] = [];
  /** What each `adb-key` step read on its standard input. */
  readonly keyInputs: Buffer[] = [];
  private keyWritten = false;

  /** Answers the attached program when it is an adb step; false for anything else. */
  answer(process: ScriptedAttachedProcess): boolean {
    const programArguments = process.attachment.arguments;
    if (programArguments.join(" ") === "sh -c command -v adb") {
      this.steps.push("command -v adb");
      if (this.checkStopped) process.stop();
      else process.end(this.present ? 0 : 1);
      return true;
    }
    if (programArguments[1] === "adb-key") {
      process.stdin.on("finish", () => {
        this.steps.push("adb-key");
        this.keyInputs.push(process.written());
        const answer = this.keyAnswer ?? (this.keyWritten ? "same" : "written");
        this.keyWritten = true;
        process.print(`${answer}\n`);
        process.end(0);
      });
      return true;
    }
    const adbArguments =
      programArguments[0] === "adb"
        ? programArguments.slice(1)
        : programArguments[0] === "sh" && programArguments[3] === "sh"
          ? programArguments.slice(4)
          : undefined;
    if (adbArguments === undefined) return false;
    this.steps.push(`adb ${adbArguments.join(" ")}`);
    if (adbArguments[0] === "pair") {
      this.pair(process, adbArguments[1] ?? "");
      return true;
    }
    if (adbArguments.includes("install") || adbArguments.includes("install-multiple")) {
      const answer = this.installAnswer ?? {
        output: "Performing Streamed Install\nSuccess\n",
        exitCode: 0,
      };
      process.print(answer.output);
      process.end(answer.exitCode);
      return true;
    }
    if (adbArguments[0] === "connect" && this.unreachable.has(adbArguments[1] ?? "")) {
      process.print(`failed to connect to '${adbArguments[1]}': No route to host\n`);
      process.end(1);
      return true;
    }
    if (adbArguments[0] === "connect") process.print(`connected to ${adbArguments[1]}\n`);
    if (adbArguments.includes("getprop")) process.print(`${this.model}\n`);
    process.end(0);
    return true;
  }

  private pair(process: ScriptedAttachedProcess, target: string): void {
    process.print("Enter pairing code: ");
    process.stdin.on("finish", () => {
      this.pairingInputs.push(process.written());
      if (this.pairHangs) return;
      const answer = this.pairAnswer ?? {
        output: `Successfully paired to ${target} [guid=adb-R5CT1234-abcdef]\n`,
        exitCode: 0,
      };
      process.print(answer.output);
      process.end(answer.exitCode);
    });
  }
}
