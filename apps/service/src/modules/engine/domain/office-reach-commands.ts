/** Where the running Office can be reached, as configured (spec 6 › No bypass). */
export interface OfficeReach {
  /** The port the service's API listens on. */
  readonly apiPort: number;
  /** The database's URL, with its credentials. */
  readonly databaseUrl: string;
}

/** A loopback host with a port, as `host:port` in a word: a URL's authority, or a bare pair. */
const LOOPBACK_WITH_PORT =
  /(?:^|[^\w.-])(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0):(\d+)(?!\d)(.*)$/i;

/** A word that is a loopback host alone, or a URL of one without a port. */
const LOOPBACK_HOST =
  /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0)(?:[/?#].*)?$/i;

/** What follows a URL's port when its path is exactly the health check's. */
const HEALTH_PATH = /^\/api\/health\/?(?:[?#].*)?$/;

/** What of the running Office a command's words reach, in a few words, or undefined when nothing. */
export function officeReach(words: readonly string[], reach: OfficeReach): string | undefined {
  if (namesApi(words, reach.apiPort)) return `API on port ${reach.apiPort}`;
  if (namesDatabase(words, reach.databaseUrl)) return "database";
  return undefined;
}

function namesApi(words: readonly string[], port: number): boolean {
  const withPort = words.flatMap((word) => {
    const found = LOOPBACK_WITH_PORT.exec(word);
    return found === null ? [] : [{ port: found[2], rest: found[3] ?? "" }];
  });
  const reached = withPort.filter(({ port: wordPort }) => Number(wordPort) === port);
  if (reached.some(({ rest }) => !HEALTH_PATH.test(rest))) return true;
  // A host word and a port word apart, as `nc localhost 4390`.
  return (
    reached.length === 0 &&
    words.some((word) => LOOPBACK_HOST.test(word)) &&
    words.some((word) => word === String(port))
  );
}

function namesDatabase(words: readonly string[], databaseUrl: string): boolean {
  if (words.some((word) => word.includes(databaseUrl))) return true;
  const url = parsedUrl(databaseUrl);
  if (url === undefined) return false;
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const port = url.port === "" ? "5432" : url.port;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (name === "" || host === "") return false;
  const tokens = new Set(words.flatMap((word) => word.split(/[^\w.-]+/).filter(Boolean)));
  return [name, host, port].every((part) => tokens.has(part));
}

function parsedUrl(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}
