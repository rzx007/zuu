import { basename, resolve } from "node:path";
import type {
  CreateProjectRequest,
  ProjectSummary,
  UpdateProjectRequest,
} from "@zuu/client";
import { notFound } from "../http";
import { assertAllowedPath } from "./environment";
import { JsonFileStore } from "./json-file-store";

const DEFAULT_PROJECT_ID = "default";

interface ProjectStoreData {
  projects: ProjectSummary[];
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

function isProjectStoreData(value: unknown): value is ProjectStoreData {
  return Boolean(
    value &&
      typeof value === "object" &&
      "projects" in value &&
      Array.isArray(value.projects) &&
      value.projects.every(isProject),
  );
}

function normalizeCwd(cwd: string) {
  const normalized = resolve(cwd);
  assertAllowedPath(normalized, "cwd");
  return normalized;
}

function defaultProject(agentDir: string): ProjectSummary {
  const cwd = normalizeCwd(process.cwd());
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

export class ProjectStore {
  private readonly store: JsonFileStore<ProjectStoreData>;
  private readonly projects = new Map<string, ProjectSummary>();

  constructor(
    path: string,
    private readonly agentDir: string,
  ) {
    this.store = new JsonFileStore<ProjectStoreData>({
      name: "projects",
      path,
      defaultValue: { projects: [defaultProject(agentDir)] },
      countRecords: (value) => value.projects.length,
    });
    const data = this.store.load(isProjectStoreData);
    const projects = data.projects.length > 0 ? data.projects : [defaultProject(agentDir)];
    this.projects = new Map(projects.map((project) => [project.id, project]));
    if (!this.projects.has(DEFAULT_PROJECT_ID)) {
      const project = defaultProject(agentDir);
      this.projects.set(project.id, project);
      this.persist();
    }
  }

  list() {
    return [...this.projects.values()].sort((a, b) => {
      if (a.id === DEFAULT_PROJECT_ID) return -1;
      if (b.id === DEFAULT_PROJECT_ID) return 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  get(projectId = DEFAULT_PROJECT_ID) {
    const project = this.projects.get(projectId);
    if (!project) notFound(`Unknown project: ${projectId}`, { projectId });
    return project;
  }

  findByCwd(cwd: string) {
    const normalized = normalizeCwd(cwd);
    return [...this.projects.values()].find((project) => project.cwd === normalized);
  }

  create(request: CreateProjectRequest) {
    const now = new Date().toISOString();
    const cwd = normalizeCwd(request.cwd);
    const project: ProjectSummary = {
      id: crypto.randomUUID(),
      name: request.name?.trim() || basename(cwd) || "project",
      cwd,
      agentDir: this.agentDir,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    this.persist();
    return project;
  }

  update(projectId: string, request: UpdateProjectRequest) {
    const project = this.get(projectId);
    if (request.name !== undefined) {
      const name = request.name.trim();
      if (!name) throw new Error("name is required");
      project.name = name;
    }
    if (request.cwd !== undefined) {
      project.cwd = normalizeCwd(request.cwd);
    }
    project.updatedAt = new Date().toISOString();
    this.persist();
    return project;
  }

  delete(projectId: string) {
    if (projectId === DEFAULT_PROJECT_ID) {
      throw new Error("default project cannot be deleted");
    }
    const project = this.get(projectId);
    this.projects.delete(projectId);
    this.persist();
    return project;
  }

  private persist() {
    this.store.save({ projects: this.list() });
  }
}
