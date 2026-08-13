import { ApiError } from "../http";
import type { AuthScope, AuthTokenRecord, StoredAuthToken } from "./auth-tokens";

export function parseAuthScope(scope: string): AuthScope {
  if (scope === "admin" || scope === "read") return scope;
  throw new ApiError("scope must be admin or read", { status: 400, code: "validation_failed", details: { field: "scope" } });
}

export function normalizeActor(actor: string | undefined) {
  const normalized = actor?.trim() || "api";
  if (normalized.length > 64) {
    throw new ApiError("actor must be at most 64 characters", { status: 400, code: "validation_failed", details: { field: "actor" } });
  }
  return normalized;
}

export function normalizeFutureTimestamp(value: string | undefined, field: "expiresAt") {
  if (value === undefined || value.trim() === "") return undefined;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new ApiError(`${field} is invalid`, { status: 400, code: "validation_failed", details: { field } });
  }
  if (timestamp <= Date.now()) {
    throw new ApiError(`${field} must be in the future`, { status: 400, code: "validation_failed", details: { field } });
  }
  return new Date(timestamp).toISOString();
}

export function isAuthTokenRecord(value: unknown): value is AuthTokenRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      "createdAt" in value &&
      typeof value.createdAt === "string" &&
      "tokens" in value &&
      Array.isArray(value.tokens) &&
      value.tokens.every(isStoredAuthToken) &&
      (!("rotatedAt" in value) || typeof value.rotatedAt === "string"),
  );
}

export function bearerToken(authorization: string | undefined) {
  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) return undefined;
  return authorization.slice(prefix.length);
}

function isStoredAuthToken(value: unknown): value is StoredAuthToken {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      "actor" in value &&
      typeof value.actor === "string" &&
      "scope" in value &&
      (value.scope === "admin" || value.scope === "read") &&
      "token" in value &&
      typeof value.token === "string" &&
      "createdAt" in value &&
      typeof value.createdAt === "string" &&
      (!("expiresAt" in value) || typeof value.expiresAt === "string") &&
      (!("rotatedAt" in value) || typeof value.rotatedAt === "string") &&
      (!("lastUsedAt" in value) || typeof value.lastUsedAt === "string"),
  );
}
