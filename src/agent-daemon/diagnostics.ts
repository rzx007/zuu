import {
  DefaultResourceLoader,
  SettingsManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { getZuuAgentDir, packageSourceToString, sdkVersion } from "./environment";
import type { Diagnostics } from "@zuu/client";

let sdkInfo: ReturnType<typeof sdkVersion> | undefined;

function getSdkInfo() {
  sdkInfo ??= sdkVersion();
  return sdkInfo;
}

export async function buildDiagnostics(modelRuntime: ModelRuntime, activeModel?: string): Promise<Diagnostics> {
  const cwd = process.cwd();
  const agentDir = getZuuAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
  await resourceLoader.reload();

  const available = await modelRuntime.getAvailable();
  const sdk = getSdkInfo();
  const extensionResult = resourceLoader.getExtensions();
  const configuredProviders = modelRuntime
    .getProviders()
    .filter((provider) => modelRuntime.hasConfiguredAuth(provider.id))
    .map((provider) => provider.id);

  const packages = settingsManager.getPackages().map(packageSourceToString);
  const gaps: string[] = [];
  if (!packages.some((item) => item.includes("@agwab/pi-workflow"))) {
    gaps.push("Workflow/subagent orchestration is not installed; add npm:@agwab/pi-workflow for reusable workflows.");
  }
  if (!packages.some((item) => item.includes("pi-crew"))) {
    gaps.push("Cron/interval/one-shot scheduling still needs a daemon scheduler adapter or a package such as pi-crew.");
  }
  if (available.length === 0) {
    gaps.push("No authenticated model is available; configure provider auth in ~/.pi/agent/auth.json or environment variables.");
  }

  return {
    ok: extensionResult.errors.length === 0 && available.length > 0,
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
      skills: resourceLoader.getSkills().skills.length,
      prompts: resourceLoader.getPrompts().prompts.length,
      extensions: extensionResult.extensions.length,
      extensionErrors: extensionResult.errors,
      packages,
    },
    gaps,
  };
}
