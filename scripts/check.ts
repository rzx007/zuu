import app from "../src/index";
import { createZuuClient } from "../src/client";

const fetchFromApp: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  return app.fetch(request);
};

async function main() {
  const client = createZuuClient({ baseUrl: "http://zuu.local", fetch: fetchFromApp });
  const health = await client.health();
  if (!health.ok) throw new Error("health check failed");

  const { runs } = await client.listRuns();
  if (!Array.isArray(runs)) throw new Error("runs response is invalid");

  let missingRunFailed = false;
  try {
    await client.getRun("missing");
  } catch {
    missingRunFailed = true;
  }
  if (!missingRunFailed) throw new Error("missing run should fail");

  console.log("ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
