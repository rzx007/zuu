import { randomBytes } from "node:crypto";
import { ApiError } from "../http";

export type AuthScope = "admin" | "read";

export interface StoredAuthToken {
  id: string;
  actor: string;
  scope: AuthScope;
  token: string;
  createdAt: string;
  expiresAt?: string;
  rotatedAt?: string;
  lastUsedAt?: string;
}

export interface AuthTokenRecord {
  createdAt: string;
  rotatedAt?: string;
  tokens: StoredAuthToken[];
}

export interface AuthTokenStatus {
  id: string;
  actor: string;
  scope: AuthScope;
  tokenPreview: string;
  createdAt: string;
  expiresAt?: string;
  expired: boolean;
  rotatedAt?: string;
  lastUsedAt?: string;
}

export const DEFAULT_TOKEN_RECORD: AuthTokenRecord = { createdAt: "", tokens: [] };
export const DEFAULT_ACTOR = "local";

export function createStoredToken(id: string, actor: string, scope: AuthScope, createdAt: string): StoredAuthToken {
  return {
    id,
    actor,
    scope,
    token: generateToken(scope),
    createdAt,
  };
}

export function generateToken(scope: AuthScope) {
  return `zuu_${scope}_${randomBytes(32).toString("base64url")}`;
}

export function tokenPreview(token: string) {
  return token.length <= 12 ? token : `${token.slice(0, 8)}...${token.slice(-4)}`;
}

export function toTokenStatus(token: StoredAuthToken): AuthTokenStatus {
  return {
    id: token.id,
    actor: token.actor,
    scope: token.scope,
    tokenPreview: tokenPreview(token.token),
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    expired: isTokenExpired(token),
    rotatedAt: token.rotatedAt,
    lastUsedAt: token.lastUsedAt,
  };
}

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

export function isTokenExpired(token: Pick<StoredAuthToken, "expiresAt">) {
  return Boolean(token.expiresAt && Date.parse(token.expiresAt) <= Date.now());
}

export function defaultToken(record: AuthTokenRecord, scope: AuthScope) {
  const token = record.tokens.find((item) => item.actor === DEFAULT_ACTOR && item.scope === scope) ?? record.tokens.find((item) => item.scope === scope);
  if (!token) throw new Error(`Missing ${scope} token`);
  return token;
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
