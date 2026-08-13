import type { PackageMutationRequest, PackageOperationAction } from "@zuu/client";
import { ApiError } from "../http";
import { assertPinnedPackageSource, normalizePackageSource } from "./environment";
import type { PackageOperationStore } from "./package-operations";
import type { PackageTrustStore } from "./package-trust";

export function pinnedPackageSource(request: PackageMutationRequest) {
  const source = packageMutationSource(request);
  assertPinnedPackageSource(source);
  return source;
}

export function packageMutationSource(request: PackageMutationRequest) {
  return normalizePackageSource(request.source);
}

export function trustedPinnedPackageSource(request: PackageMutationRequest, trust: PackageTrustStore) {
  const source = pinnedPackageSource(request);
  assertPackageTrusted(source, trust);
  return source;
}

export function assertPackageTrusted(source: string, trust: PackageTrustStore) {
  if (!trust.isTrusted(source)) {
    throw new ApiError("Package source must be trusted before this operation", {
      status: 403,
      code: "package_untrusted",
      details: { source },
    });
  }
}

export function startPackageOperation(
  operations: PackageOperationStore,
  source: string,
  action: PackageOperationAction,
) {
  const operation = operations.create(source, action);
  operations.addEvent(operation.id, {
    type: "progress",
    action,
    source,
    message: `${action} queued.`,
  });
  return operation;
}
