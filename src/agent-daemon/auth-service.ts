import { randomBytes } from "node:crypto";
import { chmodSync } from "node:fs";
import { ApiError } from "../http";
import { JsonFileStore } from "./json-file-store";

interface AuthTokenRecord {
  token: string;
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
}

export interface AuthRotateResult {
  status: AuthStatus;
  apiToken: string;
}

const DEFAULT_TOKEN_RECORD: AuthTokenRecord = { token: "", createdAt: "" };

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
      countRecords: (value) => (value.token ? 1 : 0),
    });

    if (!this.envToken) {
      this.localRecord = this.loadOrCreateLocalToken();
    }
  }

  currentToken() {
    return this.envToken ?? this.localRecord?.token ?? "";
  }

  isAuthorized(authorization: string | undefined) {
    return authorization === `Bearer ${this.currentToken()}`;
  }

  status(): AuthStatus {
    if (this.envToken) {
      return {
        enabled: true,
        source: "env",
        canRotate: false,
        tokenPreview: tokenPreview(this.envToken),
      };
    }

    const record = this.localRecord ?? this.loadOrCreateLocalToken();
    this.localRecord = record;
    return {
      enabled: true,
      source: "local",
      canRotate: true,
      tokenPreview: tokenPreview(record.token),
      tokenFile: this.tokenPath,
      createdAt: record.createdAt,
      rotatedAt: record.rotatedAt,
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
      token: generateToken(),
      createdAt: previous.createdAt || new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
    this.saveLocalToken(next);
    this.localRecord = next;
    return {
      status: this.status(),
      apiToken: next.token,
    };
  }

  startupMessage() {
    const status = this.status();
    if (status.source === "env") return "Zuu API auth: using ZUU_API_TOKEN.";
    return `Zuu API auth: local token ${status.tokenPreview} stored at ${status.tokenFile}.`;
  }

  private loadOrCreateLocalToken() {
    const loaded = this.store.load(isAuthTokenRecord);
    if (loaded.token) return loaded;

    const record: AuthTokenRecord = {
      token: generateToken(),
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

function generateToken() {
  return `zuu_${randomBytes(32).toString("base64url")}`;
}

function tokenPreview(token: string) {
  return token.length <= 12 ? token : `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function isAuthTokenRecord(value: unknown): value is AuthTokenRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      "token" in value &&
      typeof value.token === "string" &&
      "createdAt" in value &&
      typeof value.createdAt === "string" &&
      (!("rotatedAt" in value) || typeof value.rotatedAt === "string"),
  );
}
