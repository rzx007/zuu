import { existsSync, readFileSync } from "node:fs";
import { getAuthTokenStorePath, getZuuAgentDir } from "../src/agent-daemon/agent-paths";
import { isTokenExpired, type AuthTokenRecord } from "../src/agent-daemon/auth-tokens";
import { isAuthTokenRecord } from "../src/agent-daemon/auth-token-validation";
import { envString } from "./script-env";

export function scriptAdminApiToken() {
  const envToken = envString("ZUU_API_TOKEN");
  if (envToken) return envToken;

  const record = loadLocalTokenRecord();
  return record?.tokens.find((item) => item.scope === "admin" && !isTokenExpired(item))?.token;
}

function loadLocalTokenRecord(): AuthTokenRecord | undefined {
  const path = getAuthTokenStorePath(getZuuAgentDir());
  if (!existsSync(path)) return undefined;

  const payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!payload || typeof payload !== "object" || !("data" in payload)) return undefined;
  const data = (payload as { data: unknown }).data;
  return isAuthTokenRecord(data) ? data : undefined;
}
