import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import type { Check } from "../../check.ts";
import type { ProbeSession, SessionSpec } from "../../probe-session.ts";
import { toolCalls } from "../tool-calls.ts";
import { observeCall, type CallObservation } from "./call-observations.ts";

const BASH_DENY_RULE = "Bash(git push *)";
const POWERSHELL_TWIN = "PowerShell(git push *)";

/** Shell rule sets, each started in its own session; the first is the Office's options alone. */
const RULE_SETS: Readonly<Record<string, NonNullable<Settings["permissions"]>>> = {
  officeOptions: {},
  bashDenyRule: { deny: [BASH_DENY_RULE] },
  bashDenyRuleWithTwin: { deny: [BASH_DENY_RULE, POWERSHELL_TWIN] },
  bashDenyRuleWithPowerShellAllowRule: { deny: [BASH_DENY_RULE], allow: ["PowerShell(git status)"] },
  bashAllowRule: { allow: ["Bash(git status)"] },
};

/**
 * The docs say any Bash deny rule turns the PowerShell tool off unless a PowerShell rule exists (spec §6
 * build rules); the Office names its tools explicitly (spec §5.4), so both tool sets are read, from
 * `init` at no cost. Two turns then show a Bash rule does not reach PowerShell and its twin does, under
 * an allow rule that would otherwise let `git push` run (it fails harmlessly: the sandbox repository
 * has no remote).
 */
export const powerShellTwinCheck: Check = {
  id: "permissions.powershell-twin",
  title: "a Bash deny rule and the PowerShell tool, with the Office's tools and the engine's default; a twin rule in force",
  platforms: ["win32"],
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const shellTools = (options: SessionSpec["options"]) =>
      Promise.all(
        Object.entries(RULE_SETS).map(async ([ruleSet, permissions]) => {
          const session = await startSession({ repository, settings: { permissions }, ...(options === undefined ? {} : { options }) });
          const init = await session.initWithoutTurn();
          return [ruleSet, { bashTool: init.tools.includes("Bash"), powerShellTool: init.tools.includes("PowerShell") }] as const;
        }),
      ).then(Object.fromEntries);
    const [officeTools, engineDefaultTools, twinRuleInForce, bashRuleAlone] = await Promise.all([
      shellTools(undefined),
      shellTools({ tools: undefined }),
      pushThroughPowerShell(startSession, repository, [BASH_DENY_RULE, POWERSHELL_TWIN]),
      pushThroughPowerShell(startSession, repository, [BASH_DENY_RULE]),
    ]);
    return { tools: { officeTools, engineDefaultTools }, twinRuleInForce, bashRuleAlone: { gitPush: bashRuleAlone.gitPush } };
  },
};

async function pushThroughPowerShell(
  startSession: (spec: SessionSpec) => Promise<ProbeSession>,
  repository: string,
  deny: string[],
): Promise<Record<"gitStatus" | "gitPush", Pick<CallObservation, "outcome" | "permissionDeniedMessage">>> {
  const session = await startSession({ repository, settings: { permissions: { deny, allow: ["PowerShell(git *)"] } } });
  session.send(
    "Use the PowerShell tool to run `git status`, then the PowerShell tool to run `git push`. " +
      "Do not retry a refused command and do not use any other tool. Then reply with just OK.",
  );
  await session.nextResult();
  return { gitStatus: powerShellOutcome(session, "git status"), gitPush: powerShellOutcome(session, "git push") };
}

function powerShellOutcome(session: ProbeSession, command: string): Pick<CallObservation, "outcome" | "permissionDeniedMessage"> {
  const calls = toolCalls(session.messages).filter((call) => call.name === "PowerShell" && String(call.input["command"]).trim().startsWith(command));
  const { outcome, permissionDeniedMessage } = observeCall(session, calls);
  return { outcome, permissionDeniedMessage };
}
