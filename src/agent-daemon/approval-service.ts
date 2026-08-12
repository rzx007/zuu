import type {
  Approval,
  ApprovalStatus,
  CreateApprovalRequest,
  ResolveApprovalRequest,
} from "@zuu/client";
import { ApprovalStore, assertApprovalStatus } from "./approval-store";

export interface ApprovalRegistry {
  create(request: CreateApprovalRequest): Approval;
  consumeGrant(request: Pick<CreateApprovalRequest, "sessionId" | "kind" | "scope">): Approval | undefined;
  waitForResolution(approvalId: string): Promise<Approval>;
}

export class ApprovalService implements ApprovalRegistry {
  private readonly store: ApprovalStore;

  constructor(path: string) {
    this.store = new ApprovalStore(path);
  }

  create(request: CreateApprovalRequest) {
    return this.store.create(request);
  }

  consumeGrant(request: Pick<CreateApprovalRequest, "sessionId" | "kind" | "scope">) {
    return this.store.consumeGrant(request);
  }

  waitForResolution(approvalId: string) {
    return this.store.waitForResolution(approvalId);
  }

  listApprovals(status?: ApprovalStatus) {
    assertApprovalStatus(status);
    return this.store.list(status);
  }

  getApproval(approvalId: string) {
    return this.store.get(approvalId);
  }

  resolveApproval(approvalId: string, request: ResolveApprovalRequest) {
    return this.store.resolve(approvalId, request);
  }
}
