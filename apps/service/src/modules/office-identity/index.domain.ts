/**
 * The domain entry of the module: the pure values of its domain other modules use. It re-exports
 * only its own `domain/`, so importing it loads no Nest module, no port and no adapter
 * (apps/service/docs/module-template.md); the fake GitHub, which the end-to-end tests run with tsx,
 * takes GitHub's host key from here. Everything here is in `index.ts` too.
 */
export { GITHUB_ED25519 } from "./domain/github-host-key.js";
