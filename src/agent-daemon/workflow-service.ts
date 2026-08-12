import type { PromptRequest, RunSummary, StartWorkflowRequest } from "@zuu/client";
import { getWorkflowStorePath } from "./environment";
import type { PackageService } from "./packages";
import type { ProjectRegistry } from "./project-service";
import { createWorkflowBackend } from "./workflows";

export interface WorkflowServiceOptions {
  agentDir: string;
  packageService: PackageService;
  projects: ProjectRegistry;
  launchPrompt: (request: PromptRequest) => Promise<RunSummary>;
}

export class WorkflowService {
  constructor(private readonly options: WorkflowServiceOptions) {}

  getBackendInfo() {
    return this.createBackend().getInfo();
  }

  listWorkflows(projectId?: string) {
    if (projectId) this.options.projects.get(projectId);
    const backend = this.createBackend();
    return backend.listDefinitions().then((workflows) => ({ workflows, backend: backend.getInfo() }));
  }

  startWorkflow(workflowId: string, request: StartWorkflowRequest = {}, projectId?: string) {
    return this.createBackend().start(workflowId, {
      ...request,
      projectId: this.options.projects.get(projectId ?? request.projectId).id,
    });
  }

  async listWorkflowRuns(projectId?: string) {
    if (projectId) this.options.projects.get(projectId);
    const runs = await this.createBackend().listRuns();
    return runs.filter((run) => !projectId || run.projectId === projectId);
  }

  async getWorkflowRun(runId: string, projectId?: string) {
    if (projectId) this.options.projects.get(projectId);
    const run = await this.createBackend().getRun(runId);
    if (projectId && run.projectId !== projectId) throw new Error(`Unknown workflow run: ${runId}`);
    return run;
  }

  async abortWorkflowRun(runId: string, projectId?: string) {
    await this.getWorkflowRun(runId, projectId);
    return this.createBackend().abort(runId);
  }

  private createBackend() {
    return createWorkflowBackend({
      path: getWorkflowStorePath(this.options.agentDir),
      packages: this.options.packageService.listTrustedPackageSources(),
      requestedKind: process.env.ZUU_WORKFLOW_BACKEND,
      agentDir: this.options.agentDir,
      launchPrompt: this.options.launchPrompt,
    });
  }
}
