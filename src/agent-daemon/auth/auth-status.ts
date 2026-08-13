import {
  defaultToken,
  tokenPreview,
  toTokenStatus,
  type AuthTokenRecord,
  type AuthTokenStatus,
} from "./auth-tokens";

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

export function envAuthStatus(envToken: string): AuthStatus {
  return {
    enabled: true,
    source: "env",
    canRotate: false,
    tokenPreview: tokenPreview(envToken),
    tokens: [
      {
        id: "env-admin",
        actor: "env",
        scope: "admin",
        tokenPreview: tokenPreview(envToken),
        createdAt: new Date(0).toISOString(),
        expired: false,
      },
    ],
  };
}

export function localAuthStatus(record: AuthTokenRecord, tokenPath: string): AuthStatus {
  return {
    enabled: true,
    source: "local",
    canRotate: true,
    tokenPreview: tokenPreview(defaultToken(record, "admin").token),
    tokenFile: tokenPath,
    createdAt: record.createdAt,
    rotatedAt: record.rotatedAt,
    tokens: record.tokens.map(toTokenStatus),
  };
}
