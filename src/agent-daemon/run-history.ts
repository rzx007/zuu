import { readFileSync, writeFileSync } from "node:fs";
import type { RunSummary } from "@zuu/client";

const RUN_HISTORY_LIMIT = 200;

export function loadRunHistory(path: string): RunSummary[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((run): run is RunSummary => {
      return Boolean(run && typeof run === "object" && "id" in run && "sessionId" in run && "status" in run);
    });
  } catch {
    return [];
  }
}

export function saveRunHistory(path: string, runs: RunSummary[]) {
  writeFileSync(path, `${JSON.stringify(runs.slice(0, RUN_HISTORY_LIMIT), null, 2)}\n`, "utf8");
}
