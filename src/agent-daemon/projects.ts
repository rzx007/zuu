import { basename } from "node:path";
import type {
  CreateProjectRequest,
  ProjectSummary,
  UpdateProjectRequest,
} from "@zuu/client";
import { ApiError, notFound, validationError } from "../http";
import { JsonFileStore } from "./json-file-store";
import {
  createDefaultProject,
  DEFAULT_PROJECT_ID,
  isProjectStoreData,
  normalizeProjectCwd,
  type ProjectStoreData,
} from "./project-records";

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
      defaultValue: { projects: [createDefaultProject(agentDir)] },
      countRecords: (value) => value.projects.length,
    });
    const data = this.store.load(isProjectStoreData);
    const projects = data.projects.length > 0 ? data.projects : [createDefaultProject(agentDir)];
    this.projects = new Map(projects.map((project) => [project.id, project]));
    if (!this.projects.has(DEFAULT_PROJECT_ID)) {
      const project = createDefaultProject(agentDir);
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
    const normalized = normalizeProjectCwd(cwd);
    return [...this.projects.values()].find((project) => project.cwd === normalized);
  }

  create(request: CreateProjectRequest) {
    const now = new Date().toISOString();
    const cwd = normalizeProjectCwd(request.cwd);
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
      if (!name) validationError("name is required", { field: "name" });
      project.name = name;
    }
    if (request.cwd !== undefined) {
      project.cwd = normalizeProjectCwd(request.cwd);
    }
    project.updatedAt = new Date().toISOString();
    this.persist();
    return project;
  }

  delete(projectId: string) {
    if (projectId === DEFAULT_PROJECT_ID) {
      throw new ApiError("default project cannot be deleted", {
        status: 409,
        code: "default_project",
        details: { projectId },
      });
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
