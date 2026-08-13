import type { WorkflowBackendInfo, WorkflowDefinition } from "@zuu/client";

export const PI_WORKFLOW_PACKAGE = "@agwab/pi-workflow";

export const PI_WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    id: "deep-research",
    name: "Deep Research",
    description: "Bundled pi-workflow research process with planning, fan-out, verification, and synthesis.",
    version: "pi-package",
    tags: ["pi-workflow", "research"],
  },
  {
    id: "deep-review",
    name: "Deep Review",
    description: "Bundled pi-workflow code/design review process with multiple lenses and deduplication.",
    version: "pi-package",
    tags: ["pi-workflow", "review"],
  },
  {
    id: "spec-review",
    name: "Spec Review",
    description: "Bundled pi-workflow traceability pass for specs, APIs, and acceptance criteria.",
    version: "pi-package",
    tags: ["pi-workflow", "spec"],
  },
  {
    id: "impact-review",
    name: "Impact Review",
    description: "Bundled pi-workflow side-effect and regression-risk review for proposed or applied changes.",
    version: "pi-package",
    tags: ["pi-workflow", "risk"],
  },
  {
    id: "dynamic",
    name: "Dynamic Workflow",
    description: "Ask pi-workflow to plan an adaptive one-off workflow for this task.",
    version: "pi-package",
    tags: ["pi-workflow", "dynamic"],
  },
];

export interface PiWorkflowPackageProbe {
  packageSource?: string;
  packageInstalled: boolean;
  installedPath?: string;
  platform: NodeJS.Platform;
}

export function resolvePiWorkflowPackage(packages: string[]) {
  return packages.find((source) => source.includes(PI_WORKFLOW_PACKAGE));
}

export function createPiPackageInfo(probe: PiWorkflowPackageProbe): WorkflowBackendInfo {
  if (!probe.packageSource) {
    return {
      kind: "pi-package",
      status: "unavailable",
      label: "Pi package workflow",
      packageInstalled: false,
      message: `The ${PI_WORKFLOW_PACKAGE} package is not configured. Add a pinned npm:${PI_WORKFLOW_PACKAGE}@<reviewed-version> source or use the fake backend.`,
    };
  }

  if (probe.platform === "win32") {
    return {
      kind: "pi-package",
      status: "unavailable",
      label: "Pi package workflow",
      packageInstalled: probe.packageInstalled,
      packageSource: probe.packageSource,
      message: `${PI_WORKFLOW_PACKAGE} is configured, but its package page says native Windows is not supported. Use WSL2/Linux or switch ZUU_WORKFLOW_BACKEND=fake.`,
    };
  }

  if (!probe.installedPath) {
    return {
      kind: "pi-package",
      status: "unavailable",
      label: "Pi package workflow",
      packageInstalled: probe.packageInstalled,
      packageSource: probe.packageSource,
      message: `${PI_WORKFLOW_PACKAGE} is configured but was not resolved to an installed package path. Run pi install npm:${PI_WORKFLOW_PACKAGE}@<reviewed-version>, then restart Zuu.`,
    };
  }

  return {
    kind: "pi-package",
    status: "ready",
    label: "Pi package workflow",
    packageInstalled: true,
    packageSource: probe.packageSource,
    message:
      "Pi package workflow adapter is ready. Zuu will launch workflows through /workflow commands; detailed run-state still belongs to the Pi workflow board.",
  };
}
