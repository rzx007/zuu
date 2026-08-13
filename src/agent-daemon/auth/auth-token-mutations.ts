import { randomUUID } from "node:crypto";
import { ApiError } from "../../http";
import {
  defaultToken,
  generateToken,
  isTokenExpired,
  type AuthScope,
  type AuthTokenRecord,
  type StoredAuthToken,
} from "./auth-tokens";
import { normalizeActor, normalizeFutureTimestamp, parseAuthScope } from "./auth-token-validation";

export interface CreateAuthTokenInput {
  scope: AuthScope;
  actor?: string;
  expiresAt?: string;
}

export function rotateAuthTokens(record: AuthTokenRecord) {
  const rotatedAt = new Date().toISOString();
  const next: AuthTokenRecord = {
    ...record,
    rotatedAt,
    tokens: record.tokens.map((token) => ({
      ...token,
      token: generateToken(token.scope),
      rotatedAt,
    })),
  };

  return {
    record: next,
    admin: defaultToken(next, "admin"),
    read: defaultToken(next, "read"),
  };
}

export function createAuthToken(record: AuthTokenRecord, request: CreateAuthTokenInput) {
  const scope = parseAuthScope(request.scope);
  const actor = normalizeActor(request.actor);
  const expiresAt = normalizeFutureTimestamp(request.expiresAt, "expiresAt");
  const token: StoredAuthToken = {
    id: randomUUID(),
    actor,
    scope,
    token: generateToken(scope),
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  return {
    record: { ...record, tokens: [...record.tokens, token] },
    token,
  };
}

export function revokeAuthToken(record: AuthTokenRecord, tokenId: string) {
  const revoked = record.tokens.find((token) => token.id === tokenId);
  if (!revoked) {
    throw new ApiError("Auth token not found", { status: 404, code: "not_found", details: { tokenId } });
  }

  const remainingActiveAdminCount = record.tokens.filter((token) => {
    return token.id !== tokenId && token.scope === "admin" && !isTokenExpired(token);
  }).length;
  if (revoked.scope === "admin" && remainingActiveAdminCount < 1) {
    throw new ApiError("Cannot revoke the last admin token", {
      status: 409,
      code: "auth_last_admin_token",
      details: { tokenId },
    });
  }

  return {
    record: { ...record, tokens: record.tokens.filter((token) => token.id !== tokenId) },
    revoked,
  };
}
