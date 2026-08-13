import type { AuditService } from "../audit/audit-service";
import type { PackageService } from "../packages/packages";
import type { PackageMutationRequest } from "@zuu/client";

export class PackageApiService {
  constructor(
    private readonly packages: PackageService,
    private readonly audit?: AuditService,
  ) {}

  listPackages() {
    return this.packages.list();
  }

  async addPackage(request: PackageMutationRequest) {
    return this.withPackageAudit("package.add", request, () => this.packages.add(request));
  }

  async installPackage(request: PackageMutationRequest) {
    return this.withPackageAudit("package.install", request, () => this.packages.install(request));
  }

  async removePackage(request: PackageMutationRequest) {
    return this.withPackageAudit("package.remove", request, () => this.packages.remove(request));
  }

  async updatePackage(request: PackageMutationRequest) {
    return this.withPackageAudit("package.update", request, () => this.packages.update(request));
  }

  async trustPackage(request: PackageMutationRequest) {
    return this.withPackageAudit("package.trust", request, () => this.packages.trustPackage(request));
  }

  async revokePackageTrust(request: PackageMutationRequest) {
    return this.withPackageAudit("package.revoke_trust", request, () => this.packages.revokeTrust(request));
  }

  listPackageOperations() {
    return this.packages.listOperations();
  }

  getPackageOperation(operationId: string) {
    return this.packages.getOperation(operationId);
  }

  private async withPackageAudit<T>(action: Parameters<AuditService["record"]>[0]["action"], request: PackageMutationRequest, run: () => T | Promise<T>) {
    const target = typeof request.source === "string" ? request.source : undefined;
    try {
      const result = await run();
      this.audit?.record({ action, target, details: { source: target } });
      return result;
    } catch (error) {
      this.audit?.record({
        action,
        target,
        outcome: "failure",
        details: { source: target, error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}
