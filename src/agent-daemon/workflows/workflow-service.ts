import type { PromptRequest, PromptStreamEvent, RunSummary, StartWorkflowRequest } from "@zuu/client";
import { notFound } from "../../server";
import { getWorkflowStorePath } from "../core/agent-paths";
import type { PackageService } from "../packages/packages";
import type { ProjectRegistry } from "../projects/project-service";
import { createWorkflowBackend } from "./workflows";

export interface WorkflowServiceOptions {
  agentDir: string;
  packageService: PackageService;
  projects: ProjectRegistry;
  runPrompt: (request: PromptRequest) => AsyncGenerator<PromptStreamEvent>;
  launchPrompt: (request: PromptRequest) => Promise<RunSummary>;
  abortAgentRun?: (runId: string, projectId?: string) => Promise<unknown>;
}

export class WorkflowService {
  private backend?: ReturnType<typeof createWorkflowBackend>;
  private backendSignature?: string;

  constructor(private readonly options: WorkflowServiceOptions) {}

  getBackendInfo() {
    return this.createBackend().getInfo();
  }

  listWorkflows(projectId?: string) {
    const project = this.options.projects.get(projectId);
    const backend = this.createBackend();
    return backend.listDefinitions(project).then((workflows) => ({ workflows, backend: backend.getInfo() }));
  }

  startWorkflow(workflowId: string, request: StartWorkflowRequest = {}, projectId?: string) {
    const project = this.options.projects.get(projectId ?? request.projectId);
    return this.createBackend().start(workflowId, {
      ...request,
      projectId: project.id,
    }, project);
  }

  async listWorkflowRuns(projectId?: string) {
    if (projectId) this.options.projects.get(projectId);
    const runs = await this.createBackend().listRuns();
    return runs.filter((run) => !projectId || run.projectId === projectId);
  }

  async getWorkflowRun(runId: string, projectId?: string) {
    if (projectId) this.options.projects.get(projectId);
    const run = await this.createBackend().getRun(runId);
    if (projectId && run.projectId !== projectId) notFound(`Unknown workflow run: ${runId}`, { runId, projectId });
    return run;
  }

  async listWorkflowStages(runId: string, projectId?: string) {
    const run = await this.getWorkflowRun(runId, projectId);
    return run.stages;
  }

  async listWorkflowTasks(runId: string, projectId?: string) {
    const run = await this.getWorkflowRun(runId, projectId);
    return run.tasks;
  }

  async getWorkflowArtifact(artifactId: string, projectId?: string) {
    if (projectId) this.options.projects.get(projectId);
    const runs = await this.listWorkflowRuns(projectId);
    const artifact = runs.flatMap((run) => run.artifacts).find((item) => item.id === artifactId);
    if (!artifact) notFound(`Unknown workflow artifact: ${artifactId}`, { artifactId, projectId });
    return artifact;
  }

  async abortWorkflowRun(runId: string, projectId?: string) {
    await this.getWorkflowRun(runId, projectId);
    return this.createBackend().abort(runId);
  }

  private createBackend() {
    const packages = this.options.packageService.listTrustedPackageSources();
    const requestedKind = process.env.ZUU_WORKFLOW_BACKEND;
    const signature = JSON.stringify({ requestedKind, packages });
    if (this.backend && this.backendSignature === signature) return this.backend;

    this.backend = createWorkflowBackend({
      path: getWorkflowStorePath(this.options.agentDir),
      packages,
      requestedKind,
      agentDir: this.options.agentDir,
      runPrompt: this.options.runPrompt,
      launchPrompt: this.options.launchPrompt,
      abortAgentRun: this.options.abortAgentRun,
    });
    this.backendSignature = signature;
    return this.backend;
  }
}
