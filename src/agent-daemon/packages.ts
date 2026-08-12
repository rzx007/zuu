import {
  DefaultPackageManager,
  SettingsManager,
  type ProgressEvent,
} from "@earendil-works/pi-coding-agent";
import type {
  PackageInstallResponse,
  PackageMutationRequest,
  PackageSummary,
  PackagesResponse,
} from "@zuu/client";
import { normalizePackageSource, packageSourceToString } from "./environment";
import { PackageOperationStore } from "./package-operations";

export class PackageService {
  private readonly operations: PackageOperationStore;

  constructor(
    private readonly cwd: string,
    private readonly agentDir: string,
    packageOperationStorePath: string,
  ) {
    this.operations = new PackageOperationStore(packageOperationStorePath);
  }

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

  install(request: PackageMutationRequest): PackageInstallResponse {
    const source = normalizePackageSource(request.source);
    const operation = this.operations.create(source, "install");
    this.operations.addEvent(operation.id, {
      type: "progress",
      action: "install",
      source,
      message: "Install queued.",
    });
    void this.runInstallOperation(operation.id, source);
    return { operation, ...this.list() };
  }

  async remove(request: PackageMutationRequest): Promise<PackagesResponse> {
    const source = normalizePackageSource(request.source);
    const settingsManager = this.createSettingsManager();
    const packages = settingsManager.getPackages().map(packageSourceToString);
    settingsManager.setPackages(packages.filter((item) => item !== source));
    await settingsManager.flush();
    return this.list();
  }

  listOperations() {
    return { operations: this.operations.list() };
  }

  getOperation(operationId: string) {
    return { operation: this.operations.get(operationId) };
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

  private async runInstallOperation(operationId: string, source: string) {
    const packageManager = this.createPackageManager();
    packageManager.setProgressCallback((event) => this.recordProgress(operationId, event));

    try {
      await packageManager.installAndPersist(source);
      this.operations.finish(operationId, "done");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const operation = this.operations.get(operationId);
      const lastEvent = operation.events[operation.events.length - 1];
      if (lastEvent?.type !== "error" || lastEvent.message !== message) {
        this.operations.addEvent(operationId, {
          type: "error",
          action: "install",
          source,
          message,
        });
      }
      this.operations.finish(operationId, "error", message);
    } finally {
      packageManager.setProgressCallback(undefined);
    }
  }

  private recordProgress(operationId: string, event: ProgressEvent) {
    this.operations.addEvent(operationId, {
      type: event.type,
      action: event.action,
      source: event.source,
      message: event.message,
    });
  }
}
