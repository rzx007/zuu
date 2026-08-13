import type { Approval } from "@zuu/client";

export function expireApprovals(approvals: Iterable<Approval>, nowMs = Date.now()) {
  const expired: Approval[] = [];
  for (const approval of approvals) {
    if (shouldExpireApproval(approval, nowMs)) {
      approval.status = "expired";
      approval.updatedAt = new Date().toISOString();
      expired.push(approval);
    }
  }
  return expired;
}

function shouldExpireApproval(approval: Approval, nowMs: number) {
  return (
    (approval.status === "pending" || approval.status === "allowed") &&
    approval.expiresAt !== undefined &&
    Date.parse(approval.expiresAt) <= nowMs
  );
}
