import type { WorkflowRun } from "@zuu/client";
import { notFound } from "../../../http";
import { JsonFileStore } from "../../storage/json-file-store";

const WORKFLOW_HISTORY_LIMIT = 200;
const WORKFLOW_STATUSES = new Set(["queued", "running", "completed", "failed", "aborted"]);

function isWorkflowRun(value: unknown): value is WorkflowRun {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "workflowId" in value &&
      typeof value.workflowId === "string" &&
      "workflowName" in value &&
      typeof value.workflowName === "string" &&
      "status" in value &&
      WORKFLOW_STATUSES.has(String(value.status)) &&
      "startedAt" in value &&
      typeof value.startedAt === "string" &&
      "stages" in value &&
      Array.isArray(value.stages) &&
      value.stages.every(isWorkflowStep) &&
      "tasks" in value &&
      Array.isArray(value.tasks) &&
      value.tasks.every(isWorkflowStep) &&
      "artifacts" in value,
  );
}

function isWorkflowStep(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "runId" in value &&
      typeof value.runId === "string" &&
      "status" in value &&
      WORKFLOW_STATUSES.has(String(value.status)),
  );
}

function loadWorkflowRuns(path: string): WorkflowRun[] {
  return createWorkflowRunStore(path).load(Array.isArray).filter(isWorkflowRun);
}

function saveWorkflowRuns(path: string, runs: WorkflowRun[]) {
  createWorkflowRunStore(path).save(runs.slice(0, WORKFLOW_HISTORY_LIMIT));
}

function createWorkflowRunStore(path: string) {
  return new JsonFileStore<unknown[]>({
    name: "workflow-runs",
    path,
    defaultValue: [],
    countRecords: (value) => value.length,
  });
}

export class WorkflowRunStore {
  private readonly runs: Map<string, WorkflowRun>;

  constructor(private readonly path: string) {
    this.runs = new Map(loadWorkflowRuns(path).map((run) => [run.id, run]));
  }

  list() {
    return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  get(runId: string) {
    const run = this.runs.get(runId);
    if (!run) notFound(`Unknown workflow run: ${runId}`, { runId });
    return run;
  }

  set(run: WorkflowRun) {
    this.runs.set(run.id, run);
    this.persist();
  }

  persist() {
    saveWorkflowRuns(this.path, this.list());
  }
}
