import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { ApiError } from "../http";
import { JsonFileStore } from "./json-file-store";

export type AuthScope = "admin" | "read";

export interface AuthCreateTokenRequest {
  scope: AuthScope;
  actor?: string;
}

interface StoredAuthToken {
  id: string;
  actor: string;
  scope: AuthScope;
  token: string;
  createdAt: string;
  rotatedAt?: string;
}

interface AuthTokenRecord {
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
  rotatedAt?: string;
}

export interface AuthStatus {
  enabled: boolean;
  source: "env" | "local";
  canRotate: boolean;
  tokenPreview: string;
  tokenFile?: string;
  createdAt?: string;
  rotatedAt?: string;
  tokens: AuthTokenStatus[];
}

export interface AuthRotateResult {
  status: AuthStatus;
  apiToken: string;
  readApiToken?: string;
}

export interface AuthCreateTokenResult {
  status: AuthStatus;
  token: AuthTokenStatus;
  apiToken: string;
}

export interface AuthRevokeTokenResult {
  status: AuthStatus;
  revoked: AuthTokenStatus;
}

export interface AuthDecision {
  authorized: boolean;
  scope?: AuthScope;
  actor?: string;
  tokenId?: string;
  reason?: "unauthorized" | "forbidden";
}

export interface AuthContext {
  scope: AuthScope;
  actor: string;
  tokenId: string;
}

const DEFAULT_TOKEN_RECORD: AuthTokenRecord = { createdAt: "", tokens: [] };
const DEFAULT_ACTOR = "local";

export class AuthService {
  private readonly store: JsonFileStore<AuthTokenRecord>;
  private readonly envToken: string | undefined;
  private localRecord: AuthTokenRecord | undefined;

  constructor(private readonly tokenPath: string, envToken = process.env.ZUU_API_TOKEN?.trim()) {
    this.envToken = envToken || undefined;
    this.store = new JsonFileStore<AuthTokenRecord>({
      name: "auth-token",
      path: tokenPath,
      defaultValue: DEFAULT_TOKEN_RECORD,
      countRecords: (value) => value.tokens.length,
    });

    if (!this.envToken) {
      this.localRecord = this.loadOrCreateLocalToken();
    }
  }

  currentToken(scope: AuthScope = "admin") {
    if (this.envToken) return this.envToken;
    const record = this.getLocalRecord();
    return this.defaultToken(record, scope).token;
  }

  authorize(authorization: string | undefined, requiredScope: AuthScope = "admin"): AuthDecision {
    const context = this.contextForAuthorization(authorization);
    if (!context) return { authorized: false, reason: "unauthorized" };
    if (context.scope === "admin") return { authorized: true, ...context };
    if (context.scope === "read") {
      return requiredScope === "read" ? { authorized: true, ...context } : { authorized: false, ...context, reason: "forbidden" };
    }
    return { authorized: false, reason: "unauthorized" };
  }

  scopeForAuthorization(authorization: string | undefined): AuthScope | undefined {
    return this.contextForAuthorization(authorization)?.scope;
  }

  contextForAuthorization(authorization: string | undefined): AuthContext | undefined {
    const token = bearerToken(authorization);
    if (!token) return undefined;
    if (this.envToken) return token === this.envToken ? { scope: "admin", actor: "env", tokenId: "env-admin" } : undefined;

    const stored = this.getLocalRecord().tokens.find((item) => item.token === token);
    return stored ? { scope: stored.scope, actor: stored.actor, tokenId: stored.id } : undefined;
  }

  status(): AuthStatus {
    if (this.envToken) {
      return {
        enabled: true,
        source: "env",
        canRotate: false,
        tokenPreview: tokenPreview(this.envToken),
        tokens: [
          {
            id: "env-admin",
            actor: "env",
            scope: "admin",
            tokenPreview: tokenPreview(this.envToken),
            createdAt: new Date(0).toISOString(),
          },
        ],
      };
    }

    const record = this.getLocalRecord();
    return {
      enabled: true,
      source: "local",
      canRotate: true,
      tokenPreview: tokenPreview(this.defaultToken(record, "admin").token),
      tokenFile: this.tokenPath,
      createdAt: record.createdAt,
      rotatedAt: record.rotatedAt,
      tokens: record.tokens.map(toTokenStatus),
    };
  }

  rotate(): AuthRotateResult {
    this.assertLocalAuthMutable("rotated");

    const previous = this.getLocalRecord();
    const rotatedAt = new Date().toISOString();
    const next: AuthTokenRecord = {
      ...previous,
      rotatedAt,
      tokens: previous.tokens.map((token) => ({
        ...token,
        token: generateToken(token.scope),
        rotatedAt,
      })),
    };
    this.saveLocalToken(next);
    const admin = this.defaultToken(next, "admin");
    const read = this.defaultToken(next, "read");
    return {
      status: this.status(),
      apiToken: admin.token,
      readApiToken: read.token,
    };
  }

