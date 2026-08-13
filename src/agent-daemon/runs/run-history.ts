import type { RunSummary } from "@zuu/client";
import { JsonFileStore } from "../storage/json-file-store";

const RUN_HISTORY_LIMIT = 200;
const RUN_SOURCES = new Set(["user", "schedule", "workflow", "api"]);
const RUN_STATUSES = new Set(["queued", "running", "waiting_approval", "completed", "failed", "aborted"]);

export function loadRunHistory(path: string): RunSummary[] {
  return createRunHistoryStore(path)
    .load(Array.isArray)
    .filter((run): run is RunSummary => {
      return Boolean(
        run &&
          typeof run === "object" &&
          "id" in run &&
          typeof run.id === "string" &&
          "sessionId" in run &&
          typeof run.sessionId === "string" &&
          "projectId" in run &&
          typeof run.projectId === "string" &&
          "source" in run &&
          RUN_SOURCES.has(String(run.source)) &&
          "status" in run &&
          RUN_STATUSES.has(String(run.status)) &&
          "prompt" in run &&
          typeof run.prompt === "string" &&
          "startedAt" in run &&
          typeof run.startedAt === "string"
      );
    });
}

export function saveRunHistory(path: string, runs: RunSummary[]) {
  createRunHistoryStore(path).save(runs.slice(0, RUN_HISTORY_LIMIT));
}

function createRunHistoryStore(path: string) {
  return new JsonFileStore<unknown[]>({
    name: "runs",
    path,
    defaultValue: [],
    countRecords: (value) => value.length,
  });
}
