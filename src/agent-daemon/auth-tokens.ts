import { randomBytes } from "node:crypto";

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

export function isTokenExpired(token: Pick<StoredAuthToken, "expiresAt">) {
  return Boolean(token.expiresAt && Date.parse(token.expiresAt) <= Date.now());
}

export function defaultToken(record: AuthTokenRecord, scope: AuthScope) {
  const token = record.tokens.find((item) => item.actor === DEFAULT_ACTOR && item.scope === scope) ?? record.tokens.find((item) => item.scope === scope);
  if (!token) throw new Error(`Missing ${scope} token`);
  return token;
}
