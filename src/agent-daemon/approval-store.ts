import type {
  Approval,
  ApprovalStatus,
  CreateApprovalRequest,
  ResolveApprovalRequest,
} from "@zuu/client";
import { notFound, validationError } from "../http";
import { expireApprovals } from "./approval-expiration";
import {
  consumeApprovalGrant,
  createApprovalRecord,
  findConsumableApprovalGrant,
  resolveApprovalRecord,
} from "./approval-mutations";
import { JsonFileStore } from "./json-file-store";

const APPROVAL_HISTORY_LIMIT = 500;
const APPROVAL_STATUSES = new Set<ApprovalStatus>(["pending", "allowed", "denied", "expired"]);

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

function loadApprovals(path: string): Approval[] {
  return createApprovalsStore(path).load(Array.isArray).filter(isApproval);
}

function saveApprovals(path: string, approvals: Approval[]) {
  createApprovalsStore(path).save(approvals.slice(0, APPROVAL_HISTORY_LIMIT));
}

function createApprovalsStore(path: string) {
  return new JsonFileStore<unknown[]>({
    name: "approvals",
    path,
    defaultValue: [],
    countRecords: (value) => value.length,
  });
}

export function assertApprovalStatus(status: unknown): asserts status is ApprovalStatus {
  if (status !== undefined && !APPROVAL_STATUSES.has(status as ApprovalStatus)) {
    validationError("status must be pending, allowed, denied, or expired", { field: "status" });
  }
}

export class ApprovalStore {
  private readonly approvals: Map<string, Approval>;
  private readonly waiters = new Map<string, Set<(approval: Approval) => void>>();

  constructor(private readonly path: string) {
    this.approvals = new Map(loadApprovals(this.path).map((approval) => [approval.id, approval]));
  }

  create(request: CreateApprovalRequest) {
    const approval = createApprovalRecord(request);
    this.approvals.set(approval.id, approval);
    this.persist();
    return approval;
  }

  list(status?: ApprovalStatus) {
    this.expireApprovals();
    return this.sortedApprovals().filter((approval) => !status || approval.status === status);
  }

  consumeGrant(request: Pick<CreateApprovalRequest, "sessionId" | "kind" | "scope">) {
    this.expireApprovals();
    const grant = findConsumableApprovalGrant(this.sortedApprovals(), request);
    if (consumeApprovalGrant(grant)) {
      this.persist();
    }
    return grant;
  }

  get(id: string) {
    this.expireApprovals();
    const approval = this.approvals.get(id);
    if (!approval) notFound(`Unknown approval: ${id}`, { approvalId: id });
    return approval;
  }

  waitForResolution(id: string) {
    const approval = this.get(id);
    if (approval.status !== "pending") return Promise.resolve(approval);

    return new Promise<Approval>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const waiter = (next: Approval) => {
        if (timeout) clearTimeout(timeout);
        this.waiters.get(id)?.delete(waiter);
        resolve(next);
      };
      const waiters = this.waiters.get(id) ?? new Set<(next: Approval) => void>();
      waiters.add(waiter);
      this.waiters.set(id, waiters);

      if (approval.expiresAt) {
        const expiresAtMs = Date.parse(approval.expiresAt);
        if (Number.isFinite(expiresAtMs)) {
          timeout = setTimeout(() => {
            this.expireApprovals();
            if (this.waiters.has(id)) waiter(this.get(id));
          }, Math.max(0, Math.min(expiresAtMs - Date.now(), 2_147_483_647)));
        }
      }
    });
  }

  resolve(id: string, request: ResolveApprovalRequest) {
    const approval = this.get(id);
    resolveApprovalRecord(approval, id, request);
    this.persist();
    this.notifyWaiters(approval);
    return approval;
  }

  private expireApprovals() {
    const expired = expireApprovals(this.approvals.values());
    if (expired.length > 0) {
      this.persist();
      expired.forEach((approval) => this.notifyWaiters(approval));
    }
  }

  private sortedApprovals() {
    return [...this.approvals.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private persist() {
    saveApprovals(this.path, this.sortedApprovals());
  }

  private notifyWaiters(approval: Approval) {
    const waiters = this.waiters.get(approval.id);
    if (!waiters) return;
    this.waiters.delete(approval.id);
    waiters.forEach((waiter) => waiter(approval));
  }
}
