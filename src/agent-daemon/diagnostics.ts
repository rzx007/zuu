import {
  DefaultResourceLoader,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
  getApprovalStorePath,
  getPackageOperationStorePath,
  getPackageTrustStorePath,
  getRunEventStorePath,
  getRunStorePath,
  getScheduleStorePath,
  getWorkflowStorePath,
  getZuuAgentDir,
  sdkVersion,
} from "./environment";
import { inspectJsonStore } from "./json-file-store";
import { createTrustedSettingsView } from "./package-settings";
import { PackageTrustStore } from "./package-trust";
import type { Diagnostics, ResourceDiagnostic, WorkflowBackendInfo } from "@zuu/client";

let sdkInfo: ReturnType<typeof sdkVersion> | undefined;

function getSdkInfo() {
  sdkInfo ??= sdkVersion();
  return sdkInfo;
}

export async function buildDiagnostics(
  modelRuntime: ModelRuntime,
  workflowBackend: WorkflowBackendInfo,
  activeModel?: string,
): Promise<Diagnostics> {
  const cwd = process.cwd();
  const agentDir = getZuuAgentDir();
  const trustStore = new PackageTrustStore(getPackageTrustStorePath(agentDir));
  const packageView = createTrustedSettingsView(cwd, agentDir, trustStore);
  const settingsManager = packageView.settingsManager;
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
  await resourceLoader.reload();

  const available = await modelRuntime.getAvailable();
  const sdk = getSdkInfo();
  const extensionResult = resourceLoader.getExtensions();
  const skills = resourceLoader.getSkills();
  const prompts = resourceLoader.getPrompts();
  const themes = resourceLoader.getThemes();
  const configuredProviders = modelRuntime
    .getProviders()
    .filter((provider) => modelRuntime.hasConfiguredAuth(provider.id))
    .map((provider) => provider.id);

  const packages = packageView.trustedPackages;
  const blockedPackages = packageView.blockedPackages;
  const stores = [
    inspectJsonStore({ name: "runs", path: getRunStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "run-events", path: getRunEventStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "approvals", path: getApprovalStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "workflow-runs", path: getWorkflowStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "schedules", path: getScheduleStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "package-operations", path: getPackageOperationStorePath(agentDir), defaultValue: [] }),
    inspectJsonStore({ name: "package-trust", path: getPackageTrustStorePath(agentDir), defaultValue: [] }),
  ];
  const gaps: string[] = [];
  if (stores.some((store) => store.recovered)) {
    gaps.push("One or more JSON stores were recovered from corrupt data; inspect resource store diagnostics and backups.");
  }
  if (stores.some((store) => !store.ok)) {
    gaps.push("One or more JSON stores are not healthy; inspect store diagnostics before relying on persisted state.");
  }
  if (blockedPackages.length > 0) {
    gaps.push(`${blockedPackages.length} package source(s) are configured but blocked until trusted.`);
  }
  if (!packages.some((item) => item.includes("@agwab/pi-workflow"))) {
    gaps.push("Workflow/subagent orchestration is not installed; add npm:@agwab/pi-workflow for reusable workflows.");
  }
  if (workflowBackend.kind === "pi-package" && workflowBackend.status !== "ready") {
    gaps.push(workflowBackend.message ?? "Pi workflow backend is not ready.");
  }
  if (!packages.some((item) => item.includes("pi-crew"))) {
    gaps.push("Scheduler MVP supports once/interval locally; cron/timezone orchestration still needs pi-crew or another cron-capable adapter.");
  }
  if (available.length === 0) {
    gaps.push("No authenticated model is available; configure provider auth in ~/.pi/agent/auth.json or environment variables.");
  }
  const resourceDiagnostics: ResourceDiagnostic[] = [
    ...extensionResult.errors.map((error): ResourceDiagnostic => ({
      type: "error",
      message: error.error,
      path: error.path,
    })),
    ...skills.diagnostics,
    ...prompts.diagnostics,
    ...themes.diagnostics,
  ];
  if (resourceDiagnostics.some((diagnostic) => diagnostic.type === "collision")) {
    gaps.push("One or more package resources have name collisions; inspect resource diagnostics before relying on the loaded tools or skills.");
  }

  return {
    ok:
      extensionResult.errors.length === 0 &&
      !resourceDiagnostics.some((diagnostic) => diagnostic.type === "error") &&
      stores.every((store) => store.ok) &&
      available.length > 0,
    cwd,
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      nodeVersionRequired: sdk.engines?.node ?? ">=22.19.0",
    },
    sdk: {
      package: "@earendil-works/pi-coding-agent",
      version: sdk.version,
    },
    models: {
      configuredProviders,
      availableCount: available.length,
      active: activeModel,
      error: modelRuntime.getError(),
    },
    resources: {
      skills: skills.skills.length,
      prompts: prompts.prompts.length,
      extensions: extensionResult.extensions.length,
      extensionErrors: extensionResult.errors,
      resourceDiagnostics,
      packages,
      blockedPackages,
      stores,
      workflowBackend,
    },
    gaps,
  };
}
