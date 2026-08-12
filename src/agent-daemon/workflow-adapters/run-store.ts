import type { WorkflowRun } from "@zuu/client";
import { JsonFileStore } from "../json-file-store";

const WORKFLOW_HISTORY_LIMIT = 200;

function isWorkflowRun(value: unknown): value is WorkflowRun {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      "workflowId" in value &&
      "status" in value &&
      "stages" in value &&
      "tasks" in value &&
      "artifacts" in value,
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
    if (!run) throw new Error(`Unknown workflow run: ${runId}`);
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
