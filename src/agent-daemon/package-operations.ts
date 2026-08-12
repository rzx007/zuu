import { readFileSync, writeFileSync } from "node:fs";
import type {
  PackageOperation,
  PackageOperationAction,
  PackageOperationEvent,
  PackageOperationStatus,
  PackageProgressAction,
  PackageProgressEventType,
} from "@zuu/client";

const PACKAGE_OPERATION_HISTORY_LIMIT = 100;
const PACKAGE_OPERATION_EVENT_LIMIT = 200;

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

function loadPackageOperations(path: string): PackageOperation[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isPackageOperation) : [];
  } catch {
    return [];
  }
}

function savePackageOperations(path: string, operations: PackageOperation[]) {
  writeFileSync(path, `${JSON.stringify(operations.slice(0, PACKAGE_OPERATION_HISTORY_LIMIT), null, 2)}\n`, "utf8");
}

export class PackageOperationStore {
  private readonly operations: Map<string, PackageOperation>;

  constructor(private readonly path: string) {
    this.operations = new Map(loadPackageOperations(path).map((operation) => [operation.id, operation]));
    this.reconcileInterruptedOperations();
  }

  list() {
    return this.sortedOperations();
  }

  get(operationId: string) {
    const operation = this.operations.get(operationId);
    if (!operation) throw new Error(`Unknown package operation: ${operationId}`);
    return operation;
  }

  create(source: string, action: PackageOperationAction) {
    const operation: PackageOperation = {
      id: crypto.randomUUID(),
      source,
      action,
      status: "running",
      startedAt: new Date().toISOString(),
      events: [],
    };
    this.operations.set(operation.id, operation);
    this.persist();
    return operation;
  }

  addEvent(
    operationId: string,
    event: {
      type: PackageProgressEventType;
      action: PackageProgressAction;
      source: string;
      message?: string;
    },
  ) {
    const operation = this.get(operationId);
    const item: PackageOperationEvent = {
      id: crypto.randomUUID(),
      operationId,
      type: event.type,
      action: event.action,
      source: event.source,
      message: event.message,
      createdAt: new Date().toISOString(),
    };
    operation.events = [...operation.events, item].slice(-PACKAGE_OPERATION_EVENT_LIMIT);
    this.persist();
    return item;
  }

  finish(operationId: string, status: Extract<PackageOperationStatus, "done" | "error">, error?: string) {
    const operation = this.get(operationId);
    operation.status = status;
    operation.endedAt = new Date().toISOString();
    operation.error = error;
    this.persist();
    return operation;
  }

  private sortedOperations() {
    return [...this.operations.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private reconcileInterruptedOperations() {
    let changed = false;
    for (const operation of this.operations.values()) {
      if (operation.status !== "running") continue;
      const now = new Date().toISOString();
      const message = "Daemon restarted before the package operation finished.";
      operation.status = "error";
      operation.error = message;
      operation.endedAt = now;
      const event: PackageOperationEvent = {
        id: crypto.randomUUID(),
        operationId: operation.id,
        type: "error",
        action: "install",
        source: operation.source,
        message,
        createdAt: now,
      };
      operation.events = [...operation.events, event].slice(-PACKAGE_OPERATION_EVENT_LIMIT);
      changed = true;
    }
    if (changed) this.persist();
  }

  private persist() {
    savePackageOperations(this.path, this.sortedOperations());
  }
}
