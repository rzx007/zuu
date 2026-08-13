import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "../../../server";
import type { NativeWorkflowDefinition, NativeWorkflowKind, NativeWorkflowStep } from "./native-definitions";
import { validateNativeWorkflowDefinition } from "./native-validation";

const WORKFLOW_DEFINITION_DIR = ".zuu/workflows";

export function loadProjectNativeWorkflowDefinitions(cwd: string) {
  const directory = join(cwd, WORKFLOW_DEFINITION_DIR);
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => loadProjectNativeWorkflowDefinition(join(directory, entry.name)));
}

function loadProjectNativeWorkflowDefinition(path: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ApiError(`Could not parse native workflow definition: ${path}`, {
      status: 400,
      code: "validation_failed",
      details: { path, error: error instanceof Error ? error.message : String(error) },
    });
  }

  const definition = normalizeProjectDefinition(parsed, path);
  validateNativeWorkflowDefinition(definition);
  return definition;
}

function normalizeProjectDefinition(value: unknown, path: string): NativeWorkflowDefinition {
  if (!value || typeof value !== "object") {
    invalidProjectDefinition(path, "Workflow definition must be an object.");
  }

  const record = value as Record<string, unknown>;
  const id = stringField(record, "id", path);
  const name = stringField(record, "name", path);
  const description = stringField(record, "description", path);
  const kind = kindField(record, path);
  const steps = stepsField(record, path);

  return {
    id,
    name,
    description,
    version: typeof record.version === "string" ? record.version : "project",
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : ["project", "native"],
    kind,
    steps,
  };
}

function stringField(record: Record<string, unknown>, field: string, path: string) {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidProjectDefinition(path, `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function kindField(record: Record<string, unknown>, path: string): NativeWorkflowKind {
  const value = record.kind;
  if (value === "single" || value === "sequence" || value === "dag") return value;
  invalidProjectDefinition(path, "kind must be single, sequence, or dag.");
}

function stepsField(record: Record<string, unknown>, path: string): NativeWorkflowStep[] {
  if (!Array.isArray(record.steps)) {
    invalidProjectDefinition(path, "steps must be an array.");
  }

  return record.steps.map((step, index) => {
    if (!step || typeof step !== "object") {
      invalidProjectDefinition(path, `steps[${index}] must be an object.`);
    }
    const stepRecord = step as Record<string, unknown>;
    const dependsOn = stepRecord.dependsOn;
    return {
      id: stringField(stepRecord, "id", path),
      name: stringField(stepRecord, "name", path),
      prompt: stringField(stepRecord, "prompt", path),
      dependsOn: Array.isArray(dependsOn) ? dependsOn.filter((item): item is string => typeof item === "string") : undefined,
    };
  });
}

function invalidProjectDefinition(path: string, message: string): never {
  throw new ApiError(message, {
    status: 400,
    code: "validation_failed",
    details: { path },
  });
}
