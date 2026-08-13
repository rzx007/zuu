import type { WorkflowBackendInfo } from "@zuu/client";
import { createModelRuntime } from "../core/environment";
import { buildDiagnostics } from "../diagnostics/diagnostics";

export class ModelService {
  private readonly modelRuntimePromise = createModelRuntime();

  getRuntimePromise() {
    return this.modelRuntimePromise;
  }

  async diagnostics(workflowBackend: WorkflowBackendInfo, activeModel?: string) {
    return buildDiagnostics(await this.modelRuntimePromise, workflowBackend, activeModel);
  }

  async listModels() {
    const modelRuntime = await this.modelRuntimePromise;
    const models = await modelRuntime.getAvailable();
    const configuredProviders = modelRuntime
      .getProviders()
      .filter((provider) => modelRuntime.hasConfiguredAuth(provider.id))
      .map((provider) => provider.id);

    return {
      configuredProviders,
      models: models.map((model) => {
        const metadata = model as { name?: string; label?: string };
        return {
          provider: model.provider,
          id: model.id,
          label: metadata.label ?? metadata.name,
        };
      }),
    };
  }
}
