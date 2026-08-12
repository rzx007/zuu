import { randomBytes } from "node:crypto";
import { chmodSync } from "node:fs";
import { ApiError } from "../http";
import { JsonFileStore } from "./json-file-store";

interface AuthTokenRecord {
  adminToken: string;
  readToken: string;
  createdAt: string;
  rotatedAt?: string;
}

export type AuthScope = "admin" | "read";

export interface AuthTokenStatus {
  scope: AuthScope;
  tokenPreview: string;
  createdAt?: string;
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

export interface AuthDecision {
  authorized: boolean;
  scope?: AuthScope;
  reason?: "unauthorized" | "forbidden";
}

const DEFAULT_TOKEN_RECORD: AuthTokenRecord = { adminToken: "", readToken: "", createdAt: "" };

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
      countRecords: (value) => [value.adminToken, value.readToken].filter(Boolean).length,
    });

    if (!this.envToken) {
      this.localRecord = this.loadOrCreateLocalToken();
    }
  }

  currentToken(scope: AuthScope = "admin") {
    if (this.envToken) return this.envToken;
    const record = this.localRecord ?? this.loadOrCreateLocalToken();
    this.localRecord = record;
    return scope === "read" ? record.readToken : record.adminToken;
  }

  authorize(authorization: string | undefined, requiredScope: AuthScope = "admin"): AuthDecision {
    const token = bearerToken(authorization);
    if (!token) return { authorized: false, reason: "unauthorized" };

    if (this.envToken) {
      return token === this.envToken ? { authorized: true, scope: "admin" } : { authorized: false, reason: "unauthorized" };
    }

    const record = this.localRecord ?? this.loadOrCreateLocalToken();
    this.localRecord = record;
    if (token === record.adminToken) return { authorized: true, scope: "admin" };
    if (token === record.readToken) {
      return requiredScope === "read" ? { authorized: true, scope: "read" } : { authorized: false, scope: "read", reason: "forbidden" };
    }
    return { authorized: false, reason: "unauthorized" };
  }

  status(): AuthStatus {
    if (this.envToken) {
      return {
        enabled: true,
        source: "env",
        canRotate: false,
        tokenPreview: tokenPreview(this.envToken),
        tokens: [{ scope: "admin", tokenPreview: tokenPreview(this.envToken) }],
      };
    }

    const record = this.localRecord ?? this.loadOrCreateLocalToken();
    this.localRecord = record;
    return {
      enabled: true,
      source: "local",
      canRotate: true,
      tokenPreview: tokenPreview(record.adminToken),
      tokenFile: this.tokenPath,
      createdAt: record.createdAt,
      rotatedAt: record.rotatedAt,
      tokens: [
        { scope: "admin", tokenPreview: tokenPreview(record.adminToken), createdAt: record.createdAt, rotatedAt: record.rotatedAt },
        { scope: "read", tokenPreview: tokenPreview(record.readToken), createdAt: record.createdAt, rotatedAt: record.rotatedAt },
      ],
    };
  }

  rotate(): AuthRotateResult {
    if (this.envToken) {
      throw new ApiError("Auth token is controlled by ZUU_API_TOKEN and cannot be rotated through the daemon", {
        status: 409,
        code: "auth_token_env_controlled",
      });
    }

    const previous = this.localRecord ?? this.loadOrCreateLocalToken();
    const next: AuthTokenRecord = {
      adminToken: generateToken("admin"),
      readToken: generateToken("read"),
      createdAt: previous.createdAt || new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
    this.saveLocalToken(next);
    this.localRecord = next;
    return {
      status: this.status(),
      apiToken: next.adminToken,
      readApiToken: next.readToken,
    };
  }

  startupMessage() {
    const status = this.status();
    if (status.source === "env") return "Zuu API auth: using ZUU_API_TOKEN.";
    return `Zuu API auth: local token ${status.tokenPreview} stored at ${status.tokenFile}.`;
  }

  private loadOrCreateLocalToken() {
    const loaded = this.store.load(isAuthTokenRecord);
    if (loaded.adminToken && loaded.readToken) return loaded;

    const record: AuthTokenRecord = {
      adminToken: generateToken("admin"),
      readToken: generateToken("read"),
      createdAt: new Date().toISOString(),
    };
    this.saveLocalToken(record);
    return record;
  }

  private saveLocalToken(record: AuthTokenRecord) {
    this.store.save(record);
    try {
      chmodSync(this.tokenPath, 0o600);
    } catch {
      // Best effort on Windows and filesystems that do not support POSIX modes.
    }
  }
}

function generateToken(scope: AuthScope) {
  return `zuu_${scope}_${randomBytes(32).toString("base64url")}`;
}

function tokenPreview(token: string) {
  return token.length <= 12 ? token : `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function isAuthTokenRecord(value: unknown): value is AuthTokenRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      "adminToken" in value &&
      typeof value.adminToken === "string" &&
      "readToken" in value &&
      typeof value.readToken === "string" &&
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
