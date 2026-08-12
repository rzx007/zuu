import { createZuuClient } from "@zuu/client";

const baseUrl = process.env.ZUU_PI_WORKFLOW_BASE_URL ?? "http://127.0.0.1:3001";
const workflowId = process.env.ZUU_PI_WORKFLOW_ID ?? "deep-research";
const shouldRun = process.env.ZUU_PI_WORKFLOW_RUN === "1";
const prompt =
  process.env.ZUU_PI_WORKFLOW_PROMPT ??
  "Validate that Zuu can launch pi-workflow through the pi-package adapter. Keep the result concise.";

function fail(message: string): never {
  throw new Error(message);
}

function asJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function main() {
  const client = createZuuClient({
    baseUrl,
    apiToken: process.env.ZUU_API_TOKEN,
  });

  const health = await client.health();
  if (!health.ok) fail(`Zuu daemon is not healthy at ${baseUrl}`);

  const diagnostics = await client.diagnostics();
  const backend = diagnostics.resources.workflowBackend;
  if (backend.kind !== "pi-package") {
    fail(`Expected ZUU_WORKFLOW_BACKEND=pi-package, got ${backend.kind}.\n${asJson(backend)}`);
  }
  if (backend.status !== "ready") {
    fail(`pi-package workflow backend is not ready.\n${asJson(backend)}\nGaps:\n${diagnostics.gaps.join("\n")}`);
  }

  const workflows = await client.listWorkflows();
  const workflow = workflows.workflows.find((item) => item.id === workflowId);
  if (!workflow) {
    fail(`Workflow ${workflowId} was not listed. Available workflows: ${workflows.workflows.map((item) => item.id).join(", ")}`);
  }

  if (!shouldRun) {
    console.log(
      [
        "pi-workflow backend is ready.",
        `baseUrl=${baseUrl}`,
        `workflow=${workflow.id}`,
        "Set ZUU_PI_WORKFLOW_RUN=1 to launch a real workflow run.",
      ].join("\n"),
    );
    return;
  }

  const result = await client.startWorkflow(workflow.id, {
    prompt,
    inputs: {
      source: "scripts/check-pi-workflow-runtime.ts",
    },
  });

  if (result.run.status !== "done") {
    fail(`pi-workflow launch did not complete successfully.\n${asJson(result.run)}`);
  }
  if (!result.run.artifacts.some((artifact) => artifact.kind === "json")) {
    fail(`pi-workflow launch did not create a launch artifact.\n${asJson(result.run)}`);
  }

  const loaded = await client.getWorkflowRun(result.run.id);
  if (loaded.run.id !== result.run.id) {
    fail("Workflow run lookup returned a different run.");
  }

  console.log(
    asJson({
      ok: true,
      workflowRunId: result.run.id,
      workflowId: result.run.workflowId,
      status: result.run.status,
      artifacts: result.run.artifacts.map((artifact) => artifact.name),
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
