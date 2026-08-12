import type { CreateProjectRequest, UpdateProjectRequest } from "@zuu/client";
import type { ProjectService } from "./project-service";

export class ProjectApiService {
  constructor(private readonly projects: ProjectService) {}

  listProjects() {
    return this.projects.listProjects();
  }

  getProject(projectId: string) {
    return this.projects.get(projectId);
  }

  createProject(request: CreateProjectRequest) {
    return this.projects.createProject(request);
  }

  updateProject(projectId: string, request: UpdateProjectRequest) {
    return this.projects.updateProject(projectId, request);
  }

  deleteProject(projectId: string) {
    return this.projects.deleteProject(projectId);
  }
}
