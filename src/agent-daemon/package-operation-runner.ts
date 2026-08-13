import type { ProgressEvent } from "@earendil-works/pi-coding-agent";
import type { PackageOperationAction } from "@zuu/client";
import { createPackageManager } from "./package-manager";
import { PackageOperationStore } from "./package-operations";
import { PackageTrustStore } from "./package-trust";

export class PackageOperationRunner {
  constructor(
    private readonly cwd: string,
    private readonly agentDir: string,
    private readonly operations: PackageOperationStore,
    private readonly trust: PackageTrustStore,
  ) {}

  async run(operationId: string, source: string, action: PackageOperationAction) {
    const packageManager = createPackageManager(this.cwd, this.agentDir);
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
}
