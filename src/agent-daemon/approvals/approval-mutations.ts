import type {
  Approval,
  ApprovalDecision,
  CreateApprovalRequest,
  ResolveApprovalRequest,
} from "@zuu/client";
import { ApiError, validationError } from "../../http";

const APPROVAL_DECISIONS = new Set<ApprovalDecision>(["allow_once", "allow_session", "deny"]);

export function createApprovalRecord(request: CreateApprovalRequest): Approval {
  const now = new Date().toISOString();
  return {
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
}

export function findConsumableApprovalGrant(
  approvals: Approval[],
  request: Pick<CreateApprovalRequest, "sessionId" | "kind" | "scope">,
) {
  return approvals.find((approval) => {
    return (
      approval.sessionId === request.sessionId &&
      approval.kind === request.kind &&
      approval.scope === request.scope &&
      approval.status === "allowed" &&
      (approval.decision === "allow_session" || (approval.decision === "allow_once" && !approval.usedAt))
    );
  });
}

export function consumeApprovalGrant(approval: Approval | undefined) {
  if (approval?.decision !== "allow_once") return false;
  approval.usedAt = new Date().toISOString();
  approval.updatedAt = approval.usedAt;
  return true;
}

export function resolveApprovalRecord(approval: Approval, approvalId: string, request: ResolveApprovalRequest) {
  assertDecision(request.decision);
  if (approval.status !== "pending") {
    throw new ApiError(`Approval is already ${approval.status}`, {
      status: 409,
      code: "approval_already_resolved",
      details: { approvalId, status: approval.status },
    });
  }

  const now = new Date().toISOString();
  approval.status = request.decision === "deny" ? "denied" : "allowed";
  approval.decision = request.decision;
  approval.resolvedAt = now;
  approval.updatedAt = now;
}

function assertDecision(decision: unknown): asserts decision is ApprovalDecision {
  if (!APPROVAL_DECISIONS.has(decision as ApprovalDecision)) {
    validationError("decision must be allow_once, allow_session, or deny", { field: "decision" });
  }
}
