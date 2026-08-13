import { ApiError } from "../../../server";
import type { NativeWorkflowDefinition, NativeWorkflowStep } from "./native-definitions";

export function validateNativeWorkflowDefinition(definition: NativeWorkflowDefinition) {
  if (definition.steps.length === 0) {
    throw new ApiError("Native workflow must contain at least one task", {
      status: 400,
      code: "validation_failed",
      details: { field: "steps" },
    });
  }

  const ids = new Set<string>();
  for (const step of definition.steps) {
    if (ids.has(step.id)) {
      throw new ApiError(`Duplicate native workflow task id: ${step.id}`, {
        status: 400,
        code: "validation_failed",
        details: { field: "steps.id" },
      });
    }
    ids.add(step.id);
  }

  for (const step of definition.steps) {
    for (const dependency of step.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        throw new ApiError(`Unknown native workflow dependency: ${dependency}`, {
          status: 400,
          code: "validation_failed",
          details: { field: "steps.dependsOn" },
        });
      }
    }
  }

  assertAcyclic(definition.steps);
}

function assertAcyclic(steps: NativeWorkflowStep[]) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id, step]));

  const visit = (step: NativeWorkflowStep) => {
    if (visited.has(step.id)) return;
    if (visiting.has(step.id)) {
      throw new ApiError(`Native workflow DAG contains a cycle at task: ${step.id}`, {
        status: 400,
        code: "validation_failed",
        details: { field: "steps.dependsOn" },
      });
    }

    visiting.add(step.id);
    for (const dependencyId of step.dependsOn ?? []) {
      const dependency = byId.get(dependencyId);
      if (dependency) visit(dependency);
    }
    visiting.delete(step.id);
    visited.add(step.id);
  };

  for (const step of steps) visit(step);
}