  createToken(request: AuthCreateTokenRequest): AuthCreateTokenResult {
    this.assertLocalAuthMutable("created");
    const scope = parseAuthScope(request.scope);
    const actor = normalizeActor(request.actor);
    const record = this.getLocalRecord();
    const token: StoredAuthToken = {
      id: randomUUID(),
      actor,
      scope,
      token: generateToken(scope),
      createdAt: new Date().toISOString(),
    };
    this.saveLocalToken({ ...record, tokens: [...record.tokens, token] });
    return {
      status: this.status(),
      token: toTokenStatus(token),
      apiToken: token.token,
    };
  }

  revokeToken(tokenId: string): AuthRevokeTokenResult {
    this.assertLocalAuthMutable("revoked");
    const record = this.getLocalRecord();
    const revoked = record.tokens.find((token) => token.id === tokenId);
    if (!revoked) {
      throw new ApiError("Auth token not found", { status: 404, code: "not_found", details: { tokenId } });
    }
    if (revoked.scope === "admin" && record.tokens.filter((token) => token.scope === "admin").length <= 1) {
      throw new ApiError("Cannot revoke the last admin token", {
        status: 409,
        code: "auth_last_admin_token",
        details: { tokenId },
      });
    }

    this.saveLocalToken({ ...record, tokens: record.tokens.filter((token) => token.id !== tokenId) });
    return {
      status: this.status(),
      revoked: toTokenStatus(revoked),
    };
  }

  startupMessage() {
    const status = this.status();
    if (status.source === "env") return "Zuu API auth: using ZUU_API_TOKEN.";
    return `Zuu API auth: local token ${status.tokenPreview} stored at ${status.tokenFile}.`;
  }

  private getLocalRecord() {
    const record = this.localRecord ?? this.loadOrCreateLocalToken();
    this.localRecord = record;
    return record;
  }

  private loadOrCreateLocalToken() {
    const loaded = this.store.load(isAuthTokenRecord);
    if (loaded.tokens.some((token) => token.scope === "admin") && loaded.tokens.some((token) => token.scope === "read")) return loaded;

    const now = new Date().toISOString();
    const record: AuthTokenRecord = {
      createdAt: now,
      tokens: [
        createStoredToken("local-admin", DEFAULT_ACTOR, "admin", now),
        createStoredToken("local-read", DEFAULT_ACTOR, "read", now),
      ],
    };
    this.saveLocalToken(record);
    return record;
  }

  private saveLocalToken(record: AuthTokenRecord) {
    this.store.save(record);
    this.localRecord = record;
    try {
      chmodSync(this.tokenPath, 0o600);
    } catch {
      // Best effort on Windows and filesystems that do not support POSIX modes.
    }
  }

  private defaultToken(record: AuthTokenRecord, scope: AuthScope) {
    const token = record.tokens.find((item) => item.actor === DEFAULT_ACTOR && item.scope === scope) ?? record.tokens.find((item) => item.scope === scope);
    if (!token) throw new Error(`Missing ${scope} token`);
    return token;
  }

  private assertLocalAuthMutable(action: "created" | "revoked" | "rotated") {
    if (this.envToken) {
      throw new ApiError(`Auth token is controlled by ZUU_API_TOKEN and cannot be ${action} through the daemon`, {
        status: 409,
        code: "auth_token_env_controlled",
      });
    }
  }
}

function createStoredToken(id: string, actor: string, scope: AuthScope, createdAt: string): StoredAuthToken {
  return {
    id,
    actor,
    scope,
    token: generateToken(scope),
    createdAt,
  };
}

function generateToken(scope: AuthScope) {
  return `zuu_${scope}_${randomBytes(32).toString("base64url")}`;
}

function tokenPreview(token: string) {
  return token.length <= 12 ? token : `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function toTokenStatus(token: StoredAuthToken): AuthTokenStatus {
  return {
    id: token.id,
    actor: token.actor,
    scope: token.scope,
    tokenPreview: tokenPreview(token.token),
    createdAt: token.createdAt,
    rotatedAt: token.rotatedAt,
  };
}

function parseAuthScope(scope: string): AuthScope {
  if (scope === "admin" || scope === "read") return scope;
  throw new ApiError("scope must be admin or read", { status: 400, code: "validation_failed", details: { field: "scope" } });
}

function normalizeActor(actor: string | undefined) {
  const normalized = actor?.trim() || "api";
  if (normalized.length > 64) {
    throw new ApiError("actor must be at most 64 characters", { status: 400, code: "validation_failed", details: { field: "actor" } });
  }
  return normalized;
}

function isAuthTokenRecord(value: unknown): value is AuthTokenRecord {
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
      (!("rotatedAt" in value) || typeof value.rotatedAt === "string"),
  );
}

function bearerToken(authorization: string | undefined) {
  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) return undefined;
  return authorization.slice(prefix.length);
}
