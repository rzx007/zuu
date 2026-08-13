import type {
  PackageInstallResponse,
  PackageMutationRequest,
  PackageOperationAction,
  PackageOperationStartResponse,
  PackagesResponse,
} from "@zuu/client";
import { ApiError } from "../http";
import { assertPinnedPackageSource, normalizePackageSource, packageSourceToString } from "./environment";
import { createPackageManager } from "./package-manager";
import { PackageOperationRunner } from "./package-operation-runner";
import { createSettingsManager, createTrustedSettingsView } from "./package-settings";
import { PackageOperationStore } from "./package-operations";
import { listPackageSummaries } from "./package-summary";
import { PackageTrustStore } from "./package-trust";

export class PackageService {
  private readonly operations: PackageOperationStore;
  private readonly trust: PackageTrustStore;
  private readonly runner: PackageOperationRunner;

  constructor(
    private readonly cwd: string,
    private readonly agentDir: string,
    packageOperationStorePath: string,
    packageTrustStorePath: string,
  ) {
    this.operations = new PackageOperationStore(packageOperationStorePath);
    this.trust = new PackageTrustStore(packageTrustStorePath);
    this.runner = new PackageOperationRunner(cwd, agentDir, this.operations, this.trust);
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
    void this.runner.run(operation.id, source, "install");
    return { operation, ...this.list() };
  }

  remove(request: PackageMutationRequest): PackageOperationStartResponse {
    const source = normalizePackageSource(request.source);
    const operation = this.startOperation(source, "remove");
    void this.runner.run(operation.id, source, "remove");
    return { operation, ...this.list() };
  }

  update(request: PackageMutationRequest): PackageOperationStartResponse {
    const source = normalizePackageSource(request.source);
    assertPinnedPackageSource(source);
    this.assertTrusted(source);
    const operation = this.startOperation(source, "update");
    void this.runner.run(operation.id, source, "update");
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

  private listDetails() {
    const settingsManager = this.createSettingsManager();
    const packageManager = this.createPackageManager(settingsManager);
    return listPackageSummaries(settingsManager, packageManager, this.trust);
  }

  private createSettingsManager() {
    return createSettingsManager(this.cwd, this.agentDir);
  }

  private createPackageManager(settingsManager = this.createSettingsManager()) {
    return createPackageManager(this.cwd, this.agentDir, settingsManager);
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

  private assertTrusted(source: string) {
    if (!this.trust.isTrusted(source)) {
      throw new ApiError("Package source must be trusted before this operation", {
        status: 403,
        code: "package_untrusted",
        details: { source },
      });
    }
  }
}
