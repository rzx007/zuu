import type { PackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PackageSummary } from "@zuu/client";
import { packageSourceToString } from "../core/environment";
import type { PackageTrustStore } from "./package-trust";

export function listPackageSummaries(
  settingsManager: SettingsManager,
  packageManager: PackageManager,
  trustStore: PackageTrustStore,
): PackageSummary[] {
  const configured = packageManager.listConfiguredPackages();
  const sources = new Set([
    ...settingsManager.getPackages().map(packageSourceToString),
    ...configured.map((item) => item.source),
  ]);

  return [...sources]
    .map((source): PackageSummary => {
      const item = configured.find((candidate) => candidate.source === source);
      const scope = item?.scope ?? "user";
      const installedPath = item?.installedPath ?? packageManager.getInstalledPath(source, scope);
      const filtered = item?.filtered ?? false;
      const trust = trustStore.get(source);
      const trusted = trust.status === "trusted";

      return {
        source,
        scope,
        filtered,
        installedPath,
        status: filtered ? "filtered" : installedPath ? "installed" : "configured",
        trustStatus: trust.status,
        trusted,
        trustedAt: trust.trustedAt,
        loadStatus: trusted ? "enabled" : "blocked",
        blockedReason: trusted ? undefined : "Package source is not trusted.",
      };
    })
    .sort((a, b) => a.source.localeCompare(b.source));
}
