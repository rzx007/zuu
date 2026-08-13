import type { WorkflowRun } from "@zuu/client";

export function abortWorkflowRunRecord(run: WorkflowRun, timestamp = new Date().toISOString()) {
  if (run.status !== "queued" && run.status !== "running") return false;

  run.status = "aborted";
  run.finishedAt = timestamp;
  for (const stageItem of run.stages) {
    if (stageItem.status === "queued" || stageItem.status === "running") {
      stageItem.status = "aborted";
      stageItem.finishedAt = timestamp;
    }
  }
  for (const taskItem of run.tasks) {
    if (taskItem.status === "queued" || taskItem.status === "running") {
      taskItem.status = "aborted";
      taskItem.finishedAt = timestamp;
    }
  }
  return true;
}
