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
