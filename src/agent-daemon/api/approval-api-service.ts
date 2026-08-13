import type { ApprovalStatus, CreateApprovalRequest, ResolveApprovalRequest } from "@zuu/client";
import type { AuditService } from "../audit/audit-service";
import type { ApprovalService } from "../approvals/approval-service";

export class ApprovalApiService {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly audit?: AuditService,
  ) {}

  createApproval(request: CreateApprovalRequest) {
    return this.approvals.create(request);
  }

  listApprovals(status?: ApprovalStatus) {
    return this.approvals.listApprovals(status);
  }

  getApproval(approvalId: string) {
    return this.approvals.getApproval(approvalId);
  }

  resolveApproval(approvalId: string, request: ResolveApprovalRequest) {
    try {
      const approval = this.approvals.resolveApproval(approvalId, request);
      this.audit?.record({ action: "approval.resolve", target: approvalId, details: { decision: request.decision, status: approval.status } });
      return approval;
    } catch (error) {
      this.audit?.record({
        action: "approval.resolve",
        target: approvalId,
        outcome: "failure",
        details: { decision: request.decision, error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}
