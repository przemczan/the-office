import { promptTemplate } from "./prompt-template.js";

/** A template that uses each kind of variable. */
export const A_TEMPLATE = promptTemplate({
  key: "pipelines.a-brief",
  domain: "pipelines",
  name: "A Brief",
  description: "A Brief for the tests.",
  variables: {
    title: { kind: "text", description: "The Task's title." },
    urgent: { kind: "flag", description: "Whether it is urgent." },
    files: { kind: "list", description: "The files." },
    stages: {
      kind: "list",
      description: "The Stages.",
      fields: { name: "The Stage's name.", outcome: "How it ended." },
    },
  },
  text: "Work on {{title}}.{{#urgent}} It is urgent.{{/urgent}}",
});
