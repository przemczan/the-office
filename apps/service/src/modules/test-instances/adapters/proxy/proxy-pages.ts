/** A page the proxy answers itself, at a Proxy port. */
export interface ProxyPage {
  readonly status: number;
  readonly html: string;
}

/** Where The Office is, from the address the browser reached the Proxy port at. */
export interface OfficeLink {
  /** `http://<the same hostname>:<The Office's port>/`. */
  readonly officeUrl: string;
  readonly port: number;
}

/** 401: no cookie of this instance (none, another instance's, or one of a stopped instance). */
export function openFromTheOfficePage(link: OfficeLink): ProxyPage {
  return page(401, link, {
    title: "Open this test instance from The Office",
    words:
      "This address is a test instance. It opens only from <b>Open</b> on its Initiative’s page in The Office, which signs this browser in to it alone.",
    action: "Open The Office",
  });
}

/** 403: a hand-off link used already, expired, or of another instance. */
export function usedLinkPage(link: OfficeLink): ProxyPage {
  return page(403, link, {
    title: "This link has been used or has expired",
    words:
      "A hand-off link works once, for about a minute, and for its own instance only. Press <b>Open</b> on the Initiative’s page again for a new one.",
    action: "Open The Office",
  });
}

/** 503: the port is given to no Running instance. */
export function notRunningPage(link: OfficeLink): ProxyPage {
  return page(503, link, {
    title: "No test instance is running at this port",
    words:
      "It may still be building, or it has stopped: by Stop, after its Idle time, when its Initiative ended, or when The Office restarted. Launch it again from the Initiative’s page.",
    action: "Go to The Office",
  });
}

/** 502: the instance's app didn't answer the request. */
export function appDidNotAnswerPage(link: OfficeLink): ProxyPage {
  return page(502, link, {
    title: "The test instance didn’t answer",
    words:
      "Its app may be starting again or has stopped answering. Its log on the Initiative’s page says what it did.",
    action: "Open The Office",
  });
}

const STYLE = `
:root { color-scheme: light dark; --bg: #f4f4f2; --surface: #fff; --fg-1: #0f0f0e; --fg-2: #50504c;
  --fg-3: #6b6b66; --border: #dededa; --border-subtle: #e9e9e6; --accent: #f23d0f; --accent-hover: #d4300a;
  --warning-subtle: #fff8e6; --warning-fg: #865b05; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f0f0e; --surface: #181817; --fg-1: #f4f4f2;
  --fg-2: #b1b1ab; --fg-3: #8a8a84; --border: #262624; --border-subtle: #1f1f1d;
  --warning-subtle: rgba(229, 160, 13, 0.16); --warning-fg: #f5c35c; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px 16px;
  background: var(--bg); color: var(--fg-1);
  font: 14px/1.5 "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { display: flex; flex-direction: column; gap: 12px; width: min(440px, 100%); padding: 24px;
  border: 1px solid var(--border); border-radius: 10px; background: var(--surface);
  box-shadow: 0 1px 2px rgba(16, 16, 15, 0.06); }
.brand { display: flex; gap: 8px; align-items: center; color: var(--fg-3); font-size: 12px; font-weight: 500; }
.mark { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px;
  background: var(--accent); color: #fff; font-size: 10px; font-weight: 700; }
.status { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 8px;
  background: var(--warning-subtle); color: var(--warning-fg); font-size: 12px; font-weight: 600; }
h1 { margin: 0; font-size: 20px; font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; }
p { margin: 0; color: var(--fg-2); }
a.button { align-self: flex-start; margin-top: 4px; padding: 6px 12px; border-radius: 8px;
  background: var(--accent); color: #fff; font-weight: 500; text-decoration: none; }
a.button:hover { background: var(--accent-hover); }
footer { padding-top: 10px; border-top: 1px solid var(--border-subtle); color: var(--fg-3); font-size: 12px; }
`;

function page(
  status: number,
  link: OfficeLink,
  words: { title: string; words: string; action: string },
): ProxyPage {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${words.title} · The Office</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<div class="brand"><span class="mark">O</span>The Office · Test instance</div>
<div class="status">${status}</div>
<h1>${words.title}</h1>
<p>${words.words}</p>
<a class="button" href="${escaped(link.officeUrl)}">${words.action}</a>
<footer>Proxy port ${link.port}</footer>
</main>
</body>
</html>
`;
  return { status, html };
}

function escaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
