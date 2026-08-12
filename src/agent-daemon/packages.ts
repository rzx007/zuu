import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PackageMutationRequest, PackageSummary, PackagesResponse } from "@zuu/client";
import { normalizePackageSource, packageSourceToString } from "./environment";

export class PackageService {
  constructor(
    private readonly cwd: string,
    private readonly agentDir: string,
  ) {}

  list(): PackagesResponse {
    return {
      packages: this.listDetails(),
    };
  }

  async add(request: PackageMutationRequest): Promise<PackagesResponse> {
    const source = normalizePackageSource(request.source);
    const settingsManager = this.createSettingsManager();
    const packages = settingsManager.getPackages().map(packageSourceToString);
    if (!packages.includes(source)) {
      settingsManager.setPackages([...packages, source]);
      await settingsManager.flush();
    }
    return this.list();
  }

  async install(request: PackageMutationRequest): Promise<PackagesResponse> {
    const source = normalizePackageSource(request.source);
    await this.createPackageManager().installAndPersist(source);
    return this.list();
  }

  async remove(request: PackageMutationRequest): Promise<PackagesResponse> {
    const source = normalizePackageSource(request.source);
    const settingsManager = this.createSettingsManager();
    const packages = settingsManager.getPackages().map(packageSourceToString);
    settingsManager.setPackages(packages.filter((item) => item !== source));
    await settingsManager.flush();
    return this.list();
  }

  private listDetails(): PackageSummary[] {
    const settingsManager = this.createSettingsManager();
    const packageManager = this.createPackageManager(settingsManager);
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
        return {
          source,
          scope,
          filtered,
          installedPath,
          status: filtered ? "filtered" : installedPath ? "installed" : "configured",
        };
      })
      .sort((a, b) => a.source.localeCompare(b.source));
  }

  private createSettingsManager() {
    return SettingsManager.create(this.cwd, this.agentDir, { projectTrusted: true });
  }

  private createPackageManager(settingsManager = this.createSettingsManager()) {
    return new DefaultPackageManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager,
    });
  }
}
