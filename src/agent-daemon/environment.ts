import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ApiError } from "../http";

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

export function getRunEventStorePath(agentDir: string) {
  return join(agentDir, "run-events.json");
}

export function getProjectStorePath(agentDir: string) {
  return join(agentDir, "projects.json");
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

export function getScheduleLeaseStorePath(agentDir: string) {
  return join(agentDir, "scheduler-lease.json");
}

export function getPackageOperationStorePath(agentDir: string) {
  return join(agentDir, "package-operations.json");
}

export function getPackageTrustStorePath(agentDir: string) {
  return join(agentDir, "package-trust.json");
}

export function getAuthTokenStorePath(agentDir: string) {
  return join(agentDir, "auth-token.json");
}

export function getAuditEventStorePath(agentDir: string) {
  return join(agentDir, "audit-events.json");
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
    throw new ApiError(`${label} is outside allowed roots`, {
      status: 400,
      code: "validation_failed",
      details: { field: label },
    });
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
  if (!trimmed) throw new ApiError("source is required", { status: 400, code: "validation_failed", details: { field: "source" } });
  return trimmed;
}

export function assertPinnedPackageSource(source: string) {
  if (!source.startsWith("npm:")) return;
  const spec = source.slice("npm:".length).trim();
  const versionStart = npmVersionStart(spec);
  const version = versionStart >= 0 ? spec.slice(versionStart + 1) : "";
  if (!EXACT_SEMVER.test(version)) {
    throw new ApiError("npm package source must include an exact version, for example npm:@agwab/pi-workflow@0.84.1", {
      status: 400,
      code: "validation_failed",
      details: { field: "source" },
    });
  }
}

const EXACT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

function npmVersionStart(spec: string) {
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    return slash >= 0 ? spec.indexOf("@", slash + 1) : -1;
  }
  return spec.lastIndexOf("@");
}
