const MASK = "••••••••";

/** The public half with its key hidden, its type and comment left: `ssh-ed25519 •••••••• the-office@host`. */
export function maskedPublicKey(publicKey: string): string {
  const [type, , ...comment] = publicKey.trim().split(/\s+/);
  return [type, MASK, ...comment].join(" ");
}
