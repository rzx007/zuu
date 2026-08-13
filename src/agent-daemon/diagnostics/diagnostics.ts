import {
  DefaultResourceLoader,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { getPackageTrustStorePath, getZuuAgentDir } from "../core/agent-paths";
import { collectDiagnosticGaps } from "./diagnostic-gaps";
import { sdkVersion } from "../core/environment";
import { inspectDiagnosticStores } from "./diagnostic-stores";
import { createTrustedSettingsView } from "../packages/package-settings";
import { PackageTrustStore } from "../packages/package-trust";
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
  const stores = inspectDiagnosticStores(agentDir);
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
  const gaps = collectDiagnosticGaps({
    agentDir,
    availableModelCount: available.length,
    packages,
    blockedPackages,
    stores,
    workflowBackend,
    resourceDiagnostics,
  });

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
