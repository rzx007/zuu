import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { ApiError } from "../http";
import { envAuthStatus, localAuthStatus, type AuthStatus } from "./auth-status";
import { JsonFileStore } from "./json-file-store";
import {
  bearerToken,
  createStoredToken,
  DEFAULT_ACTOR,
  DEFAULT_TOKEN_RECORD,
  defaultToken,
  generateToken,
  isAuthTokenRecord,
  isTokenExpired,
  normalizeActor,
  normalizeFutureTimestamp,
  parseAuthScope,
  toTokenStatus,
  type AuthScope,
  type AuthTokenRecord,
  type AuthTokenStatus,
  type StoredAuthToken,
} from "./auth-tokens";

export type { AuthScope, AuthTokenStatus } from "./auth-tokens";

export interface AuthCreateTokenRequest {
  scope: AuthScope;
  actor?: string;
  expiresAt?: string;
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

const TOKEN_USAGE_TOUCH_INTERVAL_MS = 30_000;

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
    return defaultToken(record, scope).token;
  }

  authorize(authorization: string | undefined, requiredScope: AuthScope = "admin"): AuthDecision {
    const context = this.contextForAuthorization(authorization);
    if (!context) return { authorized: false, reason: "unauthorized" };
    this.touchTokenUsage(context.tokenId);
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

    const stored = this.getLocalRecord().tokens.find((item) => item.token === token && !isTokenExpired(item));
    return stored ? { scope: stored.scope, actor: stored.actor, tokenId: stored.id } : undefined;
  }

  status(): AuthStatus {
    if (this.envToken) return envAuthStatus(this.envToken);
    const record = this.getLocalRecord();
    return localAuthStatus(record, this.tokenPath);
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
    const admin = defaultToken(next, "admin");
    const read = defaultToken(next, "read");
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
    const expiresAt = normalizeFutureTimestamp(request.expiresAt, "expiresAt");
    const record = this.getLocalRecord();
    const token: StoredAuthToken = {
      id: randomUUID(),
      actor,
      scope,
      token: generateToken(scope),
      createdAt: new Date().toISOString(),
      expiresAt,
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

  private assertLocalAuthMutable(action: "created" | "revoked" | "rotated") {
    if (this.envToken) {
      throw new ApiError(`Auth token is controlled by ZUU_API_TOKEN and cannot be ${action} through the daemon`, {
        status: 409,
        code: "auth_token_env_controlled",
      });
    }
  }

  private touchTokenUsage(tokenId: string) {
    if (this.envToken) return;
    const record = this.getLocalRecord();
    const token = record.tokens.find((item) => item.id === tokenId);
    if (!token) return;
    const nowMs = Date.now();
    if (token.lastUsedAt && Date.parse(token.lastUsedAt) > nowMs - TOKEN_USAGE_TOUCH_INTERVAL_MS) return;
    const lastUsedAt = new Date(nowMs).toISOString();
    this.saveLocalToken({
      ...record,
      tokens: record.tokens.map((item) => (item.id === tokenId ? { ...item, lastUsedAt } : item)),
    });
  }
}
