import type { ModelSmokeRequest, PromptRequest, PromptStreamEvent, WorkflowBackendInfo } from "@zuu/client";
import type { ModelService } from "../models/model-service";
import { runModelSmoke } from "../models/model-smoke";

interface ModelApiServiceDeps {
  workflowBackend(): WorkflowBackendInfo;
  activeModel?(): string | undefined;
  prompt(request: PromptRequest): AsyncGenerator<PromptStreamEvent>;
  abortSession(sessionId: string): Promise<unknown>;
  deleteSession(sessionId: string): Promise<unknown>;
}

export class ModelApiService {
  constructor(
    private readonly models: ModelService,
    private readonly deps: ModelApiServiceDeps,
  ) {}

  diagnostics() {
    return this.models.diagnostics(this.deps.workflowBackend(), this.deps.activeModel?.());
  }

  listModels() {
    return this.models.listModels();
  }

  smokeModel(request: ModelSmokeRequest = {}) {
    return runModelSmoke(request, {
      prompt: (promptRequest) => this.deps.prompt(promptRequest),
      abortSession: (sessionId) => this.deps.abortSession(sessionId),
      deleteSession: (sessionId) => this.deps.deleteSession(sessionId),
    });
  }
}
