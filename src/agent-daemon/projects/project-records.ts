import { basename, resolve } from "node:path";
import type { ProjectSummary } from "@zuu/client";
import { assertAllowedPath } from "../core/environment";

export const DEFAULT_PROJECT_ID = "default";

export interface ProjectStoreData {
  projects: ProjectSummary[];
}

export function isProjectStoreData(value: unknown): value is ProjectStoreData {
  return Boolean(
    value &&
      typeof value === "object" &&
      "projects" in value &&
      Array.isArray(value.projects) &&
      value.projects.every(isProject),
  );
}

export function normalizeProjectCwd(cwd: string) {
  const normalized = resolve(cwd);
  assertAllowedPath(normalized, "cwd");
  return normalized;
}

export function createDefaultProject(agentDir: string): ProjectSummary {
  const cwd = normalizeProjectCwd(process.cwd());
  const now = new Date().toISOString();
  return {
    id: DEFAULT_PROJECT_ID,
    name: basename(cwd) || "default",
    cwd,
    agentDir,
    status: "ready",
    createdAt: now,
    updatedAt: now,
  };
}

function isProject(value: unknown): value is ProjectSummary {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      "name" in value &&
      "cwd" in value &&
      "agentDir" in value &&
      "status" in value &&
      "createdAt" in value &&
      "updatedAt" in value,
  );
}
