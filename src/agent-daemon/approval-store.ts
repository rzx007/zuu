import { readFileSync, writeFileSync } from "node:fs";
import type {
  Approval,
  ApprovalDecision,
  ApprovalStatus,
  CreateApprovalRequest,
  ResolveApprovalRequest,
} from "@zuu/client";

const APPROVAL_HISTORY_LIMIT = 500;
const APPROVAL_DECISIONS = new Set<ApprovalDecision>(["allow_once", "allow_session", "deny"]);
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
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isApproval) : [];
  } catch {
    return [];
  }
}

function saveApprovals(path: string, approvals: Approval[]) {
  writeFileSync(path, `${JSON.stringify(approvals.slice(0, APPROVAL_HISTORY_LIMIT), null, 2)}\n`, "utf8");
}

function assertDecision(decision: unknown): asserts decision is ApprovalDecision {
  if (!APPROVAL_DECISIONS.has(decision as ApprovalDecision)) {
    throw new Error("decision must be allow_once, allow_session, or deny");
  }
}

export function assertApprovalStatus(status: unknown): asserts status is ApprovalStatus {
  if (status !== undefined && !APPROVAL_STATUSES.has(status as ApprovalStatus)) {
    throw new Error("status must be pending, allowed, denied, or expired");
  }
}

export class ApprovalStore {
  private readonly approvals: Map<string, Approval>;

  constructor(private readonly path: string) {
    this.approvals = new Map(loadApprovals(this.path).map((approval) => [approval.id, approval]));
  }

  create(request: CreateApprovalRequest) {
    const now = new Date().toISOString();
    const approval: Approval = {
      id: crypto.randomUUID(),
      sessionId: request.sessionId,
      runId: request.runId,
      kind: request.kind,
      scope: request.scope,
      title: request.title,
      description: request.description,
      risk: request.risk,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: request.expiresAt,
    };
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
    const grant = this.sortedApprovals().find((approval) => {
      return (
        approval.sessionId === request.sessionId &&
        approval.kind === request.kind &&
        approval.scope === request.scope &&
        approval.status === "allowed" &&
        (approval.decision === "allow_session" || (approval.decision === "allow_once" && !approval.usedAt))
      );
    });
    if (grant?.decision === "allow_once") {
      grant.usedAt = new Date().toISOString();
      grant.updatedAt = grant.usedAt;
      this.persist();
    }
    return grant;
  }

  get(id: string) {
    this.expireApprovals();
    const approval = this.approvals.get(id);
    if (!approval) throw new Error(`Unknown approval: ${id}`);
    return approval;
  }

  resolve(id: string, request: ResolveApprovalRequest) {
    assertDecision(request.decision);
    const approval = this.get(id);
    if (approval.status !== "pending") {
      throw new Error(`Approval is already ${approval.status}`);
    }

    const now = new Date().toISOString();
    approval.status = request.decision === "deny" ? "denied" : "allowed";
    approval.decision = request.decision;
    approval.resolvedAt = now;
    approval.updatedAt = now;
    this.persist();
    return approval;
  }

  private expireApprovals() {
    const now = Date.now();
    let changed = false;
    for (const approval of this.approvals.values()) {
      if (
        (approval.status === "pending" || approval.status === "allowed") &&
        approval.expiresAt &&
        Date.parse(approval.expiresAt) <= now
      ) {
        approval.status = "expired";
        approval.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private sortedApprovals() {
    return [...this.approvals.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private persist() {
    saveApprovals(this.path, this.sortedApprovals());
  }
}
