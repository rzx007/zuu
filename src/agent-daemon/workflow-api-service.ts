import type { StartWorkflowRequest } from "@zuu/client";
import type { WorkflowService } from "./workflow-service";

export class WorkflowApiService {
  constructor(private readonly workflows: WorkflowService) {}

  listWorkflows(projectId?: string) {
    return this.workflows.listWorkflows(projectId);
  }

  startWorkflow(workflowId: string, request: StartWorkflowRequest = {}, projectId?: string) {
    return this.workflows.startWorkflow(workflowId, request, projectId);
  }

  listWorkflowRuns(projectId?: string) {
    return this.workflows.listWorkflowRuns(projectId);
  }

  getWorkflowRun(runId: string, projectId?: string) {
    return this.workflows.getWorkflowRun(runId, projectId);
  }

  listWorkflowStages(runId: string, projectId?: string) {
    return this.workflows.listWorkflowStages(runId, projectId);
  }

  listWorkflowTasks(runId: string, projectId?: string) {
    return this.workflows.listWorkflowTasks(runId, projectId);
  }

  getWorkflowArtifact(artifactId: string, projectId?: string) {
    return this.workflows.getWorkflowArtifact(artifactId, projectId);
  }

  abortWorkflowRun(runId: string, projectId?: string) {
    return this.workflows.abortWorkflowRun(runId, projectId);
  }
}
