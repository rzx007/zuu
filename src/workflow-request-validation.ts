import type { ResolveApprovalRequest, StartWorkflowRequest } from "@zuu/client";
import { assertObject, optionalRecord, optionalString, validationError } from "./http";

const APPROVAL_DECISIONS = new Set(["allow_once", "allow_session", "deny"]);

export function parseStartWorkflow(value: unknown): StartWorkflowRequest {
  assertObject(value);
  const source = optionalString(value.source, "source");
  if (source !== undefined && source !== "user" && source !== "schedule" && source !== "api") {
    validationError("source must be user, schedule, or api", { field: "source" });
  }
  return {
    projectId: optionalString(value.projectId, "projectId"),
    sessionId: optionalString(value.sessionId, "sessionId"),
    prompt: optionalString(value.prompt, "prompt"),
    inputs: optionalRecord(value.inputs, "inputs"),
    source,
  };
}

export function parseResolveApproval(value: unknown): ResolveApprovalRequest {
  assertObject(value);
  if (!APPROVAL_DECISIONS.has(String(value.decision))) {
    validationError("decision must be allow_once, allow_session, or deny", { field: "decision" });
  }
  return { decision: value.decision as ResolveApprovalRequest["decision"] };
}
