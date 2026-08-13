import {
  SettingsManager,
  type PackageSource,
} from "@earendil-works/pi-coding-agent";
import { packageSourceToString } from "../core/environment";
import { PackageTrustStore } from "./package-trust";

type SettingsScope = "global" | "project";

class SnapshotSettingsStorage {
  private values: Record<SettingsScope, string | undefined>;

  constructor(
    globalSettings: ReturnType<SettingsManager["getGlobalSettings"]>,
    projectSettings: ReturnType<SettingsManager["getProjectSettings"]>,
  ) {
    this.values = {
      global: JSON.stringify(globalSettings),
      project: JSON.stringify(projectSettings),
    };
  }

  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
    this.values[scope] = fn(this.values[scope]);
  }
}

export interface TrustedSettingsView {
  settingsManager: SettingsManager;
  allPackages: string[];
  trustedPackages: string[];
  blockedPackages: string[];
}

export function createSettingsManager(cwd: string, agentDir: string) {
  return SettingsManager.create(cwd, agentDir, { projectTrusted: true });
}

export function createTrustedSettingsView(cwd: string, agentDir: string, trustStore: PackageTrustStore): TrustedSettingsView {
  const sourceManager = createSettingsManager(cwd, agentDir);
  const globalSettings = sourceManager.getGlobalSettings();
  const projectSettings = sourceManager.getProjectSettings();
  const globalPackages = globalSettings.packages ?? [];
  const projectPackages = projectSettings.packages ?? [];
  const allPackages = uniquePackageSources([...globalPackages, ...projectPackages]);

  globalSettings.packages = filterTrustedPackageSources(globalPackages, trustStore);
  projectSettings.packages = filterTrustedPackageSources(projectPackages, trustStore);

  const settingsManager = SettingsManager.fromStorage(new SnapshotSettingsStorage(globalSettings, projectSettings), {
    projectTrusted: true,
  });
  const trustedPackages = uniquePackageSources([...(globalSettings.packages ?? []), ...(projectSettings.packages ?? [])]);

  return {
    settingsManager,
    allPackages,
    trustedPackages,
    blockedPackages: allPackages.filter((source) => !trustStore.isTrusted(source)),
  };
}

function filterTrustedPackageSources(packages: PackageSource[], trustStore: PackageTrustStore) {
  return packages.filter((source) => trustStore.isTrusted(packageSourceToString(source)));
}

function uniquePackageSources(packages: PackageSource[]) {
  return [...new Set(packages.map(packageSourceToString))].sort((a, b) => a.localeCompare(b));
}
