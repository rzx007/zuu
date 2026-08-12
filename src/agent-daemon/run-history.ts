import type { RunSummary } from "@zuu/client";
import { JsonFileStore } from "./json-file-store";

const RUN_HISTORY_LIMIT = 200;

export function loadRunHistory(path: string): RunSummary[] {
  return createRunHistoryStore(path)
    .load(Array.isArray)
    .filter((run): run is RunSummary => {
      return Boolean(
        run &&
          typeof run === "object" &&
          "id" in run &&
          "sessionId" in run &&
          "projectId" in run &&
          "status" in run,
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
