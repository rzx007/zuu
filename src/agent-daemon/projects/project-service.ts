import type {
  CreateProjectRequest,
  ProjectSummary,
  UpdateProjectRequest,
} from "@zuu/client";
import { ProjectStore } from "./projects";

export interface ProjectRegistry {
  get(projectId?: string): ProjectSummary;
}

export class ProjectService implements ProjectRegistry {
  private readonly store: ProjectStore;

  constructor(path: string, agentDir: string) {
    this.store = new ProjectStore(path, agentDir);
  }

  listProjects() {
    return this.store.list();
  }

  get(projectId?: string) {
    return this.store.get(projectId);
  }

  createProject(request: CreateProjectRequest) {
    return this.store.create(request);
  }

  updateProject(projectId: string, request: UpdateProjectRequest) {
    return this.store.update(projectId, request);
  }

  deleteProject(projectId: string) {
    return this.store.delete(projectId);
  }

  resolveProject(options: { projectId?: string; cwd?: string }) {
    if (options.projectId) return this.store.get(options.projectId);
    if (!options.cwd) return this.store.get();

    return this.store.findByCwd(options.cwd) ?? this.store.create({ cwd: options.cwd });
  }
}
