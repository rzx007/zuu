import type { ScheduleAction } from "@zuu/client";
import { assertObject, optionalBoolean, optionalRecord, optionalString, optionalStringArray, requireString, validationError } from "../server";
import { parseModel, parseThinkingLevel } from "./request-validation-common";

export function parseScheduleAction(value: unknown): ScheduleAction {
  assertObject(value, "action");
  const type = requireString(value.type, "action.type");
  if (type === "prompt") {
    return {
      type,
      prompt: requireString(value.prompt, "action.prompt"),
      projectId: optionalString(value.projectId, "action.projectId"),
      sessionId: optionalString(value.sessionId, "action.sessionId"),
      name: optionalString(value.name, "action.name"),
      model: parseModel(value.model),
      thinkingLevel: parseThinkingLevel(value.thinkingLevel),
      tools: optionalStringArray(value.tools, "action.tools"),
      persist: optionalBoolean(value.persist, "action.persist"),
    };
  }
  if (type === "workflow") {
    return {
      type,
      workflowId: requireString(value.workflowId, "action.workflowId"),
      prompt: optionalString(value.prompt, "action.prompt"),
      projectId: optionalString(value.projectId, "action.projectId"),
      sessionId: optionalString(value.sessionId, "action.sessionId"),
      inputs: optionalRecord(value.inputs, "action.inputs"),
    };
  }
  validationError("action.type must be prompt or workflow", { field: "action.type" });
}
