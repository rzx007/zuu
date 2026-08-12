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

  let sawAuthHeader = false;
  const authClient = createZuuClient({
    baseUrl: "http://zuu.local",
    apiToken: "check-token",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      sawAuthHeader = request.headers.get("authorization") === "Bearer check-token";
      return Response.json({ ok: true });
    },
  });
  await authClient.health();
  if (!sawAuthHeader) throw new Error("api token header was not sent");

  const previousToken = process.env.ZUU_API_TOKEN;
  try {
    process.env.ZUU_API_TOKEN = "server-check-token";
    const unauthorized = await fetchFromApp("http://zuu.local/api/health");
    if (unauthorized.status !== 401) throw new Error("missing api token should be rejected");
    const authorizedClient = createZuuClient({
      baseUrl: "http://zuu.local",
      fetch: fetchFromApp,
      apiToken: "server-check-token",
    });
    await authorizedClient.health();
  } finally {
    if (previousToken === undefined) {
      delete process.env.ZUU_API_TOKEN;
    } else {
      process.env.ZUU_API_TOKEN = previousToken;
    }
  }

  const { runs } = await client.listRuns();
  if (!Array.isArray(runs)) throw new Error("runs response is invalid");

  const packages = await client.listPackages();
  if (!Array.isArray(packages.packages)) throw new Error("packages response is invalid");
  const models = await client.listModels();
  if (!Array.isArray(models.models)) throw new Error("models response is invalid");

  let emptyPackageFailed = false;
  try {
    await client.addPackage({ source: " " });
  } catch {
    emptyPackageFailed = true;
  }
  if (!emptyPackageFailed) throw new Error("empty package source should fail");

  const storedBefore = await client.listStoredSessions();
  if (!Array.isArray(storedBefore.sessions)) throw new Error("stored sessions response is invalid");

  const { session } = await client.createSession({ persist: false, name: "check" });
  const tree = await client.getSessionTree(session.id);
  if (!Array.isArray(tree.tree)) throw new Error("session tree response is invalid");

  const replaced = await client.newSession(session.id, { name: "check next" });
  if (replaced.cancelled || replaced.session.id === session.id) {
    throw new Error("newSession did not replace the active session");
  }

  const persisted = await client.createSession({ name: "stored check" });
  if (!persisted.session.sessionFile) throw new Error("persisted session is missing sessionFile");
  const opened = await client.openSession({ sessionFile: persisted.session.sessionFile });
  if (opened.session.id !== persisted.session.id) throw new Error("openSession returned the wrong session");

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
