import type { PackageOperation } from "@zuu/client";
import { JsonFileStore } from "../storage/json-file-store";

const PACKAGE_OPERATION_HISTORY_LIMIT = 100;

export function loadPackageOperations(path: string): PackageOperation[] {
  return createPackageOperationStore(path).load(Array.isArray).filter(isPackageOperation);
}

export function savePackageOperations(path: string, operations: PackageOperation[]) {
  createPackageOperationStore(path).save(operations.slice(0, PACKAGE_OPERATION_HISTORY_LIMIT));
}

function createPackageOperationStore(path: string) {
  return new JsonFileStore<unknown[]>({
    name: "package-operations",
    path,
    defaultValue: [],
    countRecords: (value) => value.length,
  });
}

function isPackageOperation(value: unknown): value is PackageOperation {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      "source" in value &&
      "action" in value &&
      "status" in value &&
      "startedAt" in value &&
      "events" in value,
  );
}
