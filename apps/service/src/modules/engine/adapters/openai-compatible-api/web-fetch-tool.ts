import { z } from "zod";
import {
  builtInTool,
  failure,
  success,
  type BuiltInTool,
  type ToolOutput,
} from "./built-in-tool.js";
import {
  DEFAULT_WEB_PAGE_LIMITS,
  fetchWebPage,
  isWebUrl,
  sizeInWords,
  type WebPage,
  type WebPageLimits,
} from "./web-page.js";

const webFetchInput = z.object({
  url: z
    .url()
    .refine((url) => isWebUrl(new URL(url)), "The URL must be http or https.")
    .describe("The URL to fetch content from"),
  prompt: z.string().min(1).describe("The prompt to run on the fetched content"),
});

/**
 * Claude Code's WebFetch, under its name and input. Claude Code answers `prompt` with a small
 * model; this loop has only the session's own model, so the page itself is the answer, cut to a
 * length, with the prompt for the model to answer from it.
 */
export function webFetchTool(limits: WebPageLimits = DEFAULT_WEB_PAGE_LIMITS): BuiltInTool {
  return builtInTool({
    name: "WebFetch",
    description: [
      "Fetches a web page and returns its content, an HTML page as Markdown, for you to answer the prompt from.",
      `- The URL must be http or https; the content is cut to its first ${limits.maxCharacters} characters.`,
      "- A redirect to another host is not followed: it answers with the URL it points to, for you to fetch with WebFetch again.",
      `- It reads text and HTML only, nothing larger than ${sizeInWords(limits.maxBytes)}.`,
    ].join("\n"),
    input: webFetchInput,
    run: async ({ url, prompt }, _context, signal) =>
      fetchOutput(await fetchWebPage(new URL(url), limits, signal), prompt),
  });
}

function fetchOutput(page: WebPage, prompt: string): ToolOutput {
  switch (page.kind) {
    case "page":
      return success(`Content of ${page.url}, for the prompt: ${prompt}\n\n${page.text}`);
    case "redirected":
      // Claude Code's words for a redirect it doesn't follow.
      return success(
        [
          "REDIRECT DETECTED: The URL redirects to a different host.",
          "",
          `Original URL: ${page.from}`,
          `Redirect URL: ${page.to}`,
          `Status: ${page.status}`,
          "",
          "To complete your request, fetch the redirected URL with WebFetch again:",
          `- url: "${page.to}"`,
          `- prompt: "${prompt}"`,
        ].join("\n"),
      );
    case "failed":
      return failure(page.problem);
  }
}
