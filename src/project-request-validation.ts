import type { CreateProjectRequest, UpdateProjectRequest } from "@zuu/client";
import { assertObject, optionalString, requireString } from "./http";

export function parseCreateProject(value: unknown): CreateProjectRequest {
  assertObject(value);
  return {
    name: optionalString(value.name, "name"),
    cwd: requireString(value.cwd, "cwd"),
  };
}

export function parseUpdateProject(value: unknown): UpdateProjectRequest {
  assertObject(value);
  return {
    name: optionalString(value.name, "name"),
    cwd: optionalString(value.cwd, "cwd"),
  };
}
