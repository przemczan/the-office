import type { EngineAccount } from "@the-office/contracts";

/**
 * A Claude Code engine's account in a line: the email and plan `claude auth status` gives, that a
 * pasted token signs it in (the token tells neither), or "Signed out".
 */
export function engineAccountLine(account: EngineAccount): string {
  if (!account.signedIn) return "Signed out";
  if (account.pastedToken) return "A pasted token signs it in";
  const who = account.email === null ? "Signed in" : `Signed in as ${account.email}`;
  return account.plan === null ? who : `${who} · ${planLabel("Claude", account.plan)}`;
}

/**
 * A Codex engine's account in a line: signed in with ChatGPT, with the email and plan when told,
 * signed in with an API key (the key tells neither), or "Signed out".
 */
export function codexAccountLine(account: EngineAccount): string {
  if (!account.signedIn) return "Signed out";
  if (account.apiKey) return "Signed in with an API key";
  const who =
    account.email === null
      ? "Signed in with ChatGPT"
      : `Signed in with ChatGPT as ${account.email}`;
  return account.plan === null ? who : `${who} · ${planLabel("ChatGPT", account.plan)}`;
}

/**
 * The plan comes as `max` or `pro` (Claude) or `plus` (ChatGPT); their own pages call it "Claude
 * Max" or "ChatGPT Plus".
 */
function planLabel(product: string, plan: string): string {
  return `${product} ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
}
