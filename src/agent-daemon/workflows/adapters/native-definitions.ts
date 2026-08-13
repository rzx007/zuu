import type { WorkflowDefinition } from "@zuu/client";

export type NativeWorkflowKind = "single" | "sequence" | "dag";

export interface NativeWorkflowStep {
  id: string;
  name: string;
  prompt: string;
  dependsOn?: string[];
}

export interface NativeWorkflowDefinition extends WorkflowDefinition {
  kind: NativeWorkflowKind;
  steps: NativeWorkflowStep[];
}

const NATIVE_WORKFLOW_VERSION = "native-0.1.0";

export const NATIVE_WORKFLOWS: NativeWorkflowDefinition[] = [
  {
    id: "project-review",
    name: "Project Review",
    description: "Run a two-step native review workflow and produce task artifacts.",
    version: NATIVE_WORKFLOW_VERSION,
    tags: ["native", "review", "sequence"],
    kind: "sequence",
    steps: [
      {
        id: "inspect",
        name: "Inspect Project",
        prompt: "Inspect the current project structure and identify the most important implementation facts.",
      },
      {
        id: "summarize",
        name: "Summarize Review",
        prompt: "Using the upstream artifact context, summarize risks, gaps, and the next implementation step.",
        dependsOn: ["inspect"],
      },
    ],
  },
  {
    id: "deep-research",
    name: "Deep Research",
    description: "Run a small native DAG with parallel evidence gathering and final synthesis.",
    version: NATIVE_WORKFLOW_VERSION,
    tags: ["native", "research", "dag"],
    kind: "dag",
    steps: [
      {
        id: "scope",
        name: "Scope Research",
        prompt: "Clarify the research scope, constraints, and acceptance criteria.",
      },
      {
        id: "evidence",
        name: "Gather Evidence",
        prompt: "Gather implementation evidence from the project and identify supporting facts.",
        dependsOn: ["scope"],
      },
      {
        id: "synthesis",
        name: "Synthesize Findings",
        prompt: "Synthesize upstream artifacts into an actionable workflow result.",
        dependsOn: ["scope", "evidence"],
      },
    ],
  },
  {
    id: "release-notes",
    name: "Release Notes",
    description: "Generate release-note style output through one native worker task.",
    version: NATIVE_WORKFLOW_VERSION,
    tags: ["native", "docs", "single"],
    kind: "single",
    steps: [
      {
        id: "draft",
        name: "Draft Notes",
        prompt: "Draft concise release notes for the recent work in this project.",
      },
    ],
  },
];

export function toPublicWorkflowDefinition(definition: NativeWorkflowDefinition): WorkflowDefinition {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    version: definition.version,
    tags: definition.tags,
  };
}
