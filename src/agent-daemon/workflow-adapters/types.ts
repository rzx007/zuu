import type {
  PromptRequest,
  RunSummary,
  StartWorkflowRequest,
  WorkflowBackendInfo,
  WorkflowDefinition,
  WorkflowRun,
} from "@zuu/client";

export interface WorkflowBackend {
  getInfo(): WorkflowBackendInfo;
  listDefinitions(): Promise<WorkflowDefinition[]>;
  start(workflowId: string, request: StartWorkflowRequest): Promise<WorkflowRun>;
  listRuns(): Promise<WorkflowRun[]>;
  getRun(runId: string): Promise<WorkflowRun>;
  abort(runId: string): Promise<WorkflowRun>;
}

export interface WorkflowBackendOptions {
  path: string;
  packages: string[];
  requestedKind?: string;
  launchPrompt?: (request: PromptRequest) => Promise<RunSummary>;
}
