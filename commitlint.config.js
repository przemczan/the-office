// Conventional Commits, as AGENTS.md's "Commits and releases" states them; tools/commit-check runs it.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // The subject is a plain sentence, so it may start with a capital or a name.
    "subject-case": [0],
    // A body or footer may hold a long link.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
