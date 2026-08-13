import type { WorkflowDefinition } from "@zuu/client";

const FAKE_WORKFLOW_VERSION = "fake-0.1.0";

export const FAKE_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "project-review",
    name: "Project Review",
    description: "Inspect the current project shape and produce a review artifact.",
    version: FAKE_WORKFLOW_VERSION,
    tags: ["fake", "review"],
  },
  {
    id: "deep-research",
    name: "Deep Research",
    description: "Draft a research workflow outline without launching real subagents yet.",
    version: FAKE_WORKFLOW_VERSION,
    tags: ["fake", "research"],
  },
  {
    id: "release-notes",
    name: "Release Notes",
    description: "Summarize recent work into a release-note style artifact.",
    version: FAKE_WORKFLOW_VERSION,
    tags: ["fake", "docs"],
  },
];
