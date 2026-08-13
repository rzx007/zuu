import type { Approval, ApprovalStatus } from "@zuu/client";
import { validationError } from "../../server";
import { JsonFileStore } from "../storage/json-file-store";

const APPROVAL_HISTORY_LIMIT = 500;
const APPROVAL_STATUSES = new Set<ApprovalStatus>(["pending", "allowed", "denied", "expired"]);

export function loadApprovals(path: string): Approval[] {
  return createApprovalsStore(path).load(Array.isArray).filter(isApproval);
}

export function saveApprovals(path: string, approvals: Approval[]) {
  createApprovalsStore(path).save(approvals.slice(0, APPROVAL_HISTORY_LIMIT));
}

export function assertApprovalStatus(status: unknown): asserts status is ApprovalStatus {
  if (status !== undefined && !APPROVAL_STATUSES.has(status as ApprovalStatus)) {
    validationError("status must be pending, allowed, denied, or expired", { field: "status" });
  }
}

function createApprovalsStore(path: string) {
  return new JsonFileStore<unknown[]>({
    name: "approvals",
    path,
    defaultValue: [],
    countRecords: (value) => value.length,
  });
}

function isApproval(value: unknown): value is Approval {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      "sessionId" in value &&
      "runId" in value &&
      "status" in value,
  );
}
