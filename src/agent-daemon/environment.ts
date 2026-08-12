import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const DEFAULT_READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "zuu_status"];

const DEFAULT_AGENT_DIR = join(process.cwd(), ".zuu", "pi-agent");
const DEFAULT_ALLOWED_ROOT = resolve(process.cwd());

export function sdkVersion() {
  const packageJsonPath = join(process.cwd(), "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string; engines?: { node?: string } };
}

export function getZuuAgentDir() {
  const agentDir = process.env.ZUU_AGENT_DIR || DEFAULT_AGENT_DIR;
  mkdirSync(agentDir, { recursive: true });
  return agentDir;
}

export function getSessionDir(agentDir: string) {
  const sessionDir = join(agentDir, "sessions");
  mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

export function getRunStorePath(agentDir: string) {
  return join(agentDir, "runs.json");
}

export function getApprovalStorePath(agentDir: string) {
  return join(agentDir, "approvals.json");
}

export function getWorkflowStorePath(agentDir: string) {
  return join(agentDir, "workflow-runs.json");
}

export function getScheduleStorePath(agentDir: string) {
  return join(agentDir, "schedules.json");
}

export function getPackageOperationStorePath(agentDir: string) {
  return join(agentDir, "package-operations.json");
}

export function getPackageTrustStorePath(agentDir: string) {
  return join(agentDir, "package-trust.json");
}

function normalizePathForCompare(pathname: string) {
  const resolved = resolve(pathname);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithinRoot(pathname: string, root: string) {
  const normalizedPath = normalizePathForCompare(pathname);
  const normalizedRoot = normalizePathForCompare(root);
  const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(rootPrefix);
}

function getAllowedRoots() {
  return [
    DEFAULT_ALLOWED_ROOT,
    ...(process.env.ZUU_ALLOWED_CWD ?? "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean),
  ];
}

export function assertAllowedPath(pathname: string, label: string) {
  if (!getAllowedRoots().some((root) => isWithinRoot(pathname, root))) {
    throw new Error(`${label} is outside allowed roots`);
  }
}

export async function createModelRuntime() {
  const agentDir = getZuuAgentDir();
  return ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });
}

export function packageSourceToString(source: unknown): string {
  if (typeof source === "string") return source;
  if (source && typeof source === "object" && "source" in source) {
    return String((source as { source: unknown }).source);
  }
  return String(source);
}

export function normalizePackageSource(source: string) {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("source is required");
  return trimmed;
}
