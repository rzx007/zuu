import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { FakeWorkflowBackend } from "./adapters/fake";
import { NativeWorkflowBackend } from "./adapters/native";
import {
  createPiPackageInfo,
  resolvePiWorkflowPackage,
} from "./adapters/pi-package-info";
import { PiPackageWorkflowBackend } from "./adapters/pi-package";
import { UnavailableWorkflowBackend } from "./adapters/unavailable";
import type { WorkflowBackend, WorkflowBackendOptions } from "./adapters/types";

interface CreateWorkflowBackendOptions extends WorkflowBackendOptions {
  agentDir: string;
  cwd?: string;
}

export type { WorkflowBackend };

export function createWorkflowBackend(options: CreateWorkflowBackendOptions): WorkflowBackend {
  const packageSource = resolvePiWorkflowPackage(options.packages);
  const requestedKind =
    options.requestedKind === "pi-package" ? "pi-package" :
    options.requestedKind === "native" ? "native" :
    "fake";

  if (requestedKind === "native") {
    if (!options.runPrompt) {
      return new UnavailableWorkflowBackend({
        kind: "native",
        status: "unavailable",
        label: "Native workflow backend",
        packageInstalled: false,
        message: "Native workflow backend needs a daemon prompt runner before it can execute worker tasks.",
      });
    }

    return new NativeWorkflowBackend({
      path: options.path,
      runPrompt: options.runPrompt,
      info: {
        kind: "native",
        status: "ready",
        label: "Native workflow backend",
        packageInstalled: false,
        packageSource,
        message: "Zuu native workflow backend is ready. It runs logical subagents through isolated Pi SDK worker sessions.",
      },
    });
  }

  if (requestedKind === "pi-package") {
    const probe = probePiWorkflowPackage({
      cwd: options.cwd ?? process.cwd(),
      agentDir: options.agentDir,
      packages: options.packages,
      packageSource,
    });
    const info = createPiPackageInfo(probe);

    if (info.status !== "ready") {
      return new UnavailableWorkflowBackend(info);
    }

    if (!options.launchPrompt) {
      return new UnavailableWorkflowBackend({
        ...info,
        status: "unavailable",
        message: "Pi package workflow is ready, but no launchPrompt executor was provided by the daemon.",
      });
    }

    return new PiPackageWorkflowBackend({
      path: options.path,
      info,
      launchPrompt: options.launchPrompt,
    });
  }

  return new FakeWorkflowBackend(options.path, {
    kind: "fake",
    status: "ready",
    label: "Fake workflow backend",
    packageInstalled: Boolean(packageSource),
    packageSource,
    message: packageSource
      ? "Fake backend is active; @agwab/pi-workflow is configured and ready for pi-package mode on a supported platform."
      : "Fake backend is active; install @agwab/pi-workflow before enabling the real adapter.",
  });
}

function probePiWorkflowPackage(options: {
  cwd: string;
  agentDir: string;
  packages: string[];
  packageSource?: string;
}) {
  const settingsManager = SettingsManager.create(options.cwd, options.agentDir, { projectTrusted: true });
  const packageManager = new DefaultPackageManager({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
  });
  const packageSource = options.packageSource;
  const configured = packageSource
    ? packageManager.listConfiguredPackages().find((item) => item.source === packageSource)
    : undefined;
  const installedPath =
    configured?.installedPath ??
    (configured ? packageManager.getInstalledPath(configured.source, configured.scope) : undefined);

  return {
    packageSource,
    packageInstalled: Boolean(packageSource && installedPath),
    installedPath,
    platform: process.platform,
  };
}
