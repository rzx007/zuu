import { randomUUID } from "node:crypto";
import { ApiError } from "../http";
import { envAuthStatus, localAuthStatus, type AuthStatus } from "./auth-status";
import { LocalAuthTokenStore } from "./auth-token-store";
import {
  bearerToken,
  defaultToken,
  generateToken,
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

export class AuthService {
  private readonly envToken: string | undefined;
  private readonly localStore: LocalAuthTokenStore | undefined;

  constructor(private readonly tokenPath: string, envToken = process.env.ZUU_API_TOKEN?.trim()) {
    this.envToken = envToken || undefined;
    if (!this.envToken) {
      this.localStore = new LocalAuthTokenStore(tokenPath);
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
    this.localStore?.touchUsage(context.tokenId);
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
    if (!this.localStore) {
      throw new ApiError("Local auth token store is unavailable while ZUU_API_TOKEN is active", {
        status: 409,
        code: "auth_token_env_controlled",
      });
    }
    return this.localStore.get();
  }

  private saveLocalToken(record: AuthTokenRecord) {
    this.localStore?.save(record);
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
