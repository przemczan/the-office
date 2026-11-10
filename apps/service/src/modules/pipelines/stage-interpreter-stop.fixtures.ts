import { anAgentStage } from "./pipelines-application.fixtures.js";

export const implement = anAgentStage("implement", { name: "Implement" });

export const review = anAgentStage("review", { name: "Review & fix" });
