import type {
  PromptRequest,
  RunSummary,
  StartWorkflowRequest,
  WorkflowBackendInfo,
  WorkflowDefinition,
  WorkflowRun,
  PromptStreamEvent,
  ProjectSummary,
} from "@zuu/client";

export interface WorkflowBackend {
  getInfo(): WorkflowBackendInfo;
  listDefinitions(project?: ProjectSummary): Promise<WorkflowDefinition[]>;
  start(workflowId: string, request: StartWorkflowRequest, project?: ProjectSummary): Promise<WorkflowRun>;
  listRuns(): Promise<WorkflowRun[]>;
  getRun(runId: string): Promise<WorkflowRun>;
  abort(runId: string): Promise<WorkflowRun>;
}

export interface WorkflowBackendOptions {
  path: string;
  packages: string[];
  requestedKind?: string;
  launchPrompt?: (request: PromptRequest) => Promise<RunSummary>;
  runPrompt?: (request: PromptRequest) => AsyncGenerator<PromptStreamEvent>;
  abortAgentRun?: (runId: string, projectId?: string) => Promise<unknown>;
}
