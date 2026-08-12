import {
  DefaultPackageManager,
  type ProgressEvent,
} from "@earendil-works/pi-coding-agent";
import type {
  PackageInstallResponse,
  PackageMutationRequest,
  PackageOperationAction,
  PackageOperationStartResponse,
  PackageSummary,
  PackagesResponse,
} from "@zuu/client";
import { assertPinnedPackageSource, normalizePackageSource, packageSourceToString } from "./environment";
import { createSettingsManager, createTrustedSettingsView } from "./package-settings";
import { PackageOperationStore } from "./package-operations";
import { PackageTrustStore } from "./package-trust";

export class PackageService {
  private readonly operations: PackageOperationStore;
  private readonly trust: PackageTrustStore;

  constructor(
    private readonly cwd: string,
    private readonly agentDir: string,
    packageOperationStorePath: string,
    packageTrustStorePath: string,
  ) {
    this.operations = new PackageOperationStore(packageOperationStorePath);
    this.trust = new PackageTrustStore(packageTrustStorePath);
  }

  list(): PackagesResponse {
    return {
      packages: this.listDetails(),
    };
  }

  async add(request: PackageMutationRequest): Promise<PackagesResponse> {
    const source = normalizePackageSource(request.source);
    assertPinnedPackageSource(source);
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
    assertPinnedPackageSource(source);
    this.assertTrusted(source);
    const operation = this.startOperation(source, "install");
    void this.runPackageOperation(operation.id, source, "install");
    return { operation, ...this.list() };
  }

  remove(request: PackageMutationRequest): PackageOperationStartResponse {
    const source = normalizePackageSource(request.source);
    const operation = this.startOperation(source, "remove");
    void this.runPackageOperation(operation.id, source, "remove");
    return { operation, ...this.list() };
  }

  update(request: PackageMutationRequest): PackageOperationStartResponse {
    const source = normalizePackageSource(request.source);
    assertPinnedPackageSource(source);
    this.assertTrusted(source);
    const operation = this.startOperation(source, "update");
    void this.runPackageOperation(operation.id, source, "update");
    return { operation, ...this.list() };
  }

  trustPackage(request: PackageMutationRequest): PackagesResponse {
    const source = normalizePackageSource(request.source);
    assertPinnedPackageSource(source);
    this.trust.trust(source);
    return this.list();
  }

  revokeTrust(request: PackageMutationRequest): PackagesResponse {
    const source = normalizePackageSource(request.source);
    this.trust.revoke(source);
    return this.list();
  }

  listOperations() {
    return { operations: this.operations.list() };
  }

  getOperation(operationId: string) {
    return { operation: this.operations.get(operationId) };
  }

  createTrustedSettingsManager(cwd = this.cwd) {
    return createTrustedSettingsView(cwd, this.agentDir, this.trust).settingsManager;
  }

  listTrustedPackageSources(cwd = this.cwd) {
    return createTrustedSettingsView(cwd, this.agentDir, this.trust).trustedPackages;
  }

  listBlockedPackageSources(cwd = this.cwd) {
    return createTrustedSettingsView(cwd, this.agentDir, this.trust).blockedPackages;
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
        const trust = this.trust.get(source);
        return {
          source,
          scope,
          filtered,
          installedPath,
          status: filtered ? "filtered" : installedPath ? "installed" : "configured",
          trustStatus: trust.status,
          trusted: trust.status === "trusted",
          trustedAt: trust.trustedAt,
          loadStatus: trust.status === "trusted" ? "enabled" : "blocked",
          blockedReason: trust.status === "trusted" ? undefined : "Package source is not trusted.",
        };
      })
      .sort((a, b) => a.source.localeCompare(b.source));
  }

  private createSettingsManager() {
    return createSettingsManager(this.cwd, this.agentDir);
  }

  private createPackageManager(settingsManager = this.createSettingsManager()) {
    return new DefaultPackageManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager,
    });
  }

  private startOperation(source: string, action: PackageOperationAction) {
    const operation = this.operations.create(source, action);
    this.operations.addEvent(operation.id, {
      type: "progress",
      action,
      source,
      message: `${action} queued.`,
    });
    return operation;
  }

  private async runPackageOperation(operationId: string, source: string, action: PackageOperationAction) {
    const packageManager = this.createPackageManager();
    packageManager.setProgressCallback((event) => this.recordProgress(operationId, event));

    try {
      if (action === "install") {
        await packageManager.installAndPersist(source);
      } else if (action === "remove") {
        await packageManager.removeAndPersist(source);
        this.trust.revoke(source);
      } else {
        await packageManager.update(source);
      }
      this.operations.finish(operationId, "done");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const operation = this.operations.get(operationId);
      const lastEvent = operation.events[operation.events.length - 1];
      if (lastEvent?.type !== "error" || lastEvent.message !== message) {
        this.operations.addEvent(operationId, {
          type: "error",
          action,
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

  private assertTrusted(source: string) {
    if (!this.trust.isTrusted(source)) {
      throw new Error("Package source must be trusted before this operation");
    }
  }
}
