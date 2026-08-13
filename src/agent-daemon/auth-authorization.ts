import {
  isTokenExpired,
  type AuthScope,
  type AuthTokenRecord,
} from "./auth-tokens";
import { bearerToken } from "./auth-token-validation";

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

export function contextForAuthorization(
  authorization: string | undefined,
  options: {
    envToken?: string;
    getLocalRecord: () => AuthTokenRecord;
  },
): AuthContext | undefined {
  const token = bearerToken(authorization);
  if (!token) return undefined;
  if (options.envToken) {
    return token === options.envToken ? { scope: "admin", actor: "env", tokenId: "env-admin" } : undefined;
  }

  const stored = options.getLocalRecord().tokens.find((item) => item.token === token && !isTokenExpired(item));
  return stored ? { scope: stored.scope, actor: stored.actor, tokenId: stored.id } : undefined;
}

export function authorizeContext(context: AuthContext | undefined, requiredScope: AuthScope): AuthDecision {
  if (!context) return { authorized: false, reason: "unauthorized" };
  if (context.scope === "admin") return { authorized: true, ...context };
  if (context.scope === "read") {
    return requiredScope === "read" ? { authorized: true, ...context } : { authorized: false, ...context, reason: "forbidden" };
  }
  return { authorized: false, reason: "unauthorized" };
}
